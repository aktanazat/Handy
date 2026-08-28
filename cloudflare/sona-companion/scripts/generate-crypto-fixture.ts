import {
  createCipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  sign,
} from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type RecordField = number | string | Uint8Array;

type EnvelopeChunk = {
  index: number;
  sha256: string;
  size: number;
};

function hexBytes(value: string): Buffer {
  if (!/^[a-f0-9]+$/u.test(value) || value.length % 2 !== 0) {
    throw new Error("fixture hex must have full bytes");
  }
  return Buffer.from(value, "hex");
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function field(value: RecordField): Buffer {
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(String(value));
}

function record(...fields: readonly RecordField[]): Buffer {
  const encoded: Buffer[] = [];
  for (const value of fields) {
    const current = field(value);
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(current.length);
    encoded.push(length, current);
  }
  return Buffer.concat(encoded);
}

function lengthPrefixed(parts: readonly Uint8Array[]): Buffer {
  const encoded: Buffer[] = [];
  for (const part of parts) {
    const current = Buffer.from(part);
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(current.length);
    encoded.push(length, current);
  }
  return Buffer.concat(encoded);
}

function canonicalRequest(input: {
  audience: string;
  bodyDigest: string;
  contentType: string;
  deviceId: string;
  idempotencyKey: string;
  method: string;
  nonce: Uint8Array;
  path: string;
  query: readonly [string, string][];
  timestamp: number;
  vaultId: string;
}): Buffer {
  const sortedQuery = [...input.query].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
    return 0;
  });
  return record(
    "sona-request-v1",
    input.audience,
    input.vaultId,
    input.deviceId,
    input.method,
    input.path,
    lengthPrefixed(sortedQuery.map(([key, value]) => record(key, value))),
    input.bodyDigest,
    input.contentType,
    input.idempotencyKey,
    input.timestamp,
    input.nonce,
  );
}

function canonicalUploadEnvelope(input: {
  baseRevisionId: string | null;
  chunks: readonly EnvelopeChunk[];
  cryptoVersion: number;
  kind: "object" | "share";
  manifestDigest: string;
  objectId: string | null;
  revisionId: string | null;
  shareId: string | null;
  totalBytes: number;
  vaultId: string;
}): Buffer {
  return record(
    "sona-upload-envelope-v1",
    input.vaultId,
    input.kind,
    input.objectId ?? "",
    input.revisionId ?? "",
    input.baseRevisionId ?? "",
    input.shareId ?? "",
    input.manifestDigest,
    input.cryptoVersion,
    input.totalBytes,
    input.chunks.length,
    lengthPrefixed(input.chunks.map((chunk) => record(chunk.index, chunk.size, chunk.sha256))),
  );
}

function canonicalTombstone(input: {
  baseRevisionId: string;
  formatVersion: number;
  objectId: string;
  reason: string;
  tombstoneRevisionId: string;
  vaultId: string;
}): Buffer {
  return record(
    "sona-tombstone-v1",
    input.vaultId,
    input.objectId,
    input.tombstoneRevisionId,
    input.baseRevisionId,
    input.reason,
    input.formatVersion,
  );
}

function hkdf(material: Uint8Array, salt: string, info: Uint8Array): Buffer {
  return Buffer.from(hkdfSync("sha256", material, Buffer.from(salt), info, 32));
}

function aesGcmEncrypt(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Buffer {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  return Buffer.concat([Buffer.from(nonce), cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("base64url");
}

function objectAad(input: {
  contentKind: "manifest" | "chunk";
  index: number;
  objectId: string;
  revisionId: string;
  sourceFormat: string;
  total: number;
  vaultId: string;
}): Buffer {
  return record(
    "sona-object-aad-v1",
    input.vaultId,
    input.objectId,
    input.revisionId,
    input.index,
    input.total,
    input.contentKind,
    input.sourceFormat,
  );
}

function objectKeyInfo(input: {
  contentKind: "manifest" | "chunk";
  index: number;
  objectId: string;
  revisionId: string;
  sourceFormat: string;
  total: number;
  vaultId: string;
}): Buffer {
  return record(
    "sona-object-key-v1",
    input.vaultId,
    input.objectId,
    input.revisionId,
    input.index,
    input.total,
    input.contentKind,
    input.sourceFormat,
  );
}

function shareAad(shareId: string, index: number, total: number, domain: "manifest" | "chunk"): Buffer {
  return record("sona-share-aad-v1", shareId, index, total, domain);
}

function shareKeyInfo(shareId: string, index: number, total: number, domain: "manifest" | "chunk"): Buffer {
  return record("sona-share-key-v1", shareId, index, total, domain);
}

const seed = hexBytes("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
const privateKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]),
  format: "der",
  type: "pkcs8",
});
const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
const publicKey = new Uint8Array(publicDer.subarray(-32));

