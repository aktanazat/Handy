use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    ops::Range,
    path::Path,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

const CAPABILITY_MAGIC: &[u8; 8] = b"SONACAP1";
const CAPABILITY_FORMAT: &str = "sona-share-capability-v1";
const CAPABILITY_VERSION: u32 = 1;
const CAPABILITY_HEADER_LENGTH_BYTES: usize = 4;
const MAX_CAPABILITY_HEADER_BYTES: usize = 1024;
const SHARE_ROOT_BYTES: usize = 32;

const WORKER_SHARE_FORMAT: &str = "sona-encrypted-share-v1";
const WORKER_PROTOCOL_VERSION: u32 = 1;
const MIN_ENCRYPTED_PAYLOAD_BYTES: usize = 28;
const MAX_WORKER_HEADER_BYTES: usize = 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 512 * 1024;
const MAX_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const MAX_CHUNKS: usize = 4096;
const MAX_SHARE_BYTES: usize = 256 * 1024 * 1024;
const WORKER_FRAME_LENGTH_BYTES: usize = 4;
const MAX_WORKER_TRANSPORT_BYTES: usize =
    MAX_WORKER_HEADER_BYTES + MAX_SHARE_BYTES + MAX_CHUNKS * WORKER_FRAME_LENGTH_BYTES;
const MAX_CAPABILITY_FILE_BYTES: usize = CAPABILITY_MAGIC.len()
    + CAPABILITY_HEADER_LENGTH_BYTES
    + MAX_CAPABILITY_HEADER_BYTES
    + SHARE_ROOT_BYTES
    + MAX_WORKER_TRANSPORT_BYTES;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ShareFileError {
    Io,
    InvalidCapability,
    InvalidTransport,
}

pub(crate) struct ValidatedWorkerShare {
    pub(crate) header: ShareFileHeader,
    pub(crate) ciphertext_frames: ShareFileCiphertextFrames,
}

pub(crate) struct ValidatedShareFile {
    pub(crate) header: ShareFileHeader,
    pub(crate) ciphertext_frames: ShareFileCiphertextFrames,
    share_root: Zeroizing<[u8; SHARE_ROOT_BYTES]>,
}

impl ValidatedShareFile {
    pub(crate) fn share_root(&self) -> &[u8; SHARE_ROOT_BYTES] {
        &self.share_root
    }
}

pub(crate) struct ShareFileHeader {
    pub(crate) share_id: String,
    pub(crate) crypto_version: u32,
    pub(crate) manifest_sha256: [u8; 32],
    pub(crate) chunk_count: u32,
    pub(crate) total_bytes: u64,
    pub(crate) writer_signature: [u8; 64],
    pub(crate) manifest_ciphertext: Vec<u8>,
    pub(crate) chunk_plan: Vec<ShareFileChunk>,
}

pub(crate) struct ShareFileChunk {
    pub(crate) index: u32,
    pub(crate) size: u32,
    pub(crate) sha256: [u8; 32],
}

pub(crate) struct ShareFileCiphertextFrames {
    storage: Vec<u8>,
    spans: Vec<Range<usize>>,
}

impl ShareFileCiphertextFrames {
    pub(crate) fn len(&self) -> usize {
        self.spans.len()
    }

    #[cfg(test)]
    pub(crate) fn get(&self, index: usize) -> Option<&[u8]> {
        let span = self.spans.get(index)?;
        Some(&self.storage[span.clone()])
    }

