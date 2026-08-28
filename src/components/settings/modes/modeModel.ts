import type {
  AutoSubmitKey,
  ClipboardHandling,
  CloudSttProvider,
  ContextPolicy,
  ModeAsrSettings,
  ModeDefinition,
  ModeDeliverySettings,
  ModeLlmSettings,
  ModeMutationError,
  ModePromptSettings,
  ModeView,
  ModelInfo,
  PasteMethod,
  PromptPreset,
  RequestedEngine,
  Tone,
  TypingTool,
  WebsiteHostMatch,
} from "@/bindings";
import {
  cloudSttProviderForEngine,
  type CloudSttProviderMetadata,
} from "@/lib/cloudStt";
import type { DropdownOption } from "@/components/ui";

/* Shape, constants and pure mappers shared by the modes page. Everything here
 * is total and side-effect free: the page owns state, the panels own markup. */

export const DEFAULT_MODE_ID = "message";

export const MODE_EDITOR_TABS = [
  "recognition",
  "rewrite",
  "context",
  "delivery",
  "automation",
] as const;

export type ModeEditorTab = (typeof MODE_EDITOR_TABS)[number];

/* One panel is mounted at a time, so every tab points its aria-controls at
 * the same element. */
export const MODE_EDITOR_PANEL_ID = "mode-editor-tabpanel";

export const WEBSITE_HOST_MATCHES = [
  "exact",
  "suffix",
] as const satisfies readonly WebsiteHostMatch[];

export const CONTEXT_POLICIES = [
  "none",
  "target",
  "target_and_selection",
  "full",
] as const satisfies readonly ContextPolicy[];

export const PROMPT_PRESETS = [
  "minimalist_cleanup",
  "application_context",
  "email",
  "meeting",
  "notes",
  "generic",
] as const satisfies readonly PromptPreset[];

export const TONES = [
  "casual",
  "semi_casual",
  "balanced",
  "semi_formal",
  "formal",
] as const satisfies readonly Tone[];

export const REQUESTED_ENGINES = [
  "local",
  "deepgram_nova_3",
  "eleven_labs_scribe_v2",
] as const satisfies readonly RequestedEngine[];

export const PASTE_METHODS = [
  "ctrl_v",
  "direct",
  "none",
  "shift_insert",
  "ctrl_shift_v",
  "external_script",
] as const satisfies readonly PasteMethod[];

export const CLIPBOARD_HANDLING = [
  "copy_to_clipboard",
  "dont_modify",
] as const satisfies readonly ClipboardHandling[];

export const AUTO_SUBMIT_KEYS = [
  "enter",
  "ctrl_enter",
  "cmd_enter",
] as const satisfies readonly AutoSubmitKey[];

export const TYPING_TOOLS = [
  "auto",
  "wtype",
  "kwtype",
  "dotool",
  "ydotool",
  "xdotool",
] as const satisfies readonly TypingTool[];

export const DEFAULT_FALLBACK_MODEL_OPTION = "__mode_local_model__";

/* Every mutation error the backend can return needs a sentence. The
 * `satisfies` keeps this exhaustive when a new variant lands, and the values
 * are inline i18n defaults so no locale file has to be edited here. */
export const MODE_MUTATION_ERROR_DEFAULTS = {
  stale_revision:
    "Settings changed elsewhere. Review the latest mode and save again.",
  invalid_mode_id: "This mode ID is invalid.",
  empty_name: "A mode name is required.",
  cannot_delete_default: "The default mode cannot be deleted.",
  unknown_mode: "That mode no longer exists.",
  duplicate_mode_id: "A mode with this ID already exists.",
  invalid_reorder: "The mode order could not be saved.",
  invalid_app_identity: "That application could not be identified.",
  frontmost_application_unavailable:
    "No application in front could be captured.",
  invalid_website_host: "This website host is invalid.",
  website_activation_consent_required:
    "Enable Browser URLs in Privacy before adding a website rule.",
  frontmost_website_unavailable: "No browser website could be captured.",
  website_activation_secure_field:
    "Website rules cannot be captured from a secure field.",
} as const satisfies Record<ModeMutationError["kind"], string>;

export const downloadedModelOptions = (
  models: ModelInfo[],
): DropdownOption[] => {
  const options: DropdownOption[] = [];
  for (const model of models) {
    if (model.is_downloaded) {
      options.push({ value: model.id, label: model.name });
    }
  }
  return options;
};

export const modeDefinitionFromView = (mode: ModeView): ModeDefinition => ({
  id: mode.id,
  name: mode.name,
  tone: mode.tone,
  context_policy: mode.context_policy,
  asr: {
    ...mode.asr,
    custom_words: [...mode.asr.custom_words],
    custom_filler_words: mode.asr.custom_filler_words
      ? [...mode.asr.custom_filler_words]
      : null,
    cloud_keyterms: mode.asr.cloud_keyterms ? [...mode.asr.cloud_keyterms] : [],
  },
  llm: { ...mode.llm },
  prompt: { ...mode.prompt },
  delivery: { ...mode.delivery },
});

