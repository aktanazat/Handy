/**
 * A local stand-in for the companion Worker, used to smoke the phone end to end.
 *
 * It imports the real `cloudflare/sona-companion/src/crypto.ts`, so the phone's Swift
 * records and signatures are checked against the same authority the Worker uses. It also
 * plays the approving Mac on `POST /v1/devices/pair`: it seals the pairing envelope with
 * a fixed vault root so the smoke can decrypt what the phone uploaded.
 *
 * Run: bun mobile/scripts/stub-worker.ts --port 8787 --out /tmp/stub-worker.json
 */
import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { writeFileSync } from "node:fs";
import { z } from "zod";

import {
  canonicalPairCandidateBytes,
  canonicalRequestBytes,
  canonicalUploadEnvelopeBytes,
  decryptObjectRevisionPayload,
  verifyEd25519,
} from "../../cloudflare/sona-companion/src/crypto";
import {
  base64UrlDecode,
  base64UrlEncode,
  sha256Base64Url,
  utf8,
} from "../../cloudflare/sona-companion/src/encoding";

const argument = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
};

const port = Number(argument("port", "8787"));
const outPath = argument("out", "/tmp/stub-worker.json");
const vaultId = argument("vault", "stub_vault_00000001");
const vaultRoot = new Uint8Array(32).fill(7);

interface Device {
  deviceId: string;
  envelope: Uint8Array;
  pairingPublicKey: Uint8Array;
  signingPublicKey: Uint8Array;
}

const plannedChunk = z.object({
  index: z.number().int(),
  sha256: z.string(),
  size: z.number().int(),
});
type PlannedChunk = z.infer<typeof plannedChunk>;

/* The three JSON bodies the phone sends, read at the door. The Worker's
 * `assertExactKeys` rejects any plan key outside the set, which is what
 * `.strict()` says here. */
const pairingOffer = z
  .object({
    candidate_proof: z.string(),
    device_id: z.string(),
    expires_at_utc_ms: z.number(),
    fingerprint: z.string(),
    pairing_nonce: z.string(),
    pairing_public_key: z.string(),
    signing_public_key: z.string(),
    vault_id: z.string(),
  })
  .passthrough();
const uploadPlan = z
  .object({
    baseRevisionId: z.string().nullable().optional(),
    chunkCount: z.number().int(),
    chunks: z.array(plannedChunk),
    cryptoVersion: z.number(),
    manifest: z.string(),
    manifestSha256: z.string(),
    objectId: z.string(),
    revisionId: z.string(),
    totalBytes: z.number().int(),
    uploadId: z.string(),
    version: z.number(),
    writerSignature: z.string(),
  })
  .strict();
const deviceRecordingManifest = z.object({
  audio: z.object({
    byte_length: z.number().int(),
    channels: z.number().int(),
    codec: z.string(),
    sample_rate_hz: z.number().int(),
    sha256: z.string(),
  }),
  device_id: z.string(),
  duration_ms: z.number(),
  format_version: z.literal(1),
  kind: z.literal("device_recording"),
  recorded_at_utc_ms: z.number(),
  title: z.string(),
});

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
type StubEvent = { kind: string } & Record<string, JsonValue>;

interface Session {
  chunks: Map<number, Uint8Array>;
  manifest: Uint8Array;
  objectId: string;
  plan: PlannedChunk[];
  revisionId: string;
  uploadId: string;
}

const devices = new Map<string, Device>();
const sessions = new Map<string, Session>();
const events: (StubEvent & { at: string })[] = [];

function record(event: StubEvent): void {
  events.push({ at: new Date().toISOString(), ...event });
  writeFileSync(outPath, JSON.stringify(events, null, 2));
  console.log(JSON.stringify(event));
}