    pub(crate) fn iter(&self) -> impl ExactSizeIterator<Item = &[u8]> {
        self.spans.iter().map(|span| &self.storage[span.clone()])
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CapabilityHeaderWire {
    format: String,
    version: u32,
    transport_bytes: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerHeaderWire {
    format: String,
    version: u32,
    share: WorkerShareWire,
    manifest: String,
    #[serde(deserialize_with = "deserialize_limited_chunks")]
    chunks: Vec<WorkerChunkWire>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerShareWire {
    share_id: String,
    crypto_version: u32,
    manifest_sha256: String,
    chunk_count: u32,
    total_bytes: u64,
    writer_signature: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerChunkWire {
    index: u32,
    size: u32,
    sha256: String,
}

#[derive(Serialize)]
struct WorkerHeaderOutput<'a> {
    format: &'static str,
    version: u32,
    share: WorkerShareOutput<'a>,
    manifest: String,
    chunks: Vec<WorkerChunkOutput>,
}

#[derive(Serialize)]
struct WorkerShareOutput<'a> {
    share_id: &'a str,
    crypto_version: u32,
    manifest_sha256: String,
    chunk_count: u32,
    total_bytes: u64,
    writer_signature: String,
}

#[derive(Serialize)]
struct WorkerChunkOutput {
    index: u32,
    size: u32,
    sha256: String,
}

struct ParsedWorkerTransport {
    header: ShareFileHeader,
    frame_spans: Vec<Range<usize>>,
}

pub(crate) fn parse_worker_share_transport(
    bytes: Vec<u8>,
) -> Result<ValidatedWorkerShare, ShareFileError> {
    let parsed = parse_worker_transport(&bytes)?;
    Ok(ValidatedWorkerShare {
        header: parsed.header,
        ciphertext_frames: ShareFileCiphertextFrames {
            storage: bytes,
            spans: parsed.frame_spans,
        },
    })
}

pub(crate) fn write_share_file(
    path: &Path,
    share_root: &[u8; SHARE_ROOT_BYTES],
    header: &ShareFileHeader,
    ciphertext_frames: &ShareFileCiphertextFrames,
) -> Result<(), ShareFileError> {
    validate_typed_header(header)?;
    validate_ciphertext_frames(header, ciphertext_frames)?;

    let worker_header = serialize_worker_header(header)?;
    let total_bytes =
        usize::try_from(header.total_bytes).map_err(|_| ShareFileError::InvalidTransport)?;
    let worker_transport_bytes = worker_header
        .len()
        .checked_add(1)
        .and_then(|length| {
            length.checked_add(
                ciphertext_frames
                    .len()
                    .checked_mul(WORKER_FRAME_LENGTH_BYTES)?,
            )
        })
        .and_then(|length| length.checked_add(total_bytes))
        .filter(|length| *length <= MAX_WORKER_TRANSPORT_BYTES)
        .ok_or(ShareFileError::InvalidTransport)?;
    let transport_bytes =
        u64::try_from(worker_transport_bytes).map_err(|_| ShareFileError::InvalidCapability)?;
    let capability_header = serde_json::to_vec(&CapabilityHeaderWire {
        format: CAPABILITY_FORMAT.to_owned(),
        version: CAPABILITY_VERSION,
        transport_bytes,
    })
    .map_err(|_| ShareFileError::InvalidCapability)?;
    if capability_header.len() > MAX_CAPABILITY_HEADER_BYTES {
        return Err(ShareFileError::InvalidCapability);
    }
    let capability_header_length =
        u32::try_from(capability_header.len()).map_err(|_| ShareFileError::InvalidCapability)?;

    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    let Some(parent) = parent else {
        return Err(ShareFileError::Io);
    };
    let file_name = path.file_name().and_then(|name| name.to_str());
    let Some(file_name) = file_name.filter(|name| !name.is_empty()) else {
        return Err(ShareFileError::Io);
    };

    let temporary = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let write_result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| ShareFileError::Io)?;
        file.write_all(CAPABILITY_MAGIC)
            .map_err(|_| ShareFileError::Io)?;
        file.write_all(&capability_header_length.to_be_bytes())
            .map_err(|_| ShareFileError::Io)?;
        file.write_all(&capability_header)
            .map_err(|_| ShareFileError::Io)?;
        file.write_all(share_root).map_err(|_| ShareFileError::Io)?;
        file.write_all(&worker_header)
            .map_err(|_| ShareFileError::Io)?;
        file.write_all(b"\n").map_err(|_| ShareFileError::Io)?;
        for (chunk, ciphertext) in header.chunk_plan.iter().zip(ciphertext_frames.iter()) {
            file.write_all(&chunk.size.to_be_bytes())
                .map_err(|_| ShareFileError::Io)?;
            file.write_all(ciphertext).map_err(|_| ShareFileError::Io)?;
        }
        file.sync_all().map_err(|_| ShareFileError::Io)?;
        fs::rename(&temporary, path).map_err(|_| ShareFileError::Io)?;
        sync_parent_directory(parent)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

pub(crate) fn read_share_file(path: &Path) -> Result<ValidatedShareFile, ShareFileError> {
    let file = File::open(path).map_err(|_| ShareFileError::Io)?;
    let expected_length = file.metadata().map_err(|_| ShareFileError::Io)?.len();
    let max_capability_file_bytes =
        u64::try_from(MAX_CAPABILITY_FILE_BYTES).map_err(|_| ShareFileError::InvalidCapability)?;
    if expected_length > max_capability_file_bytes {
        return Err(ShareFileError::InvalidCapability);
    }

    let initial_capacity =
        usize::try_from(expected_length).map_err(|_| ShareFileError::InvalidCapability)?;
    let mut bytes = Vec::with_capacity(initial_capacity);
    let bounded_length = max_capability_file_bytes
        .checked_add(1)
        .ok_or(ShareFileError::InvalidCapability)?;
    let mut bounded_reader = file.take(bounded_length);
    bounded_reader
        .read_to_end(&mut bytes)
        .map_err(|_| ShareFileError::Io)?;
    if bytes.len() > MAX_CAPABILITY_FILE_BYTES {
        return Err(ShareFileError::InvalidCapability);
    }

    parse_share_file(bytes)
}

pub(crate) fn parse_share_file(mut bytes: Vec<u8>) -> Result<ValidatedShareFile, ShareFileError> {
    if bytes.len() > MAX_CAPABILITY_FILE_BYTES || !bytes.starts_with(CAPABILITY_MAGIC) {
        return Err(ShareFileError::InvalidCapability);
    }

    let prefix_end = CAPABILITY_MAGIC.len() + CAPABILITY_HEADER_LENGTH_BYTES;
    let header_length_bytes = bytes
        .get(CAPABILITY_MAGIC.len()..prefix_end)
        .ok_or(ShareFileError::InvalidCapability)?;
    let header_length = usize::try_from(u32::from_be_bytes(
        header_length_bytes
            .try_into()
            .map_err(|_| ShareFileError::InvalidCapability)?,
    ))
    .map_err(|_| ShareFileError::InvalidCapability)?;
    if header_length > MAX_CAPABILITY_HEADER_BYTES {
        return Err(ShareFileError::InvalidCapability);
    }

    let header_end = prefix_end
        .checked_add(header_length)
        .ok_or(ShareFileError::InvalidCapability)?;
    let root_start = header_end;
    let root_end = root_start
        .checked_add(SHARE_ROOT_BYTES)
        .ok_or(ShareFileError::InvalidCapability)?;
    let root_bytes = bytes
        .get(root_start..root_end)
        .ok_or(ShareFileError::InvalidCapability)?;
    let mut root = [0_u8; SHARE_ROOT_BYTES];
    root.copy_from_slice(root_bytes);
    bytes[root_start..root_end].zeroize();
    let share_root = Zeroizing::new(root);

    let header_bytes = bytes
        .get(prefix_end..header_end)
        .ok_or(ShareFileError::InvalidCapability)?;
    let header: CapabilityHeaderWire =
        serde_json::from_slice(header_bytes).map_err(|_| ShareFileError::InvalidCapability)?;
    let max_worker_transport_bytes =
        u64::try_from(MAX_WORKER_TRANSPORT_BYTES).map_err(|_| ShareFileError::InvalidCapability)?;
    if header.format != CAPABILITY_FORMAT
        || header.version != CAPABILITY_VERSION
        || header.transport_bytes > max_worker_transport_bytes
    {
        return Err(ShareFileError::InvalidCapability);
    }

    let transport_start = root_end;
    let transport_length =
        usize::try_from(header.transport_bytes).map_err(|_| ShareFileError::InvalidCapability)?;
    let transport_end = transport_start
        .checked_add(transport_length)
        .ok_or(ShareFileError::InvalidCapability)?;
    if transport_end != bytes.len() {
        return Err(ShareFileError::InvalidCapability);
    }

    let parsed_transport = parse_worker_transport(&bytes[transport_start..transport_end])?;
    let frame_spans = parsed_transport
        .frame_spans
        .into_iter()
        .map(|span| (transport_start + span.start)..(transport_start + span.end))
        .collect();

    Ok(ValidatedShareFile {
        header: parsed_transport.header,
        ciphertext_frames: ShareFileCiphertextFrames {
            storage: bytes,
            spans: frame_spans,
        },
        share_root,
    })
}

fn parse_worker_transport(transport: &[u8]) -> Result<ParsedWorkerTransport, ShareFileError> {
    if transport.len() > MAX_WORKER_TRANSPORT_BYTES {
        return Err(ShareFileError::InvalidTransport);
    }

    let header_end = transport
        .iter()
        .take(MAX_WORKER_HEADER_BYTES + 1)
        .position(|byte| *byte == b'\n')
        .ok_or(ShareFileError::InvalidTransport)?;
    let header: WorkerHeaderWire = serde_json::from_slice(&transport[..header_end])
        .map_err(|_| ShareFileError::InvalidTransport)?;
    let header = validate_worker_header(header)?;

    let mut cursor = header_end + 1;
    let mut frame_spans = Vec::with_capacity(header.chunk_plan.len());
    for chunk in &header.chunk_plan {
        let prefix_end = cursor
            .checked_add(WORKER_FRAME_LENGTH_BYTES)
            .ok_or(ShareFileError::InvalidTransport)?;
        let length_bytes = transport
            .get(cursor..prefix_end)
            .ok_or(ShareFileError::InvalidTransport)?;
        let frame_length = u32::from_be_bytes(
            length_bytes
                .try_into()
                .map_err(|_| ShareFileError::InvalidTransport)?,
        );
        if frame_length != chunk.size {
            return Err(ShareFileError::InvalidTransport);
        }

        let frame_length =
            usize::try_from(frame_length).map_err(|_| ShareFileError::InvalidTransport)?;
        let frame_end = prefix_end
            .checked_add(frame_length)
            .ok_or(ShareFileError::InvalidTransport)?;
        let ciphertext = transport
            .get(prefix_end..frame_end)
            .ok_or(ShareFileError::InvalidTransport)?;
        if sha256(ciphertext) != chunk.sha256 {
            return Err(ShareFileError::InvalidTransport);
        }
        frame_spans.push(prefix_end..frame_end);
        cursor = frame_end;
    }
    if cursor != transport.len() {
        return Err(ShareFileError::InvalidTransport);
    }

    Ok(ParsedWorkerTransport {
        header,
        frame_spans,
    })
}

fn validate_worker_header(header: WorkerHeaderWire) -> Result<ShareFileHeader, ShareFileError> {
    if header.format != WORKER_SHARE_FORMAT || header.version != WORKER_PROTOCOL_VERSION {
        return Err(ShareFileError::InvalidTransport);
    }
    let chunk_count =
        usize::try_from(header.share.chunk_count).map_err(|_| ShareFileError::InvalidTransport)?;
    let max_share_bytes =
        u64::try_from(MAX_SHARE_BYTES).map_err(|_| ShareFileError::InvalidTransport)?;
    if !is_opaque_id(&header.share.share_id)
        || header.share.crypto_version != WORKER_PROTOCOL_VERSION
        || chunk_count > MAX_CHUNKS
        || chunk_count != header.chunks.len()
        || header.share.total_bytes > max_share_bytes
    {
        return Err(ShareFileError::InvalidTransport);
    }

    if header.manifest.len() > max_base64url_length(MAX_MANIFEST_BYTES) {
        return Err(ShareFileError::InvalidTransport);
    }
    let manifest_ciphertext = decode_canonical_base64url(&header.manifest)?;
    if !(MIN_ENCRYPTED_PAYLOAD_BYTES..=MAX_MANIFEST_BYTES).contains(&manifest_ciphertext.len()) {
        return Err(ShareFileError::InvalidTransport);
    }
    let manifest_sha256 = decode_canonical_fixed(&header.share.manifest_sha256)?;
    if sha256(&manifest_ciphertext) != manifest_sha256 {
        return Err(ShareFileError::InvalidTransport);
    }
    let writer_signature = decode_canonical_fixed(&header.share.writer_signature)?;

    let min_chunk_bytes =
        u32::try_from(MIN_ENCRYPTED_PAYLOAD_BYTES).map_err(|_| ShareFileError::InvalidTransport)?;
    let max_chunk_bytes =
        u32::try_from(MAX_CHUNK_BYTES).map_err(|_| ShareFileError::InvalidTransport)?;
    let mut chunk_plan = Vec::with_capacity(header.chunks.len());
    let mut total_bytes = 0_u64;
    for (expected_index, chunk) in header.chunks.into_iter().enumerate() {
        let chunk_index =
            u32::try_from(expected_index).map_err(|_| ShareFileError::InvalidTransport)?;
        if chunk.index != chunk_index
            || !(min_chunk_bytes..=max_chunk_bytes).contains(&chunk.size)
            || (expected_index + 1 < chunk_count && chunk.size != max_chunk_bytes)
        {
            return Err(ShareFileError::InvalidTransport);
        }
        let sha256 = decode_canonical_fixed(&chunk.sha256)?;
        total_bytes = total_bytes
            .checked_add(u64::from(chunk.size))
            .ok_or(ShareFileError::InvalidTransport)?;
        chunk_plan.push(ShareFileChunk {
            index: chunk.index,
            size: chunk.size,
            sha256,
        });
    }
    if total_bytes != header.share.total_bytes {
        return Err(ShareFileError::InvalidTransport);
    }

    Ok(ShareFileHeader {
        share_id: header.share.share_id,
        crypto_version: header.share.crypto_version,
        manifest_sha256,
        chunk_count: header.share.chunk_count,
        total_bytes,
        writer_signature,
        manifest_ciphertext,
        chunk_plan,
    })
}

fn validate_typed_header(header: &ShareFileHeader) -> Result<(), ShareFileError> {
    let chunk_count =
        usize::try_from(header.chunk_count).map_err(|_| ShareFileError::InvalidTransport)?;
    let max_share_bytes =
        u64::try_from(MAX_SHARE_BYTES).map_err(|_| ShareFileError::InvalidTransport)?;
    let min_chunk_bytes =
        u32::try_from(MIN_ENCRYPTED_PAYLOAD_BYTES).map_err(|_| ShareFileError::InvalidTransport)?;
    let max_chunk_bytes =
        u32::try_from(MAX_CHUNK_BYTES).map_err(|_| ShareFileError::InvalidTransport)?;
    if !is_opaque_id(&header.share_id)
        || header.crypto_version != WORKER_PROTOCOL_VERSION
        || chunk_count > MAX_CHUNKS
        || chunk_count != header.chunk_plan.len()
        || header.total_bytes > max_share_bytes
        || !(MIN_ENCRYPTED_PAYLOAD_BYTES..=MAX_MANIFEST_BYTES)
            .contains(&header.manifest_ciphertext.len())
        || sha256(&header.manifest_ciphertext) != header.manifest_sha256
    {
        return Err(ShareFileError::InvalidTransport);
    }

    let mut total_bytes = 0_u64;
    for (expected_index, chunk) in header.chunk_plan.iter().enumerate() {
        let chunk_index =
            u32::try_from(expected_index).map_err(|_| ShareFileError::InvalidTransport)?;
        if chunk.index != chunk_index
            || !(min_chunk_bytes..=max_chunk_bytes).contains(&chunk.size)
            || (expected_index + 1 < chunk_count && chunk.size != max_chunk_bytes)
        {
            return Err(ShareFileError::InvalidTransport);
        }
        total_bytes = total_bytes
            .checked_add(u64::from(chunk.size))
            .ok_or(ShareFileError::InvalidTransport)?;
    }
    if total_bytes != header.total_bytes {
        return Err(ShareFileError::InvalidTransport);
    }
    Ok(())
}

fn validate_ciphertext_frames(
    header: &ShareFileHeader,
    ciphertext_frames: &ShareFileCiphertextFrames,
) -> Result<(), ShareFileError> {
    if ciphertext_frames.len() != header.chunk_plan.len() {
        return Err(ShareFileError::InvalidTransport);
    }
    for (chunk, ciphertext) in header.chunk_plan.iter().zip(ciphertext_frames.iter()) {
        let chunk_size =
            usize::try_from(chunk.size).map_err(|_| ShareFileError::InvalidTransport)?;
        if ciphertext.len() != chunk_size || sha256(ciphertext) != chunk.sha256 {
            return Err(ShareFileError::InvalidTransport);
        }
    }
    Ok(())
}

fn serialize_worker_header(header: &ShareFileHeader) -> Result<Vec<u8>, ShareFileError> {
    let chunks = header
        .chunk_plan
        .iter()
        .map(|chunk| WorkerChunkOutput {
            index: chunk.index,
            size: chunk.size,
            sha256: URL_SAFE_NO_PAD.encode(chunk.sha256),
        })
        .collect();
    let output = WorkerHeaderOutput {
        format: WORKER_SHARE_FORMAT,
        version: WORKER_PROTOCOL_VERSION,
        share: WorkerShareOutput {
            share_id: &header.share_id,
            crypto_version: header.crypto_version,
            manifest_sha256: URL_SAFE_NO_PAD.encode(header.manifest_sha256),
            chunk_count: header.chunk_count,
            total_bytes: header.total_bytes,
            writer_signature: URL_SAFE_NO_PAD.encode(header.writer_signature),
        },
        manifest: URL_SAFE_NO_PAD.encode(&header.manifest_ciphertext),
        chunks,
    };
    let encoded = serde_json::to_vec(&output).map_err(|_| ShareFileError::InvalidTransport)?;
    if encoded.len() > MAX_WORKER_HEADER_BYTES {
        return Err(ShareFileError::InvalidTransport);
    }
    Ok(encoded)
}

fn decode_canonical_base64url(value: &str) -> Result<Vec<u8>, ShareFileError> {
    if value.len() % 4 == 1
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(ShareFileError::InvalidTransport);
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| ShareFileError::InvalidTransport)?;
    if URL_SAFE_NO_PAD.encode(&decoded) != value {
        return Err(ShareFileError::InvalidTransport);
    }
    Ok(decoded)
}

fn decode_canonical_fixed<const N: usize>(value: &str) -> Result<[u8; N], ShareFileError> {
    if value.len() != max_base64url_length(N) {
        return Err(ShareFileError::InvalidTransport);
    }
    decode_canonical_base64url(value)?
        .try_into()
        .map_err(|_| ShareFileError::InvalidTransport)
}

fn max_base64url_length(byte_length: usize) -> usize {
    (byte_length * 4).div_ceil(3)
}

fn is_opaque_id(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let digest = Sha256::digest(bytes);
    let mut output = [0_u8; 32];
    output.copy_from_slice(&digest);
    output
}

fn sync_parent_directory(parent: &Path) -> Result<(), ShareFileError> {
    #[cfg(unix)]
    {
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| ShareFileError::Io)
    }
    #[cfg(not(unix))]
    {
        let _ = parent;
        Ok(())
    }
}

fn deserialize_limited_chunks<'de, D>(deserializer: D) -> Result<Vec<WorkerChunkWire>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct LimitedChunks;

