import { describe, expect, test } from "bun:test";
import {
  isRetryableCloudState,
  parseCloudPairingOffer,
  toCloudShareExpiryUtcMs,
  toLocalDateTimeValue,
} from "./cloudSync";

const offer = {
  protocol_version: 1,
  vault_id: "vault-1",
  device_id: "device-1",
  signing_public_key: "signing-key",
  pairing_public_key: "pairing-key",
  candidate_proof: "proof",
  pairing_nonce: "nonce",
  expires_at_utc_ms: 1_800_000_000_000,
  fingerprint: "fingerprint",
};

describe("parseCloudPairingOffer", () => {
  test("keeps a complete generated offer intact", () => {
    expect(parseCloudPairingOffer(JSON.stringify(offer))).toEqual(offer);
  });

  test("rejects malformed and incomplete offers", () => {
    expect(parseCloudPairingOffer("not json")).toBeNull();
    expect(
      parseCloudPairingOffer(JSON.stringify({ ...offer, pairing_nonce: "" })),
    ).toBeNull();
    expect(
      parseCloudPairingOffer(
        JSON.stringify({ ...offer, protocol_version: "1" }),
      ),
    ).toBeNull();
  });
});

describe("isRetryableCloudState", () => {
  test("only exposes retry for terminal sync states", () => {
    expect(isRetryableCloudState("auth_required")).toBe(true);
    expect(isRetryableCloudState("quota")).toBe(true);
    expect(isRetryableCloudState("integrity_failure")).toBe(true);
    expect(isRetryableCloudState("uploading")).toBe(false);
    expect(isRetryableCloudState("conflict")).toBe(false);
  });
});

describe("share expiry helpers", () => {
  test("formats local datetime controls without a UTC shift", () => {
    expect(toLocalDateTimeValue(new Date(2026, 0, 2, 3, 4))).toBe(
      "2026-01-02T03:04",
    );
  });

  test("accepts a future expiry and rejects an invalid value", () => {
    const future = toLocalDateTimeValue(
      new Date(Date.now() + 2 * 60 * 60 * 1000),
    );
    expect(toCloudShareExpiryUtcMs(future)).toBeDefined();
    expect(toCloudShareExpiryUtcMs("invalid")).toBeNull();
  });
});
