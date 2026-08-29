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

/**
 * `t` narrowed to the two arguments this module uses. Taking the translator
 * instead of exporting a table keeps the mapping total and testable while
 * leaving i18n to the caller.
 */
export type ModeTranslate = (key: string, fallback: string) => string;

const engineSummary = (asr: ModeAsrSettings, t: ModeTranslate): string => {
  /* Absent deserializes as local: an older mode predates the engine choice. */
  switch (asr.requested_engine ?? "local") {
    case "deepgram_nova_3":
      return t("settings.modes.summary.engine.deepgram_nova_3", "Deepgram");
    case "eleven_labs_scribe_v2":
      return t(
        "settings.modes.summary.engine.eleven_labs_scribe_v2",
        "ElevenLabs",
      );
    default:
      return t("settings.modes.summary.engine.local", "Local");
  }
};

/**
 * `ModeAsrSettings.model_id` is `ModelInfo.id`, and for anything from the
 * catalog that is `repo_id/filename` (`managers/model.rs:210-213`) — 65
 * characters at the median across the shipped catalog's 367 files and 116 at
 * the longest. Printing it raw would eat the row and push engine, language and
 * delivery off the end, so the row shows the model's display name, which the
 * same catalog caps at 42 characters plus a quant suffix.
 *
 * When the id resolves to nothing — the model was deleted, or the list has not
 * loaded yet — the fallback is its last path segment with a model extension
 * removed. That is not a second naming scheme: it is the filename, and the
 * filename stem is exactly the id the backend gives a locally discovered model
 * (`managers/model.rs:1959-1965`, then `:2039-2043`).
 *
 * Only `.bin` and `.gguf` come off, which is the same pair the backend strips.
 * Chopping any trailing dot-segment instead would turn the directory-based id
 * `parakeet-tdt-0.6b-v2` — which has no extension at all — into
 * `parakeet-tdt-0`.
 */
const MODEL_FILE_EXTENSIONS = [".bin", ".gguf"] as const;

const modelSummary = (
  asr: ModeAsrSettings,
  t: ModeTranslate,
  models: readonly ModelInfo[],
): string => {
  if (asr.model_id.length === 0)
    return t("settings.modes.summary.modelInherited", "Global model");
  const known = models.find((model) => model.id === asr.model_id);
  if (known) return known.name;
  const file = asr.model_id.slice(asr.model_id.lastIndexOf("/") + 1);
  const extension = MODEL_FILE_EXTENSIONS.find((candidate) =>
    file.endsWith(candidate),
  );
  return extension ? file.slice(0, -extension.length) : file;
};

const languageSummary = (asr: ModeAsrSettings, t: ModeTranslate): string =>
  asr.language === "auto" || asr.language.length === 0
    ? t("settings.modes.summary.languageAuto", "Auto")
    : asr.language;

const DELIVERY_SUMMARY_DEFAULTS = {
  ctrl_v: "Paste",
  direct: "Type",
  none: "No delivery",
  shift_insert: "Shift+Insert",
  ctrl_shift_v: "Paste plain",
  external_script: "Script",
} as const satisfies Record<PasteMethod, string>;

const deliverySummary = (
  delivery: ModeDeliverySettings,
  t: ModeTranslate,
): string =>
  t(
    `settings.modes.summary.delivery.${delivery.paste_method}`,
    DELIVERY_SUMMARY_DEFAULTS[delivery.paste_method],
  );

export const MODE_SUMMARY_SEPARATOR = " · ";

/**
 * The four values that decide what a dictation run in this mode will do:
 * `engine · model · language · delivery`. One line, so the list row can expose
 * a mode's whole configuration without opening the editor.
 */
export const modeConfigSummary = (
  mode: ModeDefinition | ModeView,
  t: ModeTranslate,
  models: readonly ModelInfo[],
): string =>
  [
    engineSummary(mode.asr, t),
    modelSummary(mode.asr, t, models),
    languageSummary(mode.asr, t),
    deliverySummary(mode.delivery, t),
  ].join(MODE_SUMMARY_SEPARATOR);

/**
 * The order the list would have after nudging one mode by one position.
 *
 * The list can be reordered two ways — dragging a row, or the move up/down
 * menu items — and the backend takes only a full ordered ID list. The drag
 * already produces one; this is what the keyboard path produces, so both
 * commit through the same command with the same shape. Returns the input
 * unchanged when the move would leave the list, which is what a disabled
 * menu item means.
 */
export const orderWithMove = (
  orderedIds: readonly string[],
  modeId: string,
  direction: -1 | 1,
): string[] => {
  const from = orderedIds.indexOf(modeId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= orderedIds.length) return [...orderedIds];
  const next = [...orderedIds];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
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