    impl<'de> serde::de::Visitor<'de> for LimitedChunks {
        type Value = Vec<WorkerChunkWire>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("at most 4096 worker share chunks")
        }

        fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::SeqAccess<'de>,
        {
            let mut chunks = Vec::with_capacity(sequence.size_hint().unwrap_or(0).min(MAX_CHUNKS));
            while let Some(chunk) = sequence.next_element()? {
                if chunks.len() == MAX_CHUNKS {
                    return Err(serde::de::Error::custom("too many worker share chunks"));
                }
                chunks.push(chunk);
            }
            Ok(chunks)
        }
    }

    deserializer.deserialize_seq(LimitedChunks)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct RawJson(Vec<u8>);

    impl RawJson {
        fn serialize<T: serde::Serialize>(value: &T) -> Self {
            Self(serde_json::to_vec(value).expect("test JSON serializes"))
        }

        fn append_object_field(&mut self, field: &[u8]) {
            let closing_brace = self.0.pop().expect("test JSON object has closing brace");
            assert_eq!(closing_brace, b'}');
            self.0.extend_from_slice(field);
            self.0.push(b'}');
        }
    }

    const SHARE_ID: &str = "share-id-0000000";

    fn base64url(bytes: &[u8]) -> String {
        URL_SAFE_NO_PAD.encode(bytes)
    }

    fn worker_header(manifest: &[u8], chunk: &[u8]) -> RawJson {
        worker_header_with_chunk_sha256(manifest, chunk, sha256(chunk))
    }

    fn worker_header_with_chunk_sha256(
        manifest: &[u8],
        chunk: &[u8],
        chunk_sha256: [u8; 32],
    ) -> RawJson {
        let chunk_size = u32::try_from(chunk.len()).expect("test chunk length fits u32");
        let total_bytes = u64::try_from(chunk.len()).expect("test chunk length fits u64");
        RawJson::serialize(&WorkerHeaderOutput {
            format: WORKER_SHARE_FORMAT,
            version: WORKER_PROTOCOL_VERSION,
            share: WorkerShareOutput {
                share_id: SHARE_ID,
                crypto_version: WORKER_PROTOCOL_VERSION,
                manifest_sha256: base64url(&sha256(manifest)),
                chunk_count: 1,
                total_bytes,
                writer_signature: base64url(&[3_u8; 64]),
            },
            manifest: base64url(manifest),
            chunks: vec![WorkerChunkOutput {
                index: 0,
                size: chunk_size,
                sha256: base64url(&chunk_sha256),
            }],
        })
    }

    fn worker_transport(header: &RawJson, chunks: &[Vec<u8>]) -> Vec<u8> {
        let mut transport = header.0.clone();
        transport.push(b'\n');
        for chunk in chunks {
            let chunk_length = u32::try_from(chunk.len()).expect("test chunk length fits u32");
            transport.extend_from_slice(&chunk_length.to_be_bytes());
            transport.extend_from_slice(chunk);
        }
        transport
    }

    fn valid_worker_transport() -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let manifest = vec![9_u8; MIN_ENCRYPTED_PAYLOAD_BYTES];
        let chunk = vec![7_u8; MIN_ENCRYPTED_PAYLOAD_BYTES];
        let header = worker_header(&manifest, &chunk);
        (
            worker_transport(&header, std::slice::from_ref(&chunk)),
            manifest,
            chunk,
        )
    }

    fn capability_header(format: &str, version: u32, transport_bytes: u64) -> RawJson {
        RawJson::serialize(&CapabilityHeaderWire {
            format: format.to_owned(),
            version,
            transport_bytes,
        })
    }

    fn capability_file(transport: &[u8]) -> Vec<u8> {
        let transport_bytes =
            u64::try_from(transport.len()).expect("test transport length fits u64");
        let header = capability_header(CAPABILITY_FORMAT, CAPABILITY_VERSION, transport_bytes);
        capability_file_with_header(&header, transport)
    }

    fn capability_file_with_header(header: &RawJson, transport: &[u8]) -> Vec<u8> {
        let header_length = u32::try_from(header.0.len()).expect("test header length fits u32");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(CAPABILITY_MAGIC);
        bytes.extend_from_slice(&header_length.to_be_bytes());
        bytes.extend_from_slice(&header.0);
        bytes.extend_from_slice(&[5_u8; SHARE_ROOT_BYTES]);
        bytes.extend_from_slice(transport);
        bytes
    }

    fn temporary_test_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "sona-share-file-{}-{}.sona",
            std::process::id(),
            Uuid::new_v4()
        ))
    }

    #[test]
    fn writes_and_reads_a_capability_file_without_network() {
        let (transport, manifest, chunk) = valid_worker_transport();
        let worker = parse_worker_share_transport(transport).unwrap();
        let root = [5_u8; SHARE_ROOT_BYTES];
        let path = temporary_test_path();

        write_share_file(&path, &root, &worker.header, &worker.ciphertext_frames).unwrap();
        let parsed = read_share_file(&path).unwrap();
        assert_eq!(parsed.header.share_id, SHARE_ID);
        assert_eq!(parsed.header.manifest_ciphertext, manifest);
        assert_eq!(parsed.ciphertext_frames.len(), 1);
        assert_eq!(parsed.ciphertext_frames.get(0), Some(chunk.as_slice()));
        assert!(parsed.share_root().iter().all(|byte| *byte == 5));

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn leaves_the_destination_unchanged_when_worker_frames_fail_validation() {
        let (transport, _, _) = valid_worker_transport();
        let mut worker = parse_worker_share_transport(transport).unwrap();
        let path = temporary_test_path();
        fs::write(&path, b"existing").unwrap();
        let frame_start = worker
            .ciphertext_frames
            .spans
            .first()
            .expect("worker contains a frame")
            .start;
        worker.ciphertext_frames.storage[frame_start] ^= 1;

        assert!(matches!(
            write_share_file(
                &path,
                &[5_u8; SHARE_ROOT_BYTES],
                &worker.header,
                &worker.ciphertext_frames,
            ),
            Err(ShareFileError::InvalidTransport)
        ));
        assert_eq!(fs::read(&path).unwrap(), b"existing");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_wrong_magic_version_schema_and_header_fields() {
        let (transport, _, _) = valid_worker_transport();

        let mut wrong_magic = capability_file(&transport);
        wrong_magic[0] ^= 1;
        assert!(matches!(
            parse_share_file(wrong_magic),
            Err(ShareFileError::InvalidCapability)
        ));

        let transport_bytes =
            u64::try_from(transport.len()).expect("test transport length fits u64");
        let wrong_version_header = capability_header(CAPABILITY_FORMAT, 2, transport_bytes);
        let wrong_version = capability_file_with_header(&wrong_version_header, &transport);
        assert!(matches!(
            parse_share_file(wrong_version),
            Err(ShareFileError::InvalidCapability)
        ));

        let wrong_schema_header = capability_header("other", CAPABILITY_VERSION, transport_bytes);
        let wrong_schema = capability_file_with_header(&wrong_schema_header, &transport);
        assert!(matches!(
            parse_share_file(wrong_schema),
            Err(ShareFileError::InvalidCapability)
        ));

        let mut unknown_field_header =
            capability_header(CAPABILITY_FORMAT, CAPABILITY_VERSION, transport_bytes);
        unknown_field_header.append_object_field(br#","extra":true"#);
        let unknown_field = capability_file_with_header(&unknown_field_header, &transport);
        assert!(matches!(
            parse_share_file(unknown_field),
            Err(ShareFileError::InvalidCapability)
        ));
    }

    #[test]
    fn rejects_truncated_oversized_and_trailing_capability_data() {
        let (transport, _, _) = valid_worker_transport();

        let mut truncated = capability_file(&transport);
        truncated.pop();
        assert!(matches!(
            parse_share_file(truncated),
            Err(ShareFileError::InvalidCapability)
        ));

        let oversized_transport_bytes = u64::try_from(MAX_WORKER_TRANSPORT_BYTES)
            .expect("test transport bound fits u64")
            .checked_add(1)
            .expect("test transport bound can grow by one");
        let oversized_header = capability_header(
            CAPABILITY_FORMAT,
            CAPABILITY_VERSION,
            oversized_transport_bytes,
        );
        let oversized = capability_file_with_header(&oversized_header, &[]);
        assert!(matches!(
            parse_share_file(oversized),
            Err(ShareFileError::InvalidCapability)
        ));

        let mut trailing = capability_file(&transport);
        trailing.push(0);
        assert!(matches!(
            parse_share_file(trailing),
            Err(ShareFileError::InvalidCapability)
        ));
    }

    #[test]
    fn rejects_malicious_worker_headers() {
        let (_, manifest, chunk) = valid_worker_transport();
        let mut unknown_header = worker_header(&manifest, &chunk);
        unknown_header.append_object_field(br#","extra":true"#);
        let bytes = capability_file(&worker_transport(
            &unknown_header,
            std::slice::from_ref(&chunk),
        ));
        assert!(matches!(
            parse_share_file(bytes),
            Err(ShareFileError::InvalidTransport)
        ));

        let duplicate = String::from_utf8(worker_header(&manifest, &chunk).0)
            .unwrap()
            .replacen("\"version\":1", "\"version\":1,\"version\":1", 1);
        let mut duplicate_transport = duplicate.into_bytes();
        duplicate_transport.push(b'\n');
        let chunk_length = u32::try_from(chunk.len()).expect("test chunk length fits u32");
        duplicate_transport.extend_from_slice(&chunk_length.to_be_bytes());
        duplicate_transport.extend_from_slice(&chunk);
        assert!(matches!(
            parse_share_file(capability_file(&duplicate_transport)),
            Err(ShareFileError::InvalidTransport)
        ));
    }

    #[test]
    fn rejects_truncated_worker_frames_wrong_digests_and_worker_trailing_bytes() {
        let (transport, manifest, chunk) = valid_worker_transport();

        let mut truncated = transport.clone();
        truncated.pop();
        assert!(matches!(
            parse_share_file(capability_file(&truncated)),
            Err(ShareFileError::InvalidTransport)
        ));

        let wrong_digest_header = worker_header_with_chunk_sha256(&manifest, &chunk, [0_u8; 32]);
        let wrong_digest = worker_transport(&wrong_digest_header, std::slice::from_ref(&chunk));
        assert!(matches!(
            parse_share_file(capability_file(&wrong_digest)),
            Err(ShareFileError::InvalidTransport)
        ));

        let mut trailing = transport;
        trailing.push(0);
        assert!(matches!(
            parse_share_file(capability_file(&trailing)),
            Err(ShareFileError::InvalidTransport)
        ));
    }
}
