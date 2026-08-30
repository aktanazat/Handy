import { describe, expect, test } from "bun:test";
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
import { ModeRecognitionPanel } from "./ModeRecognitionPanel";
import { ModeRewritePanel } from "./ModeRewritePanel";
import { ModeContextPanel } from "./ModeContextPanel";
import { ModeDeliveryPanel } from "./ModeDeliveryPanel";
import { ModeAutomationPanel } from "./ModeAutomationPanel";
import {
  createModeDraftUpdaters,
  modeDefinitionFromView,
  modeDraftIsDirty,
  modeEngineOptions,
  type ModeCloudState,
} from "./modeModel";
import type { ModeVocabularyEditor } from "./ModeRecognitionPanel";

/* Every mode setting the editor owned before the redesign has to survive it,
 * and the surface cannot be opened in a browser from here. These renders are
 * the standing proof: each panel is rendered with real translations and every
 * control label is asserted by name. */

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
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { __TAURI_OS_PLUGIN_INTERNALS__: { os_type: "macos" } },
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
  llm: { enabled: true, provider_id: "openai", model_id: "gpt-4o-mini" },
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

const updatersFor = (mode: ModeDefinition) =>
  createModeDraftUpdaters(mode, noop);

const localCloud: ModeCloudState = {
  requestedEngine: "local",
  selectedProvider: undefined,
  isConfigured: () => false,
  controlsAvailable: false,
  selectEngine: noop,
};

const vocabularyEditor: ModeVocabularyEditor = {
  rowKey: (entry) => `row-${entry.spoken}`,
  setField: noop,
  add: noop,
  remove: noop,
  incomplete: false,
};

const expectLabels = (html: string, labels: readonly string[]) => {
  const missing = labels.filter((label) => !html.includes(label));
  expect(missing).toEqual([]);
};

describe("mode editor shell", () => {
  const html = render(
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
    />,
  );

  test("names the mode, offers Save and keeps the identity field", () => {
    expectLabels(html, [
      "Email",
      "Save changes",
      "Mode name",
      'id="mode-name"',
    ]);
  });

  test("renders the five editor sections as one tablist", () => {
    expectLabels(html, [
      "Recognition",
      "Rewrite",
      "Context",
      "Delivery",
      "Automation",
    ]);
    expect(html.match(/role="tab"/g)?.length).toBe(5);
    expect(html.match(/aria-selected="true"/g)?.length).toBe(1);
    // The panel is named by the selected tab rather than a duplicated string.
    expect(html).toContain('aria-labelledby="tab-recognition"');
    expect(html).toContain('role="tabpanel"');
  });

  test("opens on Recognition with no unsaved-change claim", () => {
    expect(html).toContain("Transcription engine");
    expect(html.includes("Unsaved changes")).toBe(false);
    expect(html).toContain("Changes apply to your next dictation.");
  });

  test("reports an edited draft as unsaved", () => {
    const edited = draft({ name: "Email drafts" });
    expect(modeDraftIsDirty(edited, MODE_VIEW)).toBe(true);
    expect(modeDraftIsDirty(draft(), MODE_VIEW)).toBe(false);
    const editedHtml = render(
      <ModeEditor
        mode={edited}
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
      />,
    );
    expect(editedHtml).toContain("Unsaved changes");
  });

  test("blocks Save with a reason when the name is empty", () => {
    const blocked = render(
      <ModeEditor
        mode={draft({ name: "" })}
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
      />,
    );
    expect(blocked).toContain("A mode name is required.");
    expect(blocked).toContain("Untitled mode");
    expect(blocked).toContain("disabled");
  });

  test("surfaces a stale-revision conflict without dropping the draft", () => {
    const conflicted = render(
      <ModeEditor
        mode={draft({ name: "Email drafts" })}
        savedMode={MODE_VIEW}
        modeCount={4}
        models={MODELS}
        onChange={noop}
        onSave={noop}
        saving={false}
        conflict
        activationRules={[]}
        websiteActivationRules={[]}
        activationSupported
        capturingActivation={false}
        onCaptureActivation={noop}
        onRemoveActivation={noop}
        onCaptureWebsiteActivation={noop}
        onRemoveWebsiteActivation={noop}
      />,
    );
    expect(conflicted).toContain("Settings changed elsewhere");
    expect(conflicted).toContain("Email drafts");
  });
});

