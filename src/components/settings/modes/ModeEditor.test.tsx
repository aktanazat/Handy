import { afterAll, describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/vg/tooltip";
import type {
  ModeDefinition,
  ModeView,
  ModelInfo,
  ShortcutBinding,
} from "@/bindings";
import { ModeEditor } from "./ModeEditor";
import { ModesList } from "./ModesList";
import {
  isPresetMode,
  modeDefinitionFromView,
  modeDraftIsDirty,
  modeEngineOptions,
} from "./modeModel";

/* Every mode setting the editor owned before the collapse either survives it
 * on one screen, survives it behind the one Advanced disclosure, or is gone on
 * purpose. The surface cannot be opened in a browser from here, so these
 * renders are the standing proof: real translations, and every control that
 * survived asserted by name.
 *
 * The editor now reads the app settings store for providers, the privacy
 * ceiling and browser-URL consent. Under `renderToStaticMarkup` that store is
 * still empty, which is exactly a fresh install — so the branches asserted
 * below are the ones a first-run reader actually meets. */

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

/* `@tauri-apps/plugin-os` reads this synchronously during render, and the
 * shortcut rows go through it. Nothing else in these components needs a DOM.
 * defineProperty, not assignment: under a whole-src run another test file has
 * already planted `window` and plain assignment throws on the readonly slot. */
const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { __TAURI_OS_PLUGIN_INTERNALS__: { os_type: "macos" } },
});
afterAll(() => {
  if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const binding = (id: string, chord: string): ShortcutBinding => ({
  id,
  name: id,
  description: id,
  default_binding: chord,
  current_binding: chord,
});

const MODE_VIEW: ModeView = {
  id: "email",
  name: "Email",
  tone: "semi_formal",
  context_policy: "target",
  asr: {
    /* The real shape. `ModelInfo.id` for a catalog model is
     * `repo_id/filename` (managers/model.rs:210-213), not a short slug, and
     * the row has to survive that. Verbatim from
     * src-tauri/src/catalog/catalog.json. */
    model_id:
      "handy-computer/parakeet-tdt-0.6b-v3-gguf/parakeet-tdt-0.6b-v3-Q4_K_M.gguf",
    language: "auto",
    translate_to_english: false,
    custom_words: [{ spoken: "sona", written: "Sona" }],
    filler_word_removal_enabled: true,
    custom_filler_words: null,
    literal_punctuation: false,
    vad_enabled: true,
    requested_engine: "local",
    local_fallback_enabled: true,
    local_fallback_model_id: null,
    cloud_keyterms: [],
    cloud_timestamps: false,
  },
  llm: {
    enabled: true,
    provider_id: "openai",
    model_id: "gpt-4o-mini",
    spoken_instructions: false,
  },
  prompt: { preset: "email", source_prompt_id: null, custom_prompt: null },
  delivery: {
    paste_method: "ctrl_v",
    clipboard_handling: "copy_to_clipboard",
    auto_submit: false,
    auto_submit_key: "enter",
    append_trailing_space: true,
    paste_delay_ms: 40,
    paste_delay_after_ms: 20,
    reliable_paste: true,
    typing_tool: "auto",
    external_script_path: null,
  },
  shortcuts: {
    transcribe: binding("mode/email/transcribe", "option_left+shift+2"),
    switch: binding("mode/email/switch", "option+2"),
  },
};

const MESSAGE_VIEW: ModeView = {
  ...MODE_VIEW,
  id: "message",
  name: "Message",
  shortcuts: {
    transcribe: binding("transcribe", "option+space"),
    switch: binding("mode/message/switch", "option+1"),
  },
};

const MODELS: ModelInfo[] = [];

/* Every window root mounts one `TooltipProvider` and the row primitives assume
 * it, so this stands in for the root. Context only: no markup of its own. */
const render = (node: React.ReactElement): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  );

const draft = (overrides: Partial<ModeDefinition> = {}): ModeDefinition => ({
  ...modeDefinitionFromView(MODE_VIEW),
  ...overrides,
});

const noop = () => undefined;

const editor = (
  overrides: Partial<React.ComponentProps<typeof ModeEditor>> = {},
): string =>
  render(
    <ModeEditor
      mode={draft()}
      savedMode={MODE_VIEW}
      modeCount={4}
      models={MODELS}
      onChange={noop}
      onSave={noop}
      saving={false}
      conflict={false}
      activationRules={[]}
      websiteActivationRules={[]}
      activationSupported
      capturingActivation={false}
      onCaptureActivation={noop}
      onRemoveActivation={noop}
      onCaptureWebsiteActivation={noop}
      onRemoveWebsiteActivation={noop}
      {...overrides}
    />,
  );

const expectLabels = (html: string, labels: readonly string[]) => {
  const missing = labels.filter((label) => !html.includes(label));
  expect(missing).toEqual([]);
};

describe("mode editor shell", () => {
  const html = editor();

  test("names the mode, offers Save and keeps the identity field", () => {
    expectLabels(html, [
      "Email",
      "Save changes",
      "Mode name",
      'id="mode-name"',
    ]);
    expect(html).toContain("Changes apply to your next dictation.");
  });

  test("is one screen: four sections and no tabs", () => {
    expectLabels(html, [
      "Instructions",
      "Model",
      "Output",
      "Turns on by itself",
    ]);
    // The five-tab editor is gone, so nothing here is a tablist any more.
    expect(html.includes('role="tab"')).toBe(false);
    expect(html.includes('role="tabpanel"')).toBe(false);
    expect(html.includes("Recognition")).toBe(false);
    expect(html.includes("Automation")).toBe(false);
  });

  test("opens with no unsaved-change claim", () => {
    expect(html.includes("Unsaved changes")).toBe(false);
  });

  test("reports an edited draft as unsaved", () => {
    expect(modeDraftIsDirty(draft({ name: "Email drafts" }), MODE_VIEW)).toBe(
      true,
    );
    expect(modeDraftIsDirty(draft(), MODE_VIEW)).toBe(false);
    expect(editor({ mode: draft({ name: "Email drafts" }) })).toContain(
      "Unsaved changes",
    );
  });

  test("blocks Save with a reason when the name is empty", () => {
    const blocked = editor({ mode: draft({ name: "" }) });

    expect(blocked).toContain("A mode name is required.");
    expect(blocked).toContain("Untitled mode");
    expect(blocked).toContain("disabled");
  });

  test("surfaces a stale-revision conflict without dropping the draft", () => {
    const conflicted = editor({
      mode: draft({ name: "Email drafts" }),
      conflict: true,
    });

    expect(conflicted).toContain("Settings changed elsewhere");
    expect(conflicted).toContain("Email drafts");
  });
});

describe("instructions", () => {
  test("edits the mode's own rewrite prompt, and says what it overrides", () => {
    const html = editor({
      mode: draft({
        prompt: { ...draft().prompt, custom_prompt: "Keep it to two lines." },
      }),
    });

    expect(html).toContain('id="mode-instructions"');
    expect(html).toContain("Your own instructions");
    expect(html).toContain("Keep it to two lines.");
    expect(html).toContain("Clean up with AI");
    /* The precedence sentence rides on an affordance, not as a second
     * paragraph under the label: a field states its setting once. Radix
     * portals the content, so what a static render can prove is the named
     * trigger — the sentence itself is asserted on the locale below. */
    expect(html).toContain('aria-label="Your own instructions"');
    expect(html).toContain('data-slot="tooltip-trigger"');
    expect(html.includes("replaces the output style below")).toBe(false);
    expect(i18n.t("modesV2.instructions.custom.hint")).toContain(
      "replaces the output style below",
    );
  });

  test("says why the prompt is inert when cleanup is off", () => {
    const html = editor({
      mode: draft({ llm: { ...draft().llm, enabled: false } }),
    });

    expect(html).toContain("Turn on cleanup");
    expect(html.match(/id="mode-instructions"[^>]*disabled/)).not.toBeNull();
  });
});

describe("model", () => {
  test("keeps the engine, the local model and the language on the screen", () => {
    const html = editor();

    expectLabels(html, [
      "Transcription engine",
      'id="mode-engine"',
      "Transcription model",
      'id="mode-model"',
      "Language",
      'id="mode-language"',
    ]);
  });

  test("hides the local model on a cloud engine and explains the gap", () => {
    const html = editor({
      mode: draft({
        asr: { ...draft().asr, requested_engine: "deepgram_nova_3" },
      }),
    });

    expect(html.includes('id="mode-model"')).toBe(false);
    expect(html).toContain("needs an API key in the system credential store");
  });

  /* The engine menu is a Radix portal: its items exist only once a pointer
   * has opened it, so what it offers is asserted on the model it renders. */
  test("offers both cloud engines and says why one is unusable", () => {
    const options = modeEngineOptions(
      (provider) => provider === "deepgram_nova_3",
      (key, values) => i18n.t(key, values ?? {}),
    );

    expect(options.map((option) => option.value)).toEqual([
      "local",
      "deepgram_nova_3",
      "eleven_labs_scribe_v2",
    ]);
    expect(options.filter((option) => option.disabled).length).toBe(1);
    expect(options[1].label).toBe("Deepgram Nova-3");
    expect(options[2].label).toContain("is unavailable");
    expect(options[2].label).toContain("ElevenLabs");
  });
});

describe("output", () => {
  test("carries the delivery method and the output style", () => {
    const html = editor();

    expectLabels(html, [
      "Delivery method",
      'id="mode-paste-method"',
      "Output style",
      'id="mode-output-style"',
    ]);
    expect(html.includes('id="mode-external-script"')).toBe(false);
  });

  /* The path is the method's own parameter: a method that cannot run without
   * it must not hide it behind the disclosure. */
  test("reveals the script path beside external-script delivery", () => {
    const html = editor({
      mode: draft({
        delivery: { ...draft().delivery, paste_method: "external_script" },
      }),
    });

    expect(html).toContain('id="mode-external-script"');
    expect(html).toContain("External script");
  });
});

describe("turns on by itself", () => {
  test("teaches the rule shape when nothing activates the mode", () => {
    const html = editor();

    expect(html).toContain("Apps and websites");
    expect(html).toContain("Nothing switches to this mode on its own.");
    expect(html).toContain("com.apple.mail");
    expect(html).toContain("mail.google.com");
    expect(html).toContain("Capture current app");
  });

  test("lists app and website rules in one list, each with its own remove", () => {
    const html = editor({
      activationRules: [{ app_id: "com.apple.mail", mode_id: "email" }],
      websiteActivationRules: [
        { host: "mail.google.com", match_kind: "suffix", mode_id: "email" },
      ],
    });

    expect(html).toContain('aria-label="Remove com.apple.mail"');
    expect(html).toContain('aria-label="Remove mail.google.com"');
    // The website row's scope is the one thing its host cannot show.
    expect(html).toContain("Host and subdomains");
    // One list, not two.
    expect(html.match(/aria-label="Apps and websites"/g)?.length).toBe(1);
  });

  test("ignores rules that belong to another mode", () => {
    const html = editor({
      activationRules: [{ app_id: "com.apple.mail", mode_id: "notes" }],
    });

    expect(html).toContain("Nothing switches to this mode on its own.");
    expect(html.includes("com.apple.mail<")).toBe(false);
  });

  test("explains the platform limit instead of hiding the section", () => {
    const html = editor({ activationSupported: false });

    expect(html).toContain("available on macOS");
    expect(html).toContain("Apps and websites");
    expect(html.includes("Capture current app")).toBe(false);
  });

  /* Browser-URL consent is off on a fresh install, so the website half names
   * the switch that turns it on rather than offering a capture that fails. */
  test("points at Privacy when website capture is off", () => {
    const html = editor();

    expect(html).toContain("Include browser URLs");
    expect(html).toContain("in Privacy");
    expect(html.includes("Capture current website")).toBe(false);
  });
});

describe("advanced", () => {
  const html = editor();

  test("is one disclosure, closed on arrival", () => {
    expect(html).toContain("<details");
    expect(html).toContain("Advanced");
    // Closed: `<details>` carries no `open`, so the four decisions above it
    // are the screen.
    expect(html.includes("<details open")).toBe(false);
    // One disclosure, never a second one nested inside it.
    expect(html.match(/<details/g)?.length).toBe(1);
  });

  test("holds every knob that survived the collapse", () => {
    expectLabels(html, [
      "Tone",
      "AI provider",
      "AI model",
      "Context level",
      "Translate to English",
      "Literal punctuation",
      "Remove filler words",
      "Voice activity detection",
      "Clipboard",
      "Auto-submit",
      "Submit key",
      "Append a trailing space",
      "Mode vocabulary",
    ]);
    // The privacy ceiling still outranks the mode, and still says so.
    expect(html).toContain("Privacy currently limits this mode");
    expect(html).toContain("No AI provider is configured");
  });

  /* The cue rides on the mode's rewrite provider, so the row is inert until
   * cleanup is on — and the cue phrase itself has to be discoverable
   * somewhere, which is the hint. The switch renders `aria-checked` and
   * `disabled` before its id, so that is the order these patterns read in. */
  test("offers spoken instructions, off and gated on AI cleanup", () => {
    expect(html).toContain("Spoken instructions");
    expect(html).toMatch(
      /aria-checked="false"[^>]*id="mode-spoken-instructions"/,
    );
    // The hint text sits in a closed tooltip, which static markup does not
    // carry, so the render proves the row has a hint and the bundle proves
    // what that hint says.
    expect(html).toMatch(
      /Spoken instructions<\/label><button[^>]*aria-label="Spoken instructions"/,
    );
    expect(
      i18n.t("settings.modes.writing.spokenInstructions.description"),
    ).toContain('"Sona,"');

    const enabled = editor({
      mode: draft({ llm: { ...draft().llm, spoken_instructions: true } }),
    });
    expect(enabled).toMatch(
      /aria-checked="true"[^>]*id="mode-spoken-instructions"/,
    );

    const noCleanup = editor({
      mode: draft({ llm: { ...draft().llm, enabled: false } }),
    });
    expect(noCleanup).toMatch(/disabled=""[^>]*id="mode-spoken-instructions"/);
  });

  test("drops the knobs a default already answers", () => {
    for (const gone of [
      "Reliable paste",
      "Paste delays",
      "Typing tool",
      "Word timestamps",
    ]) {
      expect(html.includes(gone)).toBe(false);
    }
  });

  test("keeps the per-mode vocabulary editable, including its empty case", () => {
    expect(html).toContain("Add pair");
    expect(html).toContain('aria-label="Remove sona"');

    const empty = editor({
      mode: draft({ asr: { ...draft().asr, custom_words: [] } }),
    });
    expect(empty).toContain("has no vocabulary of its own");
    expect(empty).toContain("Add pair");
  });
});

describe("mode list", () => {
  const list = (selectedModeId: string | null = "email") =>
    render(
      <ModesList
        modes={[MESSAGE_VIEW, MODE_VIEW]}
        activeModeId="message"
        selectedModeId={selectedModeId}
        busy={false}
        osType="macos"
        onSelect={noop}
        onActivate={noop}
        onDuplicate={noop}
        onMove={noop}
        onReorder={noop}
        onRequestDelete={noop}
        onReload={noop}
      />,
    );

  /* A cloud mode nobody shipped, so neither the engine cell nor the preset
   * marker can pass by rendering a constant. */
  const CLOUD_VIEW: ModeView = {
    ...MODE_VIEW,
    id: "cloud",
    name: "Cloud dictation with a deliberately long name",
    asr: { ...MODE_VIEW.asr, requested_engine: "deepgram_nova_3" },
  };

  const single = (mode: ModeView) =>
    render(
      <ModesList
        modes={[mode]}
        activeModeId="message"
        selectedModeId={null}
        busy={false}
        osType="macos"
        onSelect={noop}
        onActivate={noop}
        onDuplicate={noop}
        onMove={noop}
        onReorder={noop}
        onRequestDelete={noop}
        onReload={noop}
      />,
    );

  test("marks the active mode with one word, not a colour", () => {
    const html = list();

    expect(html).toContain("Active");
    expect(html).toContain("text-blue-900");
    // A round coloured status dot is the pattern this list must not use, and
    // the Badge primitive's inverted pill is the chip it must not wear.
    expect(html.includes("rounded-full")).toBe(false);
    expect(html.includes("bg-primary")).toBe(false);
    // Exactly one row can be active, and one row is open in the editor.
    expect(html.split(">Active<").length - 1).toBe(1);
    expect(html.split('data-selected="true"').length - 1).toBe(1);
  });

  test("reads the shipped modes as presets, and only those", () => {
    expect(isPresetMode("message")).toBe(true);
    expect(isPresetMode("notes")).toBe(true);
    expect(isPresetMode("cloud")).toBe(false);

    // Message and Email both ship with Sona, so both rows carry the word.
    expect(list().split(">Preset<").length - 1).toBe(2);
    expect(single(CLOUD_VIEW).includes(">Preset<")).toBe(false);
  });

  test("shows each mode's dictation chord as engraved caps", () => {
    const html = list();

    expect(html).toContain("<kbd");
    // One cap per physical key, in the form macOS engraves.
    expectLabels(html, ["⌥", "⇧", "Space"]);
    expect(html.match(/<kbd/g)?.length).toBe(5);
    // The qualified form is not lost: it is the chord's tooltip.
    expect(html).toContain('title="Left Option + Shift + 2"');
    expect(html).toContain('title="Option + Space"');
  });

  test("carries the engine, and carries it exactly once per row", () => {
    const html = list();

    // Both fixtures run locally, so the word appears once per row and the row
    // does not also print the model, language and delivery the editor below
    // it already owns.
    expect(html.split(">Local<").length - 1).toBe(2);
    expect(html.includes("Paste")).toBe(false);
    expect(html.includes("Auto")).toBe(false);
  });

  test("reads the engine from the mode rather than from a default", () => {
    const html = single(CLOUD_VIEW);

    expect(html).toContain(">Deepgram<");
    expect(html.includes(">Local<")).toBe(false);
  });

  test("never prints a model repo path", () => {
    // `ModelInfo.id` is `repo_id/filename`: 65 characters at the median across
    // the shipped catalog and 116 at the longest. The row does not carry the
    // model at all now, so the path can never reach it.
    const html = list();

    expect(html.includes("handy-computer/")).toBe(false);
    expect(html.includes(".gguf")).toBe(false);
  });

  test("keeps name, state, engine and keycaps on one line", () => {
    const html = list();
    const rows = html.split("<li").slice(1);

    expect(rows.length).toBe(2);
    // The defect this replaces put the state and the caps on a second line
    // under the title, which then wrapped. One row is one flex line.
    for (const row of rows) {
      expect(row).toContain("<kbd");
      expect(row.includes("flex-col")).toBe(false);
    }
    // MESSAGE_VIEW is the active mode and renders first.
    expect(rows[0]).toContain(">Active<");
  });

  test("reaches each mode's actions by that mode's name", () => {
    const html = list();

    expectLabels(html, [
      'aria-label="Actions for Email"',
      'aria-label="Actions for Message"',
    ]);
    // The menu is a portal: what it offers is asserted on `modeRowActions`
    // in modesReorder.test.tsx, which is also where the reorder lives.
    expect(html.match(/aria-haspopup="menu"/g)?.length).toBe(2);
  });

  test("offers a way out when the list arrives empty", () => {
    const html = render(
      <ModesList
        modes={[]}
        activeModeId="message"
        selectedModeId={null}
        busy={false}
        osType="macos"
        onSelect={noop}
        onActivate={noop}
        onDuplicate={noop}
        onMove={noop}
        onReorder={noop}
        onRequestDelete={noop}
        onReload={noop}
      />,
    );

    expect(html).toContain("No modes are configured.");
    expect(html).toContain("Retry");
  });
});
