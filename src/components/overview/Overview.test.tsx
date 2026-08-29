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

  /* The meeting promise is a product commitment the wave was asked to make
   * self-evident, so it is asserted as copy rather than as markup. */
  test("states what a meeting recording does, beside the button that does it", () => {
    expect(markup).toContain("ov-hero-action");
    expect(markup).toContain(
      "Records your Mac&#x27;s audio locally. Nothing joins the call.",
    );
  });

  /* The gesture sentence describes the chord. With no chord bound there is no
   * gesture to describe, and printing one would claim a capability the install
   * does not have — the same class of lie as the old unconditional hint line. */
  test("claims no gesture while no shortcut is bound", () => {
    expect(markup.includes("Tap to toggle")).toBe(false);
    expect(markup).toContain("Set a shortcut");
    expect(markup).toContain('data-testid="overview-shortcut"');
  });

  test("renders the instrument strip with all four labelled cells", () => {
    expect(markup).toContain('aria-label="Capture instrument"');
    for (const cell of ["engine", "input", "shortcut", "mode"]) {
      expect(markup).toContain(`data-cell="${cell}"`);
    }
    expect(markup).toContain(">Engine</dt>");
    expect(markup).toContain(">Input</dt>");
    expect(markup).toContain(">Shortcut</dt>");
    expect(markup).toContain(">Mode</dt>");
  });

  /* Every value in the strip is a measurement, and a measurement snaps: a
   * transition on one of these would paint numbers the backend never sent. */
  test("marks every strip value as never-animated", () => {
    expect(markup).toContain("ov-strip-datum type-data snap-measured");
  });

  test("names an unmeasured input level rather than printing a zero", () => {
    expect(markup).toContain("not measured");
    expect(markup).toContain('data-absent="true"');
    expect(markup).toContain("16 kHz");
  });

  test("reports an unbound chord as unset, in the strip and not as a blank", () => {
    expect(markup).toContain(">not set<");
  });

  /* The accent's containment boundary and the text column's reserved width are
   * the same number, published once so they cannot drift apart. */
  test("publishes one containment share for the accent and the layout", () => {
    expect(markup).toContain("--shader-hero-clear:62%");
  });

  test("loads behind placeholders, with no update banner and no numbers", () => {
    expect(markup).toContain("ui-skeleton");
    expect(markup.includes("is available. This install is on")).toBe(false);
    expect(markup.includes("Could not check for updates")).toBe(false);
    expect(markup.includes("ov-stat-value")).toBe(false);
  });

  /* The banned copy: an empty region used to apologise for a query that had
   * actually succeeded. Neither the apology nor the old separate hint line may
   * come back. */
  test("carries no apology copy and no orphaned hint line", () => {
    expect(markup.includes("could not be loaded just now")).toBe(false);
    expect(markup.includes("Nothing recent")).toBe(false);
    expect(markup.includes("ov-hero-facts")).toBe(false);
  });
});