/* A cloud run without word timestamps is not trustworthy enough to deliver,
 * so the backend rejects it. Repair the draft on the way to Save instead of
 * letting the user hit a rejection they cannot see the cause of. */
export const modeWithRequiredCloudTimestamps = (
  mode: ModeDefinition,
): ModeDefinition => {
  if (
    !cloudSttProviderForEngine(mode.asr.requested_engine) ||
    mode.asr.cloud_timestamps
  ) {
    return mode;
  }

  return {
    ...mode,
    asr: { ...mode.asr, cloud_timestamps: true },
  };
};

/* The default mode's dictation chord is the app-wide `transcribe` binding, not
 * a mode-scoped one. Every other chord is derived from the mode ID. */
export const modeBindingId = (
  modeId: string,
  kind: "transcribe" | "switch",
): string =>
  kind === "transcribe" && modeId === DEFAULT_MODE_ID
    ? "transcribe"
    : `mode/${modeId}/${kind}`;

/* CONTEXT_POLICIES is ordered least to most revealing, so index order is the
 * escalation order the privacy ceiling clamps against. */
export const hasHigherPolicy = (
  policy: ContextPolicy,
  ceiling: ContextPolicy,
): boolean =>
  CONTEXT_POLICIES.indexOf(policy) > CONTEXT_POLICIES.indexOf(ceiling);

/* Both sides of this comparison are built by `modeDefinitionFromView` and the
 * draft only ever replaces existing keys, so key order matches and a string
 * compare is enough to tell a touched draft from a saved one. A wrong answer
 * would only mislabel the header, never lose an edit. */
export const modeDraftIsDirty = (
  draft: ModeDefinition,
  saved: ModeView | undefined,
): boolean =>
  saved !== undefined &&
  JSON.stringify(draft) !== JSON.stringify(modeDefinitionFromView(saved));

export interface ModeDraftUpdaters {
  update: <K extends keyof ModeDefinition>(
    key: K,
    value: ModeDefinition[K],
  ) => void;
  updateAsr: <K extends keyof ModeAsrSettings>(
    key: K,
    value: ModeAsrSettings[K],
  ) => void;
  updateLlm: <K extends keyof ModeLlmSettings>(
    key: K,
    value: ModeLlmSettings[K],
  ) => void;
  updatePrompt: <K extends keyof ModePromptSettings>(
    key: K,
    value: ModePromptSettings[K],
  ) => void;
  updateDelivery: <K extends keyof ModeDeliverySettings>(
    key: K,
    value: ModeDeliverySettings[K],
  ) => void;
  replace: (mode: ModeDefinition) => void;
}

export const createModeDraftUpdaters = (
  mode: ModeDefinition,
  onChange: (next: ModeDefinition) => void,
): ModeDraftUpdaters => ({
  update: <K extends keyof ModeDefinition>(key: K, value: ModeDefinition[K]) =>
    onChange({ ...mode, [key]: value }),
  updateAsr: <K extends keyof ModeAsrSettings>(
    key: K,
    value: ModeAsrSettings[K],
  ) => onChange({ ...mode, asr: { ...mode.asr, [key]: value } }),
  updateLlm: <K extends keyof ModeLlmSettings>(
    key: K,
    value: ModeLlmSettings[K],
  ) => onChange({ ...mode, llm: { ...mode.llm, [key]: value } }),
  updatePrompt: <K extends keyof ModePromptSettings>(
    key: K,
    value: ModePromptSettings[K],
  ) => onChange({ ...mode, prompt: { ...mode.prompt, [key]: value } }),
  updateDelivery: <K extends keyof ModeDeliverySettings>(
    key: K,
    value: ModeDeliverySettings[K],
  ) => onChange({ ...mode, delivery: { ...mode.delivery, [key]: value } }),
  replace: onChange,
});

/* Cloud eligibility is probed once per editor mount, so the panels receive the
 * resolved answer instead of each running their own keyring query. */
export interface ModeCloudState {
  requestedEngine: RequestedEngine;
  selectedProvider: CloudSttProviderMetadata | undefined;
  /** A provider with a saved native key. Consent is tracked separately. */
  isConfigured: (provider: CloudSttProvider) => boolean;
  /** The selected cloud provider has both a key and current transfer consent. */
  controlsAvailable: boolean;
  selectEngine: (engine: RequestedEngine) => void;
}

export interface ModePanelProps {
  mode: ModeDefinition;
  updaters: ModeDraftUpdaters;
}