function json(value: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

function problem(code: string, status: number): Response {
  record({ kind: "refused", code, status });
  return json({ code, request_id: "stub", retryable: false }, status);
}

async function authenticate(
  request: Request,
  body: Uint8Array,
): Promise<Device | null> {
  const vault = request.headers.get("x-sona-vault-id") ?? "";
  const deviceId = request.headers.get("x-sona-device-id") ?? "";
  const timestamp = request.headers.get("x-sona-timestamp") ?? "";
  const nonce = base64UrlDecode(request.headers.get("x-sona-nonce") ?? "");
  const signature = base64UrlDecode(
    request.headers.get("x-sona-signature") ?? "",
  );
  const device = devices.get(deviceId);
  if (
    vault !== vaultId ||
    device === undefined ||
    nonce === null ||
    signature === null ||
    !/^\d{13}$/u.test(timestamp)
  ) {
    return null;
  }
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return null;
  const url = new URL(request.url);
  const query: [string, string][] = [];
  url.searchParams.forEach((value, key) => query.push([key, value]));
  const canonical = canonicalRequestBytes({
    audience: "sona-companion",
    vaultId: vault,
    deviceId,
    method: request.method,
    path: url.pathname,
    query,
    bodyDigest: await sha256Base64Url(body),
    contentType: request.headers.get("content-type") ?? "",
    idempotencyKey: request.headers.get("x-sona-idempotency-key") ?? "",
    timestamp: Number(timestamp),
    nonce,
  });
  const valid = await verifyEd25519(
    device.signingPublicKey,
    signature,
    canonical,
  );
  return valid ? device : null;
}

/** The approving Mac's half: verify the candidate proof, seal the vault root to it. */
function sealPairingEnvelope(recipientPublicKey: Uint8Array): Uint8Array {
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralPublicKey = new Uint8Array(
    ephemeral.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  );
  const recipient = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b656e032100", "hex"),
      Buffer.from(recipientPublicKey),
    ]),
    format: "der",
    type: "spki",
  });
  const shared = new Uint8Array(
    diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient }),
  );
  const key = new Uint8Array(
    hkdfSync(
      "sha256",
      shared,
      utf8("sona-pairing-envelope-v1"),
      lengthPrefixed([
        utf8("sona-pairing-envelope-key-v1"),
        recipientPublicKey,
        ephemeralPublicKey,
      ]),
      32,
    ),
  );
  const nonce = new Uint8Array(randomBytes(12));
  const aad = lengthPrefixed([
    utf8("sona-pairing-envelope-aad-v1"),
    utf8("1"),
    recipientPublicKey,
    ephemeralPublicKey,
    nonce,
  ]);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(vaultRoot)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return lengthPrefixed([
    utf8("sona-pairing-envelope-v1"),
    utf8("1"),
    ephemeralPublicKey,
    nonce,
    new Uint8Array(ciphertext),
  ]);
}

