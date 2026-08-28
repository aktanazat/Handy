import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  bootstrap,
  createUploadPayload,
  makeDevice,
  signedFetch,
  testId,
  uploadAllChunks,
  type Device,
} from "./helpers";

async function activeShare(device: Device): Promise<{ shareId: string; uploadId: string }> {
  const shareId = testId("share");
  const payload = await createUploadPayload(device, { shareId });
  const created = await signedFetch(device, {
    method: "POST",
    path: "/v1/shares",
    body: JSON.stringify(payload.json),
    idempotencyKey: testId("share_create"),
  });
  expect(created.status).toBe(201);
  const uploadId = String(payload.json.uploadId);
  await uploadAllChunks(device, uploadId, payload.chunks);
  const committed = await signedFetch(device, {
    method: "POST",
    path: `/v1/uploads/${uploadId}/commit`,
    body: JSON.stringify({ version: 1 }),
    idempotencyKey: testId("share_commit"),
  });
  expect(committed.status).toBe(200);
  return { shareId, uploadId };
}

describe("public encrypted shares", () => {
  it("serves the static viewer with a locked CSP and active encrypted share routes", async () => {
    const device = await makeDevice();
    await bootstrap(device);
    const { shareId } = await activeShare(device);

    const page = await SELF.fetch(`https://companion.test/s/${shareId}`);
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("manifest-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    await expect(page.text()).resolves.toContain('src="/viewer.js"');

    const viewerScript = await SELF.fetch("https://companion.test/viewer.js");
    const viewerStyle = await SELF.fetch("https://companion.test/viewer.css");
    expect(viewerScript.status).toBe(200);
    expect(viewerStyle.status).toBe(200);

    const manifest = await SELF.fetch(`https://companion.test/v1/shares/${shareId}/manifest`);
    const chunk = await SELF.fetch(`https://companion.test/v1/shares/${shareId}/chunks/0`);
    const file = await SELF.fetch(`https://companion.test/v1/shares/${shareId}/file`);
    expect(manifest.status).toBe(200);
    expect(chunk.status).toBe(200);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/vnd.sona.encrypted-share");

    const query = await SELF.fetch(`https://companion.test/v1/shares/${shareId}/manifest?unexpected=1`);
    const nonGet = await SELF.fetch(`https://companion.test/v1/shares/${shareId}/manifest`, { method: "POST" });
    expect(query.status).toBe(400);
    expect(nonGet.status).toBe(404);
  });

  it("revokes public endpoints without exposing a stale share", async () => {
    const device = await makeDevice();
    await bootstrap(device);
    const { shareId } = await activeShare(device);
    const revoked = await signedFetch(device, {
      method: "DELETE",
      path: `/v1/shares/${shareId}`,
      body: JSON.stringify({ version: 1 }),
      idempotencyKey: testId("share_revoke"),
    });
    expect(revoked.status).toBe(200);

    const responses = await Promise.all([
      SELF.fetch(`https://companion.test/v1/shares/${shareId}/manifest`),
      SELF.fetch(`https://companion.test/v1/shares/${shareId}/chunks/0`),
      SELF.fetch(`https://companion.test/v1/shares/${shareId}/file`),
    ]);
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404]);
  });
});
