import { afterEach, describe, expect, it, vi } from "vitest";

import fixture from "../fixtures/crypto-v1.json";

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function sha256(value: Uint8Array): Promise<string> {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
}

function requestPath(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.pathname;
  if (input instanceof Request) return new URL(input.url).pathname;
  return new URL(input, location.origin).pathname;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
});

describe("encrypted share viewer", () => {
  it("removes the fragment, decrypts only the share bundle, and renders hostile Markdown as text", async () => {
    const shareId = fixture.share_aes_gcm_hkdf.share_id;
    const root = fixture.share_aes_gcm_hkdf.root;
    const manifest = decodeBase64Url(fixture.share_aes_gcm_hkdf.manifest.ciphertext);
    const chunk = decodeBase64Url(fixture.share_aes_gcm_hkdf.chunk.ciphertext);
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const path = requestPath(input);
      if (path === `/v1/shares/${shareId}/manifest`) {
        return new Response(
          JSON.stringify({
            version: 1,
            share: {
              share_id: shareId,
              crypto_version: 1,
              manifest_sha256: await sha256(manifest),
              chunk_count: 1,
              total_bytes: chunk.length,
              writer_signature: fixture.canonical_request.signature,
            },
            manifest: fixture.share_aes_gcm_hkdf.manifest.ciphertext,
            chunks: [{ index: 0, size: chunk.length, sha256: await sha256(chunk) }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (path === `/v1/shares/${shareId}/chunks/0`) return new Response(chunk);
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = `
      <h1 id="share-title"></h1>
      <p id="status"></p>
      <a id="download-file"></a>
      <article id="markdown-content" hidden></article>
    `;
    history.replaceState(null, "", `/s/${shareId}#v=1&k=${root}`);

    // The module auto-boots, so it must load only after this test installs its DOM and same-origin fetch boundary.
    const viewer = await import("../public/viewer.js?viewer-behavior-test");
    document.dispatchEvent(new Event("DOMContentLoaded"));

    await vi.waitFor(() => expect(document.getElementById("status")?.textContent).toBe("Decrypted in this browser."));

    expect(location.hash).toBe("");
    expect(document.getElementById("share-title")?.textContent).toBe("Fixture");
    expect(document.querySelector("#markdown-content h2")?.textContent).toBe("Fixture");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const content = document.getElementById("markdown-content");
    if (content === null) throw new Error("viewer content element is missing");
    viewer.renderMarkdown(
      content,
      '<img src=x onerror=alert(1)>\n[script](javascript:alert(1))\n[safe](https://example.test/path)',
    );
    expect(content.querySelector("img")).toBeNull();
    expect(content.querySelector("script")).toBeNull();
    expect(content.querySelectorAll("a")).toHaveLength(1);
    expect(content.querySelector("a")?.href).toBe("https://example.test/path");
    expect(content.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(content.textContent).toContain("[script](javascript:alert(1))");
    content.replaceChildren();
    expect(() => viewer.renderMarkdown(content, "x\n".repeat(10_001))).toThrow();
    expect(content.childElementCount).toBe(0);
    expect(() => viewer.parseFragment(`#v=1&k=${root}&k=${root}`)).toThrow();
  });

  it("fails closed on an unexpected bundle field before requesting ciphertext chunks", async () => {
    const shareId = fixture.share_aes_gcm_hkdf.share_id;
    const root = fixture.share_aes_gcm_hkdf.root;
    const manifest = decodeBase64Url(fixture.share_aes_gcm_hkdf.manifest.ciphertext);
    const chunk = decodeBase64Url(fixture.share_aes_gcm_hkdf.chunk.ciphertext);
    const fetchMock = vi.fn(async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          version: 1,
          unexpected: true,
          share: {
            share_id: shareId,
            crypto_version: 1,
            manifest_sha256: await sha256(manifest),
            chunk_count: 1,
            total_bytes: chunk.length,
            writer_signature: fixture.canonical_request.signature,
          },
          manifest: fixture.share_aes_gcm_hkdf.manifest.ciphertext,
          chunks: [{ index: 0, size: chunk.length, sha256: await sha256(chunk) }],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = `
      <h1 id="share-title"></h1>
      <p id="status"></p>
      <a id="download-file"></a>
      <article id="markdown-content" hidden></article>
    `;
    history.replaceState(null, "", `/s/${shareId}#v=1&k=${root}`);

    // This distinct module instance is necessary because the viewer boot runs when its module loads.
    await import("../public/viewer.js?viewer-schema-test");
    document.dispatchEvent(new Event("DOMContentLoaded"));

    await vi.waitFor(() => expect(document.getElementById("status")?.textContent).toBe("This share cannot be opened."));
    expect(document.getElementById("markdown-content")?.hasAttribute("hidden")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