function lengthPrefixed(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length + 4, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    new DataView(out.buffer).setUint32(offset, part.length, false);
    offset += 4;
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function pairDevice(body: Uint8Array): Promise<Response> {
  const parsed = pairingOffer.safeParse(
    JSON.parse(new TextDecoder().decode(body)),
  );
  if (!parsed.success) return problem("invalid_request", 400);
  const offer = parsed.data;
  const signingPublicKey = base64UrlDecode(offer.signing_public_key);
  const pairingPublicKey = base64UrlDecode(offer.pairing_public_key);
  const proof = base64UrlDecode(offer.candidate_proof);
  const pairingNonce = base64UrlDecode(offer.pairing_nonce);
  if (
    signingPublicKey === null ||
    pairingPublicKey === null ||
    proof === null ||
    pairingNonce === null ||
    offer.vault_id !== vaultId
  ) {
    return problem("invalid_request", 400);
  }
  const candidateRecord = canonicalPairCandidateBytes({
    audience: "sona-companion",
    vaultId,
    candidateDeviceId: String(offer.device_id),
    candidateSigningPublicKey: signingPublicKey,
    candidatePairingPublicKey: pairingPublicKey,
    pairingNonce,
    expiresAt: Number(offer.expires_at_utc_ms),
  });
  if (!(await verifyEd25519(signingPublicKey, proof, candidateRecord))) {
    return problem("integrity_failed", 422);
  }
  if (Number(offer.expires_at_utc_ms) <= Date.now()) {
    return problem("invalid_request", 400);
  }
  devices.set(String(offer.device_id), {
    deviceId: String(offer.device_id),
    signingPublicKey,
    pairingPublicKey,
    envelope: sealPairingEnvelope(pairingPublicKey),
  });
  record({
    kind: "paired",
    device_id: offer.device_id,
    fingerprint: offer.fingerprint,
    candidate_proof_verified: true,
  });
  return json({ device_id: offer.device_id, status: "active" });
}

async function createUpload(
  device: Device,
  body: Uint8Array,
): Promise<Response> {
  const parsed = uploadPlan.safeParse(
    JSON.parse(new TextDecoder().decode(body)),
  );
  if (!parsed.success) return problem("invalid_request", 400);
  const plan = parsed.data;
  if (plan.version !== 1 || plan.cryptoVersion !== 1) {
    return problem("unsupported_version", 400);
  }
  const manifest = base64UrlDecode(plan.manifest);
  const signature = base64UrlDecode(plan.writerSignature);
  const chunks = plan.chunks;
  if (manifest === null || signature === null) {
    return problem("invalid_request", 400);
  }
  const manifestDigest = await sha256Base64Url(manifest);
  if (manifestDigest !== plan.manifestSha256) {
    return problem("integrity_failed", 422);
  }
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
  if (totalBytes !== plan.totalBytes || chunks.length !== plan.chunkCount) {
    return problem("invalid_request", 400);
  }
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.index !== index) return problem("invalid_request", 400);
    if (chunk.size < 28 || chunk.size > 4 * 1024 * 1024) {
      return problem("invalid_request", 400);
    }
    if (
      chunks.length > 1 &&
      index < chunks.length - 1 &&
      chunk.size !== 4 * 1024 * 1024
    ) {
      return problem("invalid_request", 400);
    }
  }
  const envelope = canonicalUploadEnvelopeBytes({
    vaultId,
    kind: "object",
    objectId: plan.objectId,
    revisionId: plan.revisionId,
    baseRevisionId: plan.baseRevisionId ?? null,
    shareId: null,
    manifestDigest,
    cryptoVersion: 1,
    totalBytes,
    chunks: chunks.map((chunk) => ({
      index: chunk.index,
      size: chunk.size,
      sha256: chunk.sha256,
    })),
  });
  if (!(await verifyEd25519(device.signingPublicKey, signature, envelope))) {
    return problem("integrity_failed", 422);
  }
  sessions.set(plan.uploadId, {
    uploadId: plan.uploadId,
    objectId: plan.objectId,
    revisionId: plan.revisionId,
    manifest,
    plan: chunks,
    chunks: new Map(),
  });
  record({
    kind: "upload_created",
    upload_id: plan.uploadId,
    object_id: plan.objectId,
    revision_id: plan.revisionId,
    chunk_count: chunks.length,
    total_bytes: totalBytes,
    writer_signature_verified: true,
  });
  return json({
    upload_id: plan.uploadId,
    state: "active",
    accepted_indexes: [],
  });
}

async function putChunk(
  uploadId: string,
  index: number,
  body: Uint8Array,
  digestHeader: string,
): Promise<Response> {
  const session = sessions.get(uploadId);
  const expected = session?.plan[index];
  if (session === undefined || expected === undefined) {
    return problem("not_found", 404);
  }
  const digest = await sha256Base64Url(body);
  if (digest !== digestHeader || digest !== expected.sha256) {
    return problem("integrity_failed", 422);
  }
  if (body.length !== expected.size) return problem("invalid_request", 400);
  session.chunks.set(index, body);
  record({
    kind: "chunk_stored",
    upload_id: uploadId,
    index,
    size: body.length,
  });
  return json({ upload_id: uploadId, index, accepted: true });
}

