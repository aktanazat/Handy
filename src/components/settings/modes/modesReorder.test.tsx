import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { ModeView, ShortcutBinding } from "@/bindings";
import { ModesList } from "./ModesList";
import { orderWithMove } from "./modeModel";

/* The mode list can be reordered two ways and both have to land the same value
 * in the same command. The drag is a browser fact and is asserted end to end in
 * tests/motion.spec.ts; what is provable here is the other half: the order the
 * keyboard route produces, and that the list still renders in full before the
 * drag code has even loaded. */

const localeFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeFile, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { __TAURI_OS_PLUGIN_INTERNALS__: { os_type: "macos" } },
});

const ORDER = ["message", "email", "meeting", "notes"];

describe("orderWithMove", () => {
  test("moving down swaps with the next mode", () => {
    expect(orderWithMove(ORDER, "email", 1)).toEqual([
      "message",
      "meeting",
      "email",
      "notes",
    ]);
  });

  test("moving up swaps with the previous mode", () => {
    expect(orderWithMove(ORDER, "meeting", -1)).toEqual([
      "message",
      "meeting",
      "email",
      "notes",
    ]);
  });

  /* The menu items at either end are disabled, so this is the belt: a move that
   * would leave the list returns the list, and the caller's equality check then
   * skips the command entirely. */
  test("a move off either end changes nothing", () => {
    expect(orderWithMove(ORDER, "message", -1)).toEqual(ORDER);
    expect(orderWithMove(ORDER, "notes", 1)).toEqual(ORDER);
  });

  test("an unknown mode changes nothing", () => {
    expect(orderWithMove(ORDER, "gone", 1)).toEqual(ORDER);
  });

  test("the result is a copy, so the caller cannot mutate the snapshot", () => {
    const source = [...ORDER];
    expect(orderWithMove(source, "email", 1)).not.toBe(source);
    expect(source).toEqual(ORDER);
  });

  /* Two opposite nudges are a no-op. If the swap were ever written as a splice
   * this is the assertion that would notice. */
  test("a nudge and its opposite return the original order", () => {
    expect(
      orderWithMove(orderWithMove(ORDER, "email", 1), "email", -1),
    ).toEqual(ORDER);
  });
});

const binding = (chord: string): ShortcutBinding => ({
  id: "transcribe",
  name: "Transcribe",
  description: "Transcribe",
  default_binding: chord,
  current_binding: chord,
});

const mode = (id: string, name: string): ModeView => ({
  id,
  name,
  tone: "balanced",
  context_policy: "target",
  asr: {
    model_id: "",
    language: "en",
    translate_to_english: false,
    custom_words: [],
    filler_word_removal_enabled: false,
    custom_filler_words: null,
    vad_enabled: true,
    requested_engine: "local",
    local_fallback_enabled: true,
    local_fallback_model_id: null,
  },
  llm: { enabled: false, provider_id: "openai", model_id: "" },
  prompt: {
    preset: "minimalist_cleanup",
    source_prompt_id: null,
    custom_prompt: "",
  },
  delivery: {
    paste_method: "ctrl_v",
    clipboard_handling: "copy_to_clipboard",
    auto_submit: false,
    auto_submit_key: "enter",
    append_trailing_space: false,
    paste_delay_ms: 0,
    paste_delay_after_ms: 0,
    reliable_paste: false,
    typing_tool: "auto",
    external_script_path: null,
  },
  shortcuts: {
    transcribe: binding("cmd+shift+space"),
    switch: binding(""),
  },
});

const MODES = ORDER.map((id) => mode(id, id.toUpperCase()));

const noop = () => undefined;

const list = () =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ModesList
        modes={MODES}
        models={[]}
        activeModeId="message"
        selectedModeId="email"
        busy={false}
        osType="macos"
        onSelect={noop}
        onCreate={noop}
        onActivate={noop}
        onDuplicate={noop}
        onMove={noop}
        onReorder={noop}
        onRequestDelete={noop}
        onReload={noop}
      />
    </I18nextProvider>,
  );

/* The draggable list is an async chunk. Until it lands, the Suspense fallback
 * is what a user sees, so it has to be the whole list rather than a spinner —
 * and it is the only list a keyboard user ever needs. */
describe("the list before the drag code loads", () => {
  const markup = list();

  test("every mode is a row, in the order given", () => {
    const positions = ORDER.map((id) => markup.indexOf(id.toUpperCase()));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test("the rows are the same list element the draggable one renders", () => {
    expect(markup).toContain('<ul class="modes-list">');
    expect(markup.split('class="modes-list-row"').length - 1).toBe(
      MODES.length,
    );
  });

  test("active and selected rows still say so", () => {
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('data-selected="true"');
  });

  /* The keyboard route to a reorder. It is the only route without a pointer,
   * so it survives the drag conversion unchanged. */
  test("every row keeps its move up and move down items", () => {
    expect(markup.split("Move up").length - 1).toBe(MODES.length);
    expect(markup.split("Move down").length - 1).toBe(MODES.length);
  });

  test("the first row cannot move up and the last cannot move down", () => {
    const rows = markup.split('class="modes-list-row"').slice(1);
    const disabledIn = (row: string, label: string) =>
      row.slice(0, row.indexOf(label)).lastIndexOf("disabled=") >
      row.slice(0, row.indexOf(label)).lastIndexOf("<button");
    expect(disabledIn(rows[0], "Move up")).toBe(true);
    expect(disabledIn(rows[0], "Move down")).toBe(false);
    expect(disabledIn(rows[rows.length - 1], "Move down")).toBe(true);
    expect(disabledIn(rows[rows.length - 1], "Move up")).toBe(false);
  });

  test("the row exposes the mode's configuration at a glance", () => {
    expect(markup).toContain("modes-list-config");
  });
});
