import { describe, expect, it } from "vitest";

import fixture from "../fixtures/crypto-v1.json";
import {
  canonicalRequestBytes,
  canonicalTombstoneBytes,
  canonicalUploadEnvelopeBytes,
  decryptObjectRevisionPayload,
  decryptSharePayload,
  deriveObjectRevisionRoot,
  encryptObjectRevisionPayload,
  encryptSharePayload,
  verifyEd25519,
} from "../src/crypto";
import type { CanonicalUploadEnvelopeInput } from "../src/crypto";
import { base64UrlDecode, base64UrlEncode } from "../src/encoding";

function fixtureBytes(value: string): Uint8Array {
  const bytes = base64UrlDecode(value);
  if (bytes === null) throw new Error("fixture is not canonical base64url");
  return bytes;
}

function objectContentKind(value: string): "manifest" | "chunk" {
  if (value === "manifest" || value === "chunk") return value;
  throw new Error("fixture object content kind is invalid");
}

function shareDomain(value: string): "manifest" | "chunk" {
  if (value === "manifest" || value === "chunk") return value;
  throw new Error("fixture share domain is invalid");
}

describe("frozen crypto fixtures", () => {
  it("matches canonical request bytes and rejects a signed-field mutation", async () => {
    const request = fixture.canonical_request;
    const input = {
      audience: request.audience,
      vaultId: request.vaultId,
      deviceId: request.deviceId,
      method: request.method,
      path: request.path,
      query: request.query.map((pair): [string, string] => {
        const [key, value] = pair;
        if (key === undefined || value === undefined) throw new Error("fixture request query is invalid");
        return [key, value];
      }),
      bodyDigest: request.bodyDigest,
      contentType: request.contentType,
      idempotencyKey: request.idempotencyKey,
      timestamp: request.timestamp,
      nonce: fixtureBytes(request.nonce),
    };
    const bytes = canonicalRequestBytes(input);
    const publicKey = fixtureBytes(request.ed25519_public_key);
    const signature = fixtureBytes(request.signature);

    expect(base64UrlEncode(bytes)).toBe(request.bytes);
    await expect(verifyEd25519(publicKey, signature, bytes)).resolves.toBe(true);
    await expect(verifyEd25519(publicKey, signature, canonicalRequestBytes({ ...input, method: "GET" }))).resolves.toBe(
      false,
    );
  });

  it("matches canonical upload and tombstone signatures and rejects field mutation", async () => {
    const upload = fixture.upload_envelope;
    if (upload.kind !== "object" && upload.kind !== "share") {
      throw new Error("fixture upload kind is invalid");
    }
    const uploadInput: CanonicalUploadEnvelopeInput = {
      vaultId: upload.vaultId,
      kind: upload.kind,
      objectId: upload.objectId,
      revisionId: upload.revisionId,
      baseRevisionId: upload.baseRevisionId,
      shareId: upload.shareId,
      manifestDigest: upload.manifestDigest,
      cryptoVersion: upload.cryptoVersion,
      totalBytes: upload.totalBytes,
      chunks: upload.chunks,
    };
    const uploadBytes = canonicalUploadEnvelopeBytes(uploadInput);
    const uploadKey = fixtureBytes(upload.ed25519_public_key);
    const uploadSignature = fixtureBytes(upload.signature);

    expect(base64UrlEncode(uploadBytes)).toBe(upload.bytes);
    await expect(verifyEd25519(uploadKey, uploadSignature, uploadBytes)).resolves.toBe(true);
    await expect(
      verifyEd25519(
        uploadKey,
        uploadSignature,
        canonicalUploadEnvelopeBytes({ ...uploadInput, manifestDigest: `${upload.manifestDigest}x` }),
      ),
    ).resolves.toBe(false);

    const tombstone = fixture.tombstone;
    const tombstoneBytes = canonicalTombstoneBytes(tombstone);
    const tombstoneKey = fixtureBytes(tombstone.ed25519_public_key);
    const tombstoneSignature = fixtureBytes(tombstone.signature);

    expect(base64UrlEncode(tombstoneBytes)).toBe(tombstone.bytes);
    await expect(verifyEd25519(tombstoneKey, tombstoneSignature, tombstoneBytes)).resolves.toBe(true);
    await expect(
      verifyEd25519(
        tombstoneKey,
        tombstoneSignature,
        canonicalTombstoneBytes({ ...tombstone, reason: "retention" }),
      ),
    ).resolves.toBe(false);
  });

  it("derives and authenticates object revision manifest and chunks", async () => {
    const vector = fixture.object_revision_aes_gcm_hkdf;
    const vaultRoot = fixtureBytes(vector.vault_root);
    const revisionRoot = await deriveObjectRevisionRoot({
      vaultRoot,
      vaultId: vector.vault_id,
      objectId: vector.object_id,
      revisionId: vector.revision_id,
    });
    expect(base64UrlEncode(revisionRoot)).toBe(vector.revision_root);

    for (const payload of [vector.manifest, vector.chunk]) {
      const context = {
        vaultRoot,
        vaultId: vector.vault_id,
        objectId: vector.object_id,
        revisionId: vector.revision_id,
        index: payload.index,
        total: payload.total,
        contentKind: objectContentKind(payload.content_kind),
        sourceFormat: payload.source_format,
      };
      const ciphertext = fixtureBytes(payload.ciphertext);
      const decrypted = await decryptObjectRevisionPayload({ ...context, ciphertext });

      expect(base64UrlEncode(decrypted)).toBe(payload.plaintext);
      await expect(
        encryptObjectRevisionPayload({ ...context, nonce: fixtureBytes(payload.nonce), plaintext: decrypted }),
      ).resolves.toEqual(ciphertext);
      await expect(
        decryptObjectRevisionPayload({ ...context, ciphertext, sourceFormat: `${payload.source_format}-altered` }),
      ).rejects.toThrow();
    }

    const manifest = vector.manifest;
    await expect(
      decryptObjectRevisionPayload({
        vaultRoot,
        vaultId: vector.vault_id,
        objectId: vector.object_id,
        revisionId: vector.revision_id,
        index: manifest.index,
        total: manifest.total,
        contentKind: objectContentKind(manifest.content_kind),
        sourceFormat: manifest.source_format,
        ciphertext: fixtureBytes(manifest.ciphertext).subarray(0, fixture.expected_failures.object_revision.truncated_payload_bytes),
      }),
    ).rejects.toThrow();
  });

  it("matches share AES-GCM/HKDF payloads and rejects altered authenticated data", async () => {
    const vector = fixture.share_aes_gcm_hkdf;
    const root = fixtureBytes(vector.root);
    for (const payload of [vector.manifest, vector.chunk]) {
      const domain = shareDomain(payload.domain);
      const ciphertext = fixtureBytes(payload.ciphertext);
      const decrypted = await decryptSharePayload({
        root,
        shareId: vector.share_id,
        index: payload.index,
        total: payload.total,
        domain,
        ciphertext,
      });

      expect(base64UrlEncode(decrypted)).toBe(payload.plaintext);
      await expect(
        encryptSharePayload({
          root,
          shareId: vector.share_id,
          index: payload.index,
          total: payload.total,
          domain,
          nonce: fixtureBytes(payload.nonce),
          plaintext: decrypted,
        }),
      ).resolves.toEqual(ciphertext);
      await expect(
        decryptSharePayload({
          root,
          shareId: vector.share_id,
          index: payload.index,
          total: payload.total,
          domain: domain === "manifest" ? "chunk" : "manifest",
          ciphertext,
        }),
      ).rejects.toThrow();
    }

    const manifest = vector.manifest;
    await expect(
      decryptSharePayload({
        root,
        shareId: vector.share_id,
        index: manifest.index,
        total: manifest.total,
        domain: shareDomain(manifest.domain),
        ciphertext: fixtureBytes(manifest.ciphertext).subarray(0, fixture.expected_failures.share.truncated_payload_bytes),
      }),
    ).rejects.toThrow();
  });
});
