import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { UpdateCheckResult } from "@/lib/updateCheck";
import { UpdateBanner, UpdateCheckFailure } from "./UpdateNotice";

const localeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

/* Inline resources initialise synchronously, so no beforeAll hook is needed
 * (the repo's bun:test shim declares neither hooks nor `expect().not`). */
const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeRoot, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const render = (node: React.ReactElement): string =>
  renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

const available: UpdateCheckResult = {
  current_version: "1.0.0",
  latest_version: "1.1.0",
  update_available: true,
  url: "https://github.com/aktanazat/Handy/releases/tag/v1.1.0",
  notes_excerpt: "Faster model loading.",
  published_at_utc_ms: 1_756_000_000_000,
  status: "update_available",
  error: null,
};

const failed: UpdateCheckResult = {
  current_version: "1.0.0",
  latest_version: null,
  update_available: false,
  url: null,
  notes_excerpt: null,
  published_at_utc_ms: null,
  status: "check_failed",
  error: "network unreachable",
};

describe("UpdateBanner", () => {
  test("names both versions and offers the release plus a dismiss", () => {
    const markup = render(
      <UpdateBanner result={available} onDismiss={() => {}} />,
    );

    expect(markup).toContain("Sona 1.1.0 is available");
    expect(markup).toContain("This install is on 1.0.0");
    expect(markup).toContain("View release");
    expect(markup).toContain('aria-label="Dismiss"');
  });

  test("drops the release control when the payload carries no url", () => {
    const markup = render(
      <UpdateBanner
        result={{ ...available, url: null }}
        onDismiss={() => {}}
      />,
    );

    expect(markup.includes("View release")).toBe(false);
    expect(markup).toContain('aria-label="Dismiss"');
  });
});

describe("UpdateCheckFailure", () => {
  test("stays quiet, repeats the backend reason and keeps a retry", () => {
    const markup = render(
      <UpdateCheckFailure
        result={failed}
        onRetry={() => {}}
        retrying={false}
      />,
    );

    expect(markup).toContain(
      "Could not check for updates: network unreachable",
    );
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Retry");
    expect(markup.includes('disabled=""')).toBe(false);
  });

  test("falls back to a plain sentence with no reason, and locks while rechecking", () => {
    const markup = render(
      <UpdateCheckFailure
        result={{ ...failed, error: null }}
        onRetry={() => {}}
        retrying={true}
      />,
    );

    expect(markup).toContain("Could not check for updates.");
    expect(markup).toContain('disabled=""');
  });
});
