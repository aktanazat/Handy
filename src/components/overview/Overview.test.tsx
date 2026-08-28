import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { Overview } from "./Overview";

/* First paint of the page, before any effect has run: what someone sees in the
 * moment between opening Capture and the history reads landing. The names
 * asserted here are the ones the shell, the command palette and the
 * end-to-end suite look up.
 *
 * Inline resources initialise synchronously, so no beforeAll hook is needed
 * (the repo's bun:test shim declares neither hooks nor `expect().not`). */

const localeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

/* @tauri-apps/plugin-os reads its platform off a window global that the Tauri
 * runtime injects. Static rendering has no window, so the hero's keycap
 * formatting would throw before it could be inspected. */
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { __TAURI_OS_PLUGIN_INTERNALS__: { os_type: "macos" } },
});

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeRoot, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const markup = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <Overview />
  </I18nextProvider>,
);

describe("Overview first paint", () => {
  test("keeps the hero status heading and both primary actions", () => {
    expect(markup).toContain('id="overview-status"');
    expect(markup).toContain("Ready");
    expect(markup).toContain("New meeting");
    expect(markup).toContain("Import audio");
  });

  test("says the shortcut is missing instead of showing empty keycaps", () => {
    expect(markup).toContain("Shortcut unavailable");
  });

  test("loads behind placeholders, with no update banner and no numbers", () => {
    expect(markup).toContain("ui-skeleton");
    expect(markup.includes("is available. This install is on")).toBe(false);
    expect(markup.includes("Could not check for updates")).toBe(false);
    expect(markup.includes("ov-stat-value")).toBe(false);
  });
});