/**
 * Commit is where the smoke earns its keep: the stub opens the manifest and the audio
 * with the vault root it handed the phone during pairing, and checks the digest the
 * manifest claims over the plaintext audio.
 */
async function commitUpload(uploadId: string): Promise<Response> {
  const session = sessions.get(uploadId);
  if (session === undefined) return problem("not_found", 404);
  if (session.chunks.size !== session.plan.length) {
    return problem("upload_incomplete", 409);
  }
  const total = session.plan.length;
  const manifestPlaintext = await decryptObjectRevisionPayload({
    vaultId,
    objectId: session.objectId,
    revisionId: session.revisionId,
    index: 0,
    total,
    contentKind: "manifest",
    sourceFormat: "sona-device-recording-v1",
    ciphertext: session.manifest,
    vaultRoot,
  });
  const parsedManifest = deviceRecordingManifest.safeParse(
    JSON.parse(new TextDecoder().decode(manifestPlaintext)),
  );
  if (!parsedManifest.success) return problem("integrity_failed", 422);
  const manifest = parsedManifest.data;
  const audio: Uint8Array[] = [];
  for (let index = 0; index < total; index += 1) {
    const ciphertext = session.chunks.get(index);
    if (ciphertext === undefined) return problem("upload_incomplete", 409);
    audio.push(
      await decryptObjectRevisionPayload({
        vaultId,
        objectId: session.objectId,
        revisionId: session.revisionId,
        index,
        total,
        contentKind: "chunk",
        sourceFormat: "sona-device-recording-v1",
        ciphertext,
        vaultRoot,
      }),
    );
  }
  const plaintextLength = audio.reduce((sum, part) => sum + part.length, 0);
  const plaintext = new Uint8Array(plaintextLength);
  let offset = 0;
  for (const part of audio) {
    plaintext.set(part, offset);
    offset += part.length;
  }
  record({
    kind: "committed",
    upload_id: uploadId,
    object_id: session.objectId,
    revision_id: session.revisionId,
    manifest,
    decrypted_audio_bytes: plaintextLength,
    audio_digest_matches:
      (await sha256Base64Url(plaintext)) === manifest.audio.sha256,
    audio_length_matches: plaintextLength === manifest.audio.byte_length,
  });
  return json({
    upload_id: uploadId,
    state: "committed",
    revision_id: session.revisionId,
    change_sequence: events.length,
  });
}

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    const body = new Uint8Array(await request.arrayBuffer());
    if (url.pathname === "/healthz") return json({ status: "ok" });
    if (url.pathname === "/v1/devices/pair" && request.method === "POST") {
      return pairDevice(body);
    }
    const device = await authenticate(request, body);
    if (device === null) return problem("unauthorized", 401);
    if (url.pathname === "/v1/devices/self") {
      return json({
        device_id: device.deviceId,
        signing_public_key: base64UrlEncode(device.signingPublicKey),
        pairing_public_key: base64UrlEncode(device.pairingPublicKey),
        status: "active",
        envelope: base64UrlEncode(device.envelope),
        protocol_version: 1,
      });
    }
    if (url.pathname === "/v1/uploads" && request.method === "POST") {
      return createUpload(device, body);
    }
    const chunk = /^\/v1\/uploads\/([^/]+)\/chunks\/(\d+)$/u.exec(url.pathname);
    if (chunk !== null && request.method === "PUT") {
      return putChunk(
        chunk[1] ?? "",
        Number(chunk[2]),
        body,
        request.headers.get("x-sona-chunk-sha256") ?? "",
      );
    }
    const commit = /^\/v1\/uploads\/([^/]+)\/commit$/u.exec(url.pathname);
    if (commit !== null && request.method === "POST") {
      return commitUpload(commit[1] ?? "");
    }
    return problem("not_found", 404);
  },
});

writeFileSync(outPath, "[]");
console.log(`stub worker on http://127.0.0.1:${port} vault=${vaultId}`);
