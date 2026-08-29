import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
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
    model_id: "whisper-small",
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

const render = (node: React.ReactElement): string =>
  renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

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
      "Recognition",
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

  test("offers both cloud engines and says why one is unusable", () => {
    const mode = draft();
    const html = render(
      <ModeRecognitionPanel
        mode={mode}
        updaters={updatersFor(mode)}
        models={MODELS}
        globalModelId="whisper-large-v3-turbo"
        cloud={{
          ...localCloud,
          isConfigured: (provider) => provider === "deepgram_nova_3",
        }}
        vocabulary={vocabularyEditor}
        missingFallbackModel={false}
      />,
    );
    expect(html).toContain("Deepgram");
    // Unavailable providers stay listed with the reason, never hidden.
    expect(html).toContain("is unavailable");
    expect(html.match(/<option[^>]*disabled/g)?.length).toBe(1);
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
      "Writing",
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
        onCreate={noop}
        onActivate={noop}
        onDuplicate={noop}
        onMove={noop}
        onRequestDelete={noop}
        onReload={noop}
      />,
    );

  test("marks the active mode with words and weight, not a dot", () => {
    const html = list();
    expect(html).toContain("Active");
    expect(html).toContain('data-active="true"');
    expect(html).toContain('data-selected="true"');
    // A round colored status dot is the pattern this list must not use.
    expect(html.includes("rounded-full")).toBe(false);
  });

  test("shows each mode's dictation chord as keycaps", () => {
    const html = list();
    expect(html).toContain("<kbd");
    expectLabels(html, ["Left Option", "Shift", "Option", "Space"]);
    expect(html.match(/<kbd/g)?.length).toBe(5);
  });

  test("keeps every revisioned action reachable per mode", () => {
    const html = list();
    expectLabels(html, [
      "Your modes",
      "New mode",
      "Activate",
      "Duplicate",
      "Move up",
      "Move down",
      "Delete",
      'aria-label="Actions for Email"',
    ]);
    // The active mode cannot be activated again, so it has one item fewer.
    expect(html.match(/role="menuitem"/g)?.length).toBe(9);
  });

  test("protects the default mode from deletion with a reason", () => {
    const html = list();
    expect(html).toContain("The default mode cannot be deleted.");
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
        onCreate={noop}
        onActivate={noop}
        onDuplicate={noop}
        onMove={noop}
        onRequestDelete={noop}
        onReload={noop}
      />,
    );
    expect(html).toContain("No modes are configured.");
    expect(html).toContain("Retry");
  });
});