describe("recognition panel", () => {
  test("keeps every local recognition control", () => {
    const mode = draft();
    const html = render(
      <ModeRecognitionPanel
        mode={mode}
        updaters={updatersFor(mode)}
        models={MODELS}
        globalModelId="whisper-large-v3-turbo"
        cloud={localCloud}
        vocabulary={vocabularyEditor}
        missingFallbackModel={false}
      />,
    );
    expectLabels(html, [
      /* No "Recognition" heading: the tab above the panel already says it. */
      "Transcription engine",
      "Transcription model",
      "Language",
      "Translate to English",
      "Voice activity detection",
      "Transcript cleanup",
      "Literal punctuation",
      "Remove filler words",
      "Mode vocabulary",
      "Add pair",
    ]);
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
    // Unavailable providers stay listed with the reason, never hidden.
    expect(options.filter((option) => option.disabled).length).toBe(1);
    const deepgram = options[1];
    expect(deepgram.disabled).toBe(false);
    expect(deepgram.label).toBe("Deepgram Nova-3");
    const elevenLabs = options[2];
    expect(elevenLabs.disabled).toBe(true);
    expect(elevenLabs.label).toContain("is unavailable");
    expect(elevenLabs.label).toContain("ElevenLabs");
  });

  test("shows the cloud transport group once a provider is usable", () => {
    const mode = draft({
      asr: { ...draft().asr, requested_engine: "deepgram_nova_3" },
    });
    const html = render(
      <ModeRecognitionPanel
        mode={mode}
        updaters={updatersFor(mode)}
        models={MODELS}
        globalModelId="whisper-large-v3-turbo"
        cloud={{
          requestedEngine: "deepgram_nova_3",
          selectedProvider: {
            provider: "deepgram_nova_3",
            secretAccountId: "deepgram_nova3",
            labelKey: "settings.models.cloud.providers.deepgram",
          },
          isConfigured: () => true,
          controlsAvailable: true,
          selectEngine: noop,
        }}
        vocabulary={vocabularyEditor}
        missingFallbackModel
      />,
    );
    expectLabels(html, [
      "Cloud transport",
      "Use local fallback",
      "Fallback model",
      "Cloud keyterms",
      "Word timestamps",
    ]);
    expect(html).toContain("Choose a fallback model");
  });

  test("explains an unconfigured cloud selection instead of failing silently", () => {
    const mode = draft({
      asr: { ...draft().asr, requested_engine: "eleven_labs_scribe_v2" },
    });
    const html = render(
      <ModeRecognitionPanel
        mode={mode}
        updaters={updatersFor(mode)}
        models={MODELS}
        globalModelId="whisper-large-v3-turbo"
        cloud={{
          requestedEngine: "eleven_labs_scribe_v2",
          selectedProvider: {
            provider: "eleven_labs_scribe_v2",
            secretAccountId: "elevenlabs_scribe_v2",
            labelKey: "settings.models.cloud.providers.elevenLabs",
          },
          isConfigured: () => false,
          controlsAvailable: false,
          selectEngine: noop,
        }}
        vocabulary={vocabularyEditor}
        missingFallbackModel={false}
      />,
    );
    expect(html).toContain("needs a saved native API key");
    expect(html.includes("Cloud transport")).toBe(false);
  });

  test("states the empty case for mode vocabulary", () => {
    const mode = draft({ asr: { ...draft().asr, custom_words: [] } });
    const html = render(
      <ModeRecognitionPanel
        mode={mode}
        updaters={updatersFor(mode)}
        models={MODELS}
        globalModelId="whisper-large-v3-turbo"
        cloud={localCloud}
        vocabulary={vocabularyEditor}
        missingFallbackModel={false}
      />,
    );
    expect(html).toContain("has no vocabulary of its own");
    expect(html).toContain("Add pair");
  });
});

describe("rewrite panel", () => {
  test("renders six presets and five tones as radio groups", () => {
    const mode = draft();
    const html = render(
      <ModeRewritePanel
        mode={mode}
        updaters={updatersFor(mode)}
        providers={[
          {
            id: "openai",
            label: "OpenAI",
            base_url: "https://api.openai.com/v1",
          },
        ]}
      />,
    );
    expectLabels(html, [
      /* No "Writing" heading: the tab above the panel already says Rewrite,
       * and a group title repeating its own tab is the repeat this wave
       * exists to kill. */
      "AI cleanup",
      "Preset",
      "Minimal cleanup",
      "Application context",
      "Email",
      "Meeting",
      "Notes",
      "General",
      "Tone",
      "Casual",
      "Semi-casual",
      "Balanced",
      "Semi-formal",
      "Formal",
      "AI provider",
      "AI model",
    ]);
    expect(html.match(/name="mode-prompt-preset"/g)?.length).toBe(6);
    expect(html.match(/name="mode-tone"/g)?.length).toBe(5);
    // Exactly one preset and one tone read as selected.
    expect(html.match(/name="mode-prompt-preset" checked=""/g)?.length).toBe(1);
    expect(html.match(/name="mode-tone" checked=""/g)?.length).toBe(1);
  });

  test("says why the rewrite controls are inert and what to configure", () => {
    const mode = draft({ llm: { ...draft().llm, enabled: false } });
    const html = render(
      <ModeRewritePanel
        mode={mode}
        updaters={updatersFor(mode)}
        providers={[]}
      />,
    );
    expect(html).toContain("Turn on AI cleanup");
    expect(html).toContain("No AI provider is configured");
    expect(html.match(/<fieldset[^>]*disabled/g)?.length).toBe(2);
  });
});

