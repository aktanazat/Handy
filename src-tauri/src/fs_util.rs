use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;

const BUFFER_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct VerifiedCopy {
    pub bytes: u64,
    pub sha256: [u8; 32],
}

pub(crate) fn copy_verified(source: &Path, destination: &Path) -> io::Result<VerifiedCopy> {
    let parent = destination
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing destination parent"))?;
    fs::create_dir_all(parent)?;

    let temporary = destination.with_extension("copying");
    let mut input = File::open(source)?;
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    let mut source_hash = Sha256::new();
    let mut copied = 0_u64;
    let mut buffer = vec![0_u8; BUFFER_BYTES];

    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        source_hash.update(&buffer[..count]);
        output.write_all(&buffer[..count])?;
        copied = copied.saturating_add(u64::try_from(count).unwrap_or(u64::MAX));
    }
    output.sync_all()?;
    drop(output);

    let source_len = fs::metadata(source)?.len();
    if copied != source_len || fs::metadata(&temporary)?.len() != source_len {
        let _ = fs::remove_file(&temporary);
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "copy size mismatch",
        ));
    }

    let source_hash: [u8; 32] = source_hash.finalize().into();
    fs::rename(&temporary, destination)?;
    if file_hash(destination)? != source_hash {
        let _ = fs::remove_file(destination);
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "copy hash mismatch",
        ));
    }

    Ok(VerifiedCopy {
        bytes: source_len,
        sha256: source_hash,
    })
}

pub(crate) fn files_equal(left: &Path, right: &Path) -> io::Result<bool> {
    if fs::metadata(left)?.len() != fs::metadata(right)?.len() {
        return Ok(false);
    }
    Ok(file_hash(left)? == file_hash(right)?)
}

pub(crate) fn file_hash(path: &Path) -> io::Result<[u8; 32]> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; BUFFER_BYTES];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(digest.finalize().into())
}

pub(crate) fn write_private_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing destination parent"))?;
    fs::create_dir_all(parent)?;
    let temporary = path.with_extension("tmp");
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(temporary, path)
}

pub(crate) fn hex_digest(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}
