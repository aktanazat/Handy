import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/vg/tooltip";
import type { AppSettings } from "@/bindings";
import { useSettingsStore } from "@/stores/settingsStore";
import { EssentialsSettings } from "./essentials/EssentialsSettings";
import { AdvancedSettings } from "./advanced/AdvancedSettings";

/* The number this restructure exists for.
 *
 * Settings was about seventy fixed rows across seven tabs. The brief's target
 * is Essentials at ten or eleven and everything non-debug under thirty, and
 * the only way a number like that survives contact with the next feature is if
 * exceeding it fails a test. So this file counts rows.
 *
 * A row is a `SettingsRow` or a `SettingsField` — a field is a row whose
 * control is too wide to sit beside its label, not a second kind of thing.
 * Rows inside a `<details>` are excluded, because a collapsed one-time setup
 * costs a reader one line whether it holds two fields or nine; that is the
 * whole reason those blocks are collapsed. Dynamic list items — models,
 * workflows, agent sessions, trackers — are not rows at all.
 *
 * Static rendering runs no effects, so every surface here is at first paint:
 * loading states included, which is the honest floor for a count. */

const catalogue = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
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

/* The values the backend hands back on a fresh install (settings.rs), because
 * a count taken at first paint is not the count a person sees: an unread store
 * shows the cancel chord that push-to-talk removes. Only the keys that decide
 * whether a row renders at all are listed; the rest do not move the number. */
/* SAFETY: a four-key partial stands in for AppSettings because these renders
 * read only the keys that decide whether a row appears; every other field is
 * behind `getSetting` fallbacks, so a missing key cannot be dereferenced. */
const SHIPPED_DEFAULTS = {
  push_to_talk: true,
  command_mode_enabled: true,
  experimental_enabled: false,
  overlay_style: "live",
} as AppSettings;

const paint = (
  node: React.ReactElement,
  settings: AppSettings = SHIPPED_DEFAULTS,
): string => {
  useSettingsStore.setState({ settings, isUpdating: {} });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  );
};

/* Drops every `<details>` element, innermost first so nesting cannot make the
 * strip swallow a sibling: the pattern refuses to cross another `<details`. */
const withoutDisclosures = (markup: string): string => {
  const innermost = /<details(?:(?!<details)[\s\S])*?<\/details>/;
  let stripped = markup;
  while (innermost.test(stripped)) stripped = stripped.replace(innermost, "");
  return stripped;
};

const countRows = (markup: string): number =>
  markup.match(/data-slot="settings-(?:row|field)"/g)?.length ?? 0;

const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeAll(() => {
  /* `type()` is a synchronous read of a global the Tauri host installs, and two
   * surfaces branch on it during render: the cancel-chord row and the line that
   * names the debug chord. defineProperty + afterAll restore, not assignment: a
   * leaked bare `window` pins framer-motion's reduced-motion probe for every
   * later test file (see Overview.test.tsx). */
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ...globalThis.window,
      __TAURI_OS_PLUGIN_INTERNALS__: { os_type: "macos" },
    },
  });
});
afterAll(() => {
  if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
/* Nothing seeds the detection store here on purpose. zustand hands React's
 * server renderer its INITIAL snapshot, so a static render cannot observe a
 * `setState`, and Advanced's calendar and any-microphone switches — which
 * come from that store — never appear. `getSetting` above is a store action
 * reading live state, which is why the settings defaults do land.
 *
 * So the page budget is counted against the number a person sees, and the two
 * rows this render cannot reach are added by name rather than paid for by
 * quietly lowering the bound. */
const UNRENDERABLE_ADVANCED_ROWS = 2;

describe("Essentials", () => {
  const markup = () => paint(<EssentialsSettings onOpenModes={() => {}} />);

  test("is one surface of ten to eleven rows", () => {
    const rows = countRows(markup());

    expect(rows).toBeGreaterThan(9);
    expect(rows).toBeLessThan(12);
  });

  test("carries every essential control, in the brief's order", () => {
    const found = markup();
    const order = [
      // The transcribe binding, before its store has resolved.
      "Shortcut",
      "Push to talk",
      "Microphone",
      "Language",
      "Sounds",
      "Launch at login",
      "Notice when I join a meeting",
      "Meeting apps",
      "Delete recordings after",
      "Appearance",
      "Dictation styles",
    ].map((label) => found.indexOf(label));

    // Every one present, and each after the one before it.
    expect(order.filter((at) => at < 0)).toEqual([]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("prints no section heading and no raw key", () => {
    const found = markup();

    /* The tab strip above already names the page, and eleven rows are short
     * enough to read without being divided. */
    expect(found).not.toContain("<h2");
    expect(found).not.toContain("__MISSING__");
  });
});

describe("Advanced", () => {
  const markup = () => paint(<AdvancedSettings onOpenCatalog={() => {}} />);

  test("carries the seven sections the five folded tabs became", () => {
    const found = markup();

    for (const section of [
      "Meetings",
      "Models",
      "Dictation",
      "What Sona does after a meeting",
      "Sync",
      "Agents",
      "About Sona",
    ]) {
      expect(found).toContain(`>${section}</h2>`);
    }
    expect(found).not.toContain("__MISSING__");
  });

  test("names the chord that opens Debug, since nothing links to it", () => {
    expect(markup()).toContain("Press \u2318\u21e7D to open the debug page.");
  });

  test("keeps every one-time setup collapsed", () => {
    const found = markup();
    const collapsed = countRows(found) - countRows(withoutDisclosures(found));

    // Cloud keys, the cleanup endpoint, context capture, egress facts, the
    // agent bridge, and cloud sync's three setup tasks all sit behind a row.
    expect(collapsed).toBeGreaterThan(0);
    expect(found).not.toContain("open=");
  });

  test("every setting with a live reader keeps a way to write it", () => {
    /* The row cull orphaned five settings: it deleted their components while
     * Rust kept reading the fields. `app_language` decides the whole UI's
     * locale and had no control left at all, in the same change that synced 23
     * locale bundles; the HUD pill, the window material and the microphone
     * channel each still drive real behaviour. Named by label because that is
     * what a reader looks for. */
    const found = markup();

    for (const label of ["App language", "Material", "Show the idle pill"]) {
      expect(found).toContain(label);
    }
    /* The channel row is absent by design: `ChannelSelector` asks the device
     * how many channels it has and renders nothing for the ordinary one, so a
     * static render — which runs no effects — must show no row. */
    expect(found).not.toContain("Input channel");
  });
});

test("the whole non-debug surface stays at thirty-four rows or under", () => {
  const total =
    countRows(paint(<EssentialsSettings onOpenModes={() => {}} />)) +
    countRows(
      withoutDisclosures(paint(<AdvancedSettings onOpenCatalog={() => {}} />)),
    ) +
    UNRENDERABLE_ADVANCED_ROWS;

  /* Thirty-four is the round-3 ceiling. Round 2 held the page at thirty;
   * the round-3 consensus (DECISIONS-3.md §7, 2026-08-31) then added four
   * consented surfaces — remote meeting intelligence (D14), external access
   * for the CLI and MCP server (D15), after-meeting automations (D22), and
   * the per-series calendar controls (D28) — so the number moved by
   * decision, not by drift. Settings carried about seventy rows across
   * seven tabs before the restructure; the next row added here still has
   * to displace one or argue with this comment. */
  expect(total).toBeLessThan(35);
});
