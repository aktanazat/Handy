import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { logMaintenance, logRequest } from "../src/errors";

describe("allowlisted observability", () => {
  it("never emits sensitive request or encrypted-content canaries", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const forbidden = [
        "vault_canary_0123456789",
        "object_canary_0123456789",
        "revision_canary_0123456789",
        "share_canary_0123456789",
        "https://secret.example/path?token=canary",
        "ciphertext_canary_bytes",
        "digest_canary_value",
        "secret_canary_value",
      ];

      logRequest(
        env,
        {
          requestId: "request-canary",
          route: "object_manifest",
          startedAt: Date.now(),
        },
        422,
        { dependency: "r2", error: "integrity_failed" },
      );
      logMaintenance(env, "cleanup_object", 503, "dependency_unavailable");

      const events = log.mock.calls.map(([value]) => String(value));
      for (const event of events) {
        for (const canary of forbidden) expect(event).not.toContain(canary);
      }
      expect(events).toHaveLength(2);
      expect(Object.keys(JSON.parse(events[0] ?? "{}"))).toEqual(
        expect.arrayContaining([
          "request_id",
          "route",
          "status",
          "latency_bucket",
          "worker_version",
          "dependency",
          "error",
        ]),
      );
      expect(Object.keys(JSON.parse(events[1] ?? "{}"))).toEqual(
        expect.arrayContaining([
          "request_id",
          "route",
          "status",
          "latency_bucket",
          "worker_version",
          "maintenance_class",
          "error",
        ]),
      );
    } finally {
      log.mockRestore();
    }
  });
});
