import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createInstance } from "i18next";
import type { CloudSyncServiceStatus } from "@/bindings";
import { cloudSyncFact } from "./PrivacyEgress";

/* The chip is a measurement slot: a label, then one short value. Every
 * CloudSyncErrorKind is a full sentence — "Cloud sync is unavailable in
 * portable mode." — so putting the error there printed a paragraph beside the
 * word "Cloud sync". The fact answers with the state word and the notice below
 * carries the sentence.
 *
 * Built against the shipped English catalogue rather than a fixture, because a
 * renamed key renders as a raw dotted string to the user and nothing else in
 * the build notices. */

const catalogue = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "i18n",
      "locales",
      "en",
      "translation.json",
    ),
    "utf8",
  ),
);

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: catalogue } },
  interpolation: { escapeValue: false },
  parseMissingKeyHandler: () => "__MISSING__",
});

const status = (
  overrides: Partial<CloudSyncServiceStatus>,
): CloudSyncServiceStatus => ({
  configured: false,
  endpoint: null,
  error: null,
  reason: "",
  ...overrides,
});

describe("the cloud sync fact", () => {
  test("answers an unavailable route with a state word, not its sentence", () => {
    const fact = cloudSyncFact(
      status({ error: "portable_unavailable" }),
      i18n.t,
    );

    expect(fact).toBe("Unavailable");
    expect(fact).not.toContain("portable mode");
    expect(fact).not.toContain("__MISSING__");
  });

  test("names the endpoint it would reach once sync is configured", () => {
    expect(
      cloudSyncFact(
        status({ configured: true, endpoint: "https://sync.example" }),
        i18n.t,
      ),
    ).toBe("https://sync.example");
    expect(cloudSyncFact(status({ configured: true }), i18n.t)).toBe(
      "Configured",
    );
  });

  test("separates a status it has not read yet from one that is off", () => {
    expect(cloudSyncFact(null, i18n.t)).toBe("…");
    expect(cloudSyncFact(status({}), i18n.t)).toBe("Not configured");
  });
});