const request = {
  audience: "sona-companion-fixture",
  vaultId: "fixture_vault_0001",
  deviceId: "fixture_device_001",
  method: "POST",
  path: "/v1/uploads/fixture_upload_01/commit",
  query: [["limit", "50"]] satisfies [string, string][],
  bodyDigest: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
  contentType: "application/json",
  idempotencyKey: "fixture_idempotency_01",
  timestamp: 1_700_000_000_000,
  nonce: hexBytes("000102030405060708090a0b0c0d0e0f"),
};
const canonicalRequestRecord = canonicalRequest(request);

const objectRevision = {
  vaultId: "fixture_vault_0001",
  objectId: "fixture_object_0001",
  revisionId: "fixture_revision_01",
  vaultRoot: hexBytes("404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"),
};
const revisionRootInfo = record(
  "sona-revision-root-v1",
  objectRevision.vaultId,
  objectRevision.objectId,
  objectRevision.revisionId,
);
const revisionRoot = hkdf(objectRevision.vaultRoot, "sona-revision-v1", revisionRootInfo);
const objectManifest = {
  ...objectRevision,
  contentKind: "manifest" as const,
  index: 0,
  total: 1,
  sourceFormat: "markdown-utf8",
  nonce: hexBytes("606162636465666768696a6b"),
  plaintext: Buffer.from('{"version":1,"kind":"markdown","source_format":"markdown-utf8","title":"Object fixture"}'),
};
const objectChunk = {
  ...objectRevision,
  contentKind: "chunk" as const,
  index: 0,
  total: 1,
  sourceFormat: "markdown-utf8",
  nonce: hexBytes("707172737475767778797a7b"),
  plaintext: Buffer.from("# Object fixture\n"),
};
const objectManifestKeyInfo = objectKeyInfo(objectManifest);
const objectChunkKeyInfo = objectKeyInfo(objectChunk);
const objectManifestAad = objectAad(objectManifest);
const objectChunkAad = objectAad(objectChunk);
const objectManifestCiphertext = aesGcmEncrypt(
  hkdf(revisionRoot, "sona-object-v1", objectManifestKeyInfo),
  objectManifest.nonce,
  objectManifestAad,
  objectManifest.plaintext,
);
const objectChunkCiphertext = aesGcmEncrypt(
  hkdf(revisionRoot, "sona-object-v1", objectChunkKeyInfo),
  objectChunk.nonce,
  objectChunkAad,
  objectChunk.plaintext,
);

const uploadEnvelope = {
  vaultId: objectRevision.vaultId,
  kind: "object" as const,
  objectId: objectRevision.objectId,
  revisionId: objectRevision.revisionId,
  baseRevisionId: null,
  shareId: null,
  manifestDigest: digest(objectManifestCiphertext),
  cryptoVersion: 1,
  totalBytes: objectChunkCiphertext.length,
  chunks: [{ index: 0, size: objectChunkCiphertext.length, sha256: digest(objectChunkCiphertext) }],
};
const canonicalUpload = canonicalUploadEnvelope(uploadEnvelope);

const tombstone = {
  vaultId: objectRevision.vaultId,
  objectId: objectRevision.objectId,
  tombstoneRevisionId: "fixture_tombstone_01",
  baseRevisionId: objectRevision.revisionId,
  reason: "user_request",
  formatVersion: 1,
};
const canonicalTombstoneRecord = canonicalTombstone(tombstone);

const shareRoot = hexBytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
const shareId = "fixture_share_0001";
const shareManifestPlaintext = Buffer.from(
  JSON.stringify({
    version: 1,
    kind: "markdown",
    source_format: "markdown-utf8",
    title: "Fixture",
    chunk_count: 1,
    plaintext_bytes: 10,
  }),
);
const shareChunkPlaintext = Buffer.from("# Fixture\n");
const shareManifestNonce = hexBytes("202122232425262728292a2b");
const shareChunkNonce = hexBytes("303132333435363738393a3b");
const shareManifestKeyInfo = shareKeyInfo(shareId, 0, 1, "manifest");
const shareChunkKeyInfo = shareKeyInfo(shareId, 0, 1, "chunk");
const shareManifestAad = shareAad(shareId, 0, 1, "manifest");
const shareChunkAad = shareAad(shareId, 0, 1, "chunk");
const shareManifestCiphertext = aesGcmEncrypt(
  hkdf(shareRoot, "sona-share-v1", shareManifestKeyInfo),
  shareManifestNonce,
  shareManifestAad,
  shareManifestPlaintext,
);
const shareChunkCiphertext = aesGcmEncrypt(
  hkdf(shareRoot, "sona-share-v1", shareChunkKeyInfo),
  shareChunkNonce,
  shareChunkAad,
  shareChunkPlaintext,
);