describe("context panel", () => {
  test("offers all four levels and marks the ones privacy blocks", () => {
    const mode = draft();
    const html = render(
      <ModeContextPanel
        mode={mode}
        updaters={updatersFor(mode)}
        ceiling="target"
      />,
    );
    expectLabels(html, [
      "Context",
      "Context level",
      "Off",
      "App",
      "Selection",
      "Full",
    ]);
    expect(html.match(/name="mode-context-policy"/g)?.length).toBe(4);
    expect(html.match(/disabled=""/g)?.length).toBe(2);
    expect(html).toContain("Privacy limits this mode to App.");
  });

  test("warns when the saved level now exceeds the ceiling", () => {
    const mode = draft({ context_policy: "full" });
    const html = render(
      <ModeContextPanel
        mode={mode}
        updaters={updatersFor(mode)}
        ceiling="none"
      />,
    );
    expect(html).toContain("Privacy currently limits this mode");
  });
});

describe("delivery panel", () => {
  test("keeps every delivery control", () => {
    const mode = draft();
    const html = render(
      <ModeDeliveryPanel mode={mode} updaters={updatersFor(mode)} />,
    );
    expectLabels(html, [
      "Delivery",
      "Delivery method",
      "Clipboard",
      "Auto-submit",
      "Submit key",
      "Append a trailing space",
      "Reliable paste",
      "Paste delays",
      "Before",
      "After",
      "Typing tool",
    ]);
    expect(html).toContain("Turn on auto-submit to choose a key.");
    expect(html).toContain("Choose Type directly");
    expect(html.includes('id="mode-external-script"')).toBe(false);
  });

  test("reveals the script path only for external-script delivery", () => {
    const mode = draft({
      delivery: { ...draft().delivery, paste_method: "external_script" },
    });
    const html = render(
      <ModeDeliveryPanel mode={mode} updaters={updatersFor(mode)} />,
    );
    expect(html).toContain('id="mode-external-script"');
    expect(html).toContain("External script");
  });
});

describe("automation panel", () => {
  const automation = (
    overrides: Partial<React.ComponentProps<typeof ModeAutomationPanel>> = {},
  ) =>
    render(
      <ModeAutomationPanel
        modeId="email"
        modeCount={4}
        activationRules={[]}
        websiteActivationRules={[]}
        activationSupported
        websiteCaptureEnabled
        websiteMatchKind="exact"
        onWebsiteMatchKindChange={noop}
        capturing={false}
        saving={false}
        onCaptureActivation={noop}
        onRemoveActivation={noop}
        onCaptureWebsiteActivation={noop}
        onRemoveWebsiteActivation={noop}
        {...overrides}
      />,
    );

  test("carries shortcuts plus both activation editors", () => {
    const html = automation();
    expectLabels(html, [
      "Shortcuts",
      "App activation",
      "Activate in app",
      "Capture current app",
      "Website activation",
      "Website scope",
      "Activate on website",
      "Capture current website",
    ]);
  });

  test("teaches the rule shape when a list is empty", () => {
    const html = automation();
    expect(html).toContain("No app activates this mode.");
    expect(html).toContain("com.apple.mail");
    expect(html).toContain("No website activates this mode.");
    expect(html).toContain("mail.google.com");
  });

  test("lists captured rules with a scoped remove control", () => {
    const html = automation({
      activationRules: [{ app_id: "com.apple.mail", mode_id: "email" }],
      websiteActivationRules: [
        { host: "mail.google.com", match_kind: "suffix", mode_id: "email" },
      ],
    });
    expect(html).toContain("<code");
    expect(html).toContain('aria-label="Remove com.apple.mail"');
    expect(html).toContain('aria-label="Remove mail.google.com"');
    expect(html).toContain("Host and subdomains");
  });

  test("ignores rules that belong to another mode", () => {
    const html = automation({
      activationRules: [{ app_id: "com.apple.mail", mode_id: "notes" }],
    });
    expect(html).toContain("No app activates this mode.");
    expect(html.includes("com.apple.mail<")).toBe(false);
  });

  test("explains the platform limit instead of hiding the section", () => {
    const html = automation({ activationSupported: false });
    expect(html).toContain("available on macOS");
    expect(html).toContain("App activation");
    expect(html.includes("Capture current app")).toBe(false);
  });

  test("points at Privacy when website capture is off", () => {
    const html = automation({ websiteCaptureEnabled: false });
    expect(html).toContain("Enable Browser URLs in Privacy");
    expect(html.includes("Capture current website")).toBe(false);
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

  /* A cloud mode, so the engine cell cannot pass by rendering a constant. */
  const CLOUD_VIEW: ModeView = {
    ...MODE_VIEW,
    id: "cloud",
    name: "Cloud dictation with a deliberately long name",
    asr: { ...MODE_VIEW.asr, requested_engine: "deepgram_nova_3" },
  };

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
    // Both fixtures run locally, so the word appears once per row and the
    // row does not also print the model, language and delivery the editor
    // below it already owns.
    expect(html.split(">Local<").length - 1).toBe(2);
    expect(html.includes("Paste")).toBe(false);
    expect(html.includes("Auto")).toBe(false);
  });

  test("reads the engine from the mode rather than from a default", () => {
    const html = render(
      <ModesList
        modes={[CLOUD_VIEW]}
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