const signed = (message: Uint8Array): string => base64Url(sign(null, message, privateKey));
const fixture = {
  version: 1,
  encoding: {
    aead: "AES-256-GCM",
    hkdf_hash: "SHA-256",
    length_prefix: "u32be",
    payload_layout: "nonce_12_bytes||ciphertext||tag_16_bytes",
    record_fields: "u32be_length_prefixed_utf8_or_raw",
  },
  canonical_request: {
    ...request,
    nonce: base64Url(request.nonce),
    bytes: base64Url(canonicalRequestRecord),
    ed25519_public_key: base64Url(publicKey),
    signature: signed(canonicalRequestRecord),
  },
  upload_envelope: {
    ...uploadEnvelope,
    bytes: base64Url(canonicalUpload),
    ed25519_public_key: base64Url(publicKey),
    signature: signed(canonicalUpload),
  },
  tombstone: {
    ...tombstone,
    bytes: base64Url(canonicalTombstoneRecord),
    ed25519_public_key: base64Url(publicKey),
    signature: signed(canonicalTombstoneRecord),
  },
  object_revision_aes_gcm_hkdf: {
    vault_root: base64Url(objectRevision.vaultRoot),
    vault_id: objectRevision.vaultId,
    object_id: objectRevision.objectId,
    revision_id: objectRevision.revisionId,
    revision_root: base64Url(revisionRoot),
    root_hkdf_info: base64Url(revisionRootInfo),
    manifest: {
      index: objectManifest.index,
      total: objectManifest.total,
      content_kind: objectManifest.contentKind,
      source_format: objectManifest.sourceFormat,
      nonce: base64Url(objectManifest.nonce),
      key_info: base64Url(objectManifestKeyInfo),
      aad: base64Url(objectManifestAad),
      plaintext: base64Url(objectManifest.plaintext),
      ciphertext: base64Url(objectManifestCiphertext),
    },
    chunk: {
      index: objectChunk.index,
      total: objectChunk.total,
      content_kind: objectChunk.contentKind,
      source_format: objectChunk.sourceFormat,
      nonce: base64Url(objectChunk.nonce),
      key_info: base64Url(objectChunkKeyInfo),
      aad: base64Url(objectChunkAad),
      plaintext: base64Url(objectChunk.plaintext),
      ciphertext: base64Url(objectChunkCiphertext),
    },
  },
  share_aes_gcm_hkdf: {
    root: base64Url(shareRoot),
    share_id: shareId,
    hkdf_salt: "sona-share-v1",
    manifest: {
      index: 0,
      total: 1,
      domain: "manifest",
      nonce: base64Url(shareManifestNonce),
      key_info: base64Url(shareManifestKeyInfo),
      aad: base64Url(shareManifestAad),
      plaintext: base64Url(shareManifestPlaintext),
      ciphertext: base64Url(shareManifestCiphertext),
    },
    chunk: {
      index: 0,
      total: 1,
      domain: "chunk",
      nonce: base64Url(shareChunkNonce),
      key_info: base64Url(shareChunkKeyInfo),
      aad: base64Url(shareChunkAad),
      plaintext: base64Url(shareChunkPlaintext),
      ciphertext: base64Url(shareChunkCiphertext),
    },
  },
  expected_failures: {
    canonical_request: { mutated_field: "method", signature_valid: false },
    upload_envelope: { mutated_field: "manifestDigest", signature_valid: false },
    tombstone: { mutated_field: "reason", signature_valid: false },
    object_revision: { mutated_field: "sourceFormat", decrypts: false, truncated_payload_bytes: 27 },
    share: { mutated_field: "domain", decrypts: false, truncated_payload_bytes: 27 },
  },
};

const destination = fileURLToPath(new URL("../fixtures/crypto-v1.json", import.meta.url));
writeFileSync(destination, `${JSON.stringify(fixture, null, 2)}\n`);
