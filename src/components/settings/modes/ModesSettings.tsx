import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Ellipsis, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type CloudSttProvider,
  type ContextPolicy,
  type ModeActivationRule,
  type ModeDefinition,
  type ModeMutationError,
  type ModeSettingsSnapshot,
  type ModeWebsiteActivationRule,
  type ModelInfo,
  type ModeView,
  type PostProcessProvider,
  type PromptPreset,
  type RequestedEngine,
  type SecretState,
  type Tone,
  type VocabularyEntry,
  type WebsiteHostMatch,
} from "@/bindings";

import {
  CLOUD_STT_PROVIDERS,
  cloudSttProviderForEngine,
  cloudSttProviderHasCurrentConsent,
  type CloudSttProviderMetadata,
} from "@/lib/cloudStt";
import { SELECTABLE_LANGUAGES } from "@/lib/constants/languages";
import { useSettings } from "@/hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Dropdown, type DropdownOption } from "../../ui/Dropdown";
import { Input } from "../../ui/Input";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { Textarea } from "../../ui/Textarea";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { ShortcutInput } from "../ShortcutInput";
import { CustomWords } from "../CustomWords";
import "../settings-density.css";

const DEFAULT_MODE_ID = "message";

type ModeVocabularyEntry = VocabularyEntry;
type ModeEditorTab =
  | "recognition"
  | "rewrite"
  | "context"
  | "delivery"
  | "automation";

const MODE_EDITOR_TABS: readonly ModeEditorTab[] = [
  "recognition",
  "rewrite",
  "context",
  "delivery",
  "automation",
];
const WEBSITE_HOST_MATCHES = ["exact", "suffix"] as const satisfies readonly WebsiteHostMatch[];
const CONTEXT_POLICIES = [
  "none",
  "target",
  "target_and_selection",
  "full",
] as const satisfies readonly ContextPolicy[];

const PROMPT_PRESETS = [
  "minimalist_cleanup",
  "application_context",
  "email",
  "meeting",
  "notes",
  "generic",
] as const satisfies readonly PromptPreset[];

const TONES = [
  "casual",
  "semi_casual",
  "balanced",
  "semi_formal",
  "formal",
] as const satisfies readonly Tone[];

const PASTE_METHODS = [
  "ctrl_v",
  "direct",
  "none",
  "shift_insert",
  "ctrl_shift_v",
  "external_script",
] as const;

const CLIPBOARD_HANDLING = ["copy_to_clipboard", "dont_modify"] as const;
const AUTO_SUBMIT_KEYS = ["enter", "ctrl_enter", "cmd_enter"] as const;
const TYPING_TOOLS = [
  "auto",
  "wtype",
  "kwtype",
  "dotool",
  "ydotool",
  "xdotool",
] as const;

const DEFAULT_FALLBACK_MODEL_OPTION = "__mode_local_model__";
const EMPTY_POST_PROCESS_PROVIDERS: PostProcessProvider[] = [];

const downloadedModelOptions = (models: ModelInfo[]): DropdownOption[] => {
  const options: DropdownOption[] = [];
  for (const model of models) {
    if (model.is_downloaded) {
      options.push({ value: model.id, label: model.name });
    }
  }
  return options;
};

const modeDefinitionFromView = (mode: ModeView): ModeDefinition => ({
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

const modeWithRequiredCloudTimestamps = (
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
const modeBindingId = (modeId: string, kind: "transcribe" | "switch") =>
  kind === "transcribe" && modeId === DEFAULT_MODE_ID
    ? "transcribe"
    : `mode/${modeId}/${kind}`;

const hasHigherPolicy = (policy: ContextPolicy, ceiling: ContextPolicy) =>
  CONTEXT_POLICIES.indexOf(policy) > CONTEXT_POLICIES.indexOf(ceiling);

const modeId = () => `mode-${crypto.randomUUID()}`;

interface ModeEditorProps {
  mode: ModeDefinition;
  modeCount: number;
  models: ModelInfo[];
  onChange: (mode: ModeDefinition) => void;
  onSave: () => void;
  saving: boolean;
  conflict: boolean;
  activationRules: ModeActivationRule[];
  websiteActivationRules: ModeWebsiteActivationRule[];
  activationSupported: boolean;
  capturingActivation: boolean;
  onCaptureActivation: () => void;
  onRemoveActivation: (appId: string) => void;
  onCaptureWebsiteActivation: (matchKind: WebsiteHostMatch) => void;
  onRemoveWebsiteActivation: (
    host: string,
    matchKind: WebsiteHostMatch,
  ) => void;
}

const useModeEditor = ({
  mode,
  modeCount,
  models,
  onChange,
  onSave,
  saving,
  conflict,
  activationRules,
  websiteActivationRules,
  activationSupported,
  capturingActivation,
  onCaptureActivation,
  onRemoveActivation,
  onCaptureWebsiteActivation,
  onRemoveWebsiteActivation,
}: ModeEditorProps) => {
  const { t } = useTranslation();
  const { refreshSettings, settings } = useSettings();
  const [websiteMatchKind, setWebsiteMatchKind] =
    useState<WebsiteHostMatch>("exact");
  const [activeTab, setActiveTab] =
    useState<ModeEditorTab>("recognition");
  const ceiling = settings?.context_policy_ceiling ?? "none";
  const websiteCaptureEnabled =
    settings?.context_url_capture_enabled ?? false;
  const providers =
    settings?.post_process_providers ?? EMPTY_POST_PROCESS_PROVIDERS;
  const modeActivationRules = activationRules.filter(
    (rule) => rule.mode_id === mode.id,
  );
  const modeWebsiteActivationRules = websiteActivationRules.filter(
    (rule) => rule.mode_id === mode.id,
  );

  const localModelOptions = useMemo<DropdownOption[]>(() => {
    const options = downloadedModelOptions(models);
    if (!options.some((option) => option.value === mode.asr.model_id)) {
      options.unshift({
        value: mode.asr.model_id,
        label:
          mode.asr.model_id || t("settings.modes.recognition.noModelSelected"),
      });
    }
    return options;
  }, [mode.asr.model_id, models, t]);

  const fallbackModelOptions = useMemo<DropdownOption[]>(() => {
    const options = downloadedModelOptions(models);
    const selectedFallbackModel = mode.asr.local_fallback_model_id;
    if (
      selectedFallbackModel &&
      !options.some((option) => option.value === selectedFallbackModel)
    ) {
      options.unshift({
        value: selectedFallbackModel,
        label: selectedFallbackModel,
      });
    }
    return [
      {
        value: DEFAULT_FALLBACK_MODEL_OPTION,
        label: t("settings.modes.recognition.cloud.fallback.useModeModel"),
      },
      ...options,
    ];
  }, [mode.asr.local_fallback_model_id, models, t]);

  const providerOptions = useMemo<DropdownOption[]>(() => {
    const options = providers.map((provider) => ({
      value: provider.id,
      label: provider.label,
    }));
    if (
      mode.llm.provider_id &&
      !options.some((option) => option.value === mode.llm.provider_id)
    ) {
      options.unshift({
        value: mode.llm.provider_id,
        label: mode.llm.provider_id,
      });
    }
    return options;
  }, [mode.llm.provider_id, providers]);

  const [cloudSecretStates, setCloudSecretStates] = useState<
    Map<CloudSttProvider, SecretState>
  >(() => new Map());
  const [pendingCloudConsent, setPendingCloudConsent] =
    useState<CloudSttProviderMetadata | null>(null);
  const [cloudConsentError, setCloudConsentError] = useState<
    "unknown_provider" | "backend" | null
  >(null);
  const [acceptingCloudConsent, setAcceptingCloudConsent] = useState(false);
  const vocabularyKeysRef = useRef(new WeakMap<ModeVocabularyEntry, string>());
  const nextVocabularyKeyRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const loadCloudSecretStates = async () => {
      const next = new Map<CloudSttProvider, SecretState>();
      await Promise.all(
        CLOUD_STT_PROVIDERS.map(async (provider) => {
          try {
            const result = await commands.getProviderSecretState(
              "stt",
              provider.secretAccountId,
            );
            if (result.status === "ok") {
              next.set(provider.provider, result.data);
            }
          } catch {
            // A failed keyring probe must not create a selectable cloud route.
          }
        }),
      );
      if (!cancelled) setCloudSecretStates(next);
    };

    void loadCloudSecretStates();
    return () => {
      cancelled = true;
    };
  }, []);

  const configuredCloudProviders = useMemo(
    () =>
      CLOUD_STT_PROVIDERS.filter(
        (provider) => cloudSecretStates.get(provider.provider)?.configured,
      ),
    [cloudSecretStates],
  );
  const requestedEngine = mode.asr.requested_engine ?? "local";
  const selectedCloudProvider = cloudSttProviderForEngine(requestedEngine);
  const selectedCloudConfigured = Boolean(
    selectedCloudProvider &&
      cloudSecretStates.get(selectedCloudProvider.provider)?.configured,
  );
  const selectedCloudConsentCurrent = Boolean(
    selectedCloudProvider &&
      cloudSttProviderHasCurrentConsent(
        settings?.cloud_stt_providers,
        selectedCloudProvider.provider,
      ),
  );
  const cloudControlsAvailable =
    selectedCloudConfigured && selectedCloudConsentCurrent;

  const update = <K extends keyof ModeDefinition>(
    key: K,
    value: ModeDefinition[K],
  ) => onChange({ ...mode, [key]: value });

  const updateAsr = <K extends keyof ModeDefinition["asr"]>(
    key: K,
    value: ModeDefinition["asr"][K],
  ) => onChange({ ...mode, asr: { ...mode.asr, [key]: value } });

  const getVocabularyRowKey = (entry: ModeVocabularyEntry) => {
    const existingKey = vocabularyKeysRef.current.get(entry);
    if (existingKey) return existingKey;

    const nextKey = `mode-vocabulary-${nextVocabularyKeyRef.current}`;
    nextVocabularyKeyRef.current += 1;
    vocabularyKeysRef.current.set(entry, nextKey);
    return nextKey;
  };

  const selectCloudEngine = (provider: CloudSttProviderMetadata) => {
    onChange({
      ...mode,
      asr: {
        ...mode.asr,
        requested_engine: provider.provider,
        local_fallback_enabled: mode.asr.local_fallback_enabled ?? true,
        cloud_timestamps: true,
      },
    });
  };

  const changeEngine = (engine: RequestedEngine) => {
    if (engine === "local") {
      updateAsr("requested_engine", engine);
      return;
    }

    const provider = cloudSttProviderForEngine(engine);
    if (!provider || !cloudSecretStates.get(provider.provider)?.configured) {
      return;
    }
    if (
      !cloudSttProviderHasCurrentConsent(
        settings?.cloud_stt_providers,
        provider.provider,
      )
    ) {
      setCloudConsentError(null);
      setPendingCloudConsent(provider);
      return;
    }
    selectCloudEngine(provider);
  };

  const acceptCloudConsent = async () => {
    if (!pendingCloudConsent) return;

    setAcceptingCloudConsent(true);
    setCloudConsentError(null);
    try {
      const result = await commands.acceptCloudSttProviderConsent(
        pendingCloudConsent.provider,
      );
      if (result.status === "ok") {
        await refreshSettings();
        selectCloudEngine(pendingCloudConsent);
        setPendingCloudConsent(null);
      } else {
        setCloudConsentError(result.error);
      }
    } catch {
      setCloudConsentError("backend");
    } finally {
      setAcceptingCloudConsent(false);
    }
  };

  const updateLlm = <K extends keyof ModeDefinition["llm"]>(
    key: K,
    value: ModeDefinition["llm"][K],
  ) => onChange({ ...mode, llm: { ...mode.llm, [key]: value } });

  const updatePrompt = <K extends keyof ModeDefinition["prompt"]>(
    key: K,
    value: ModeDefinition["prompt"][K],
  ) => onChange({ ...mode, prompt: { ...mode.prompt, [key]: value } });

  const updateDelivery = <K extends keyof ModeDefinition["delivery"]>(
    key: K,
    value: ModeDefinition["delivery"][K],
  ) => onChange({ ...mode, delivery: { ...mode.delivery, [key]: value } });

  const updateNumber = (
    key: "paste_delay_ms" | "paste_delay_after_ms",
    value: string,
  ) => {
    const next = Number.parseInt(value, 10);
    if (Number.isFinite(next) && next >= 0) {
      updateDelivery(key, next);
    }
  };

  const updateVocabularyEntry = (
    index: number,
    field: "spoken" | "written",
    value: string,
  ) => {
    const entries = mode.asr.custom_words.map((entry, row) => {
      if (row !== index) return entry;
      const next = { ...entry, [field]: value };
      vocabularyKeysRef.current.set(next, getVocabularyRowKey(entry));
      return next;
    });
    updateAsr("custom_words", entries);
  };

  const hasIncompleteVocabulary = mode.asr.custom_words.some(
    (entry) => entry.spoken.trim() === "" || entry.written.trim() === "",
  );
  const missingLocalFallbackModel =
    cloudControlsAvailable &&
    (mode.asr.local_fallback_enabled ?? true) &&
    !mode.asr.model_id.trim() &&
    !mode.asr.local_fallback_model_id?.trim();

  return (
    <div className="mode-detail">
      <div className="mode-detail-header">
        <div>
          <h2>{mode.name}</h2>
        </div>
        <Button
          size="sm"
          onClick={onSave}
          disabled={
            saving ||
            capturingActivation ||
            mode.name.trim() === "" ||
            hasIncompleteVocabulary ||
            missingLocalFallbackModel
          }
        >
          {saving ? t("settings.modes.saving") : t("settings.modes.save")}
        </Button>
      </div>

      {conflict ? (
        <div className="inline-error" role="alert">
          {t("settings.modes.errors.staleRevision")}
        </div>
      ) : null}

      <div
        className="mode-editor-tabs"
        role="tablist"
        aria-label={t("settings.modes.editorTabsLabel")}
      >
        {MODE_EDITOR_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          >
            {t(`settings.modes.tabs.${tab}`)}
          </button>
        ))}
      </div>

      <div
        className="mode-editor-panel"
        role="tabpanel"
        aria-label={t(`settings.modes.tabs.${activeTab}`)}
      >
        <SettingContainer
          layout="stacked"
          title={t("settings.modes.identity.name.label")}
          description={t("settings.modes.identity.name.description")}
          controlId="mode-name"
        >
          <Input
            id="mode-name"
            value={mode.name}
            onChange={(event) => update("name", event.target.value)}
            maxLength={120}
            className="w-full"
          />
        </SettingContainer>

      {activeTab === "automation" && activationSupported && (
        <SettingsGroup title={t("settings.modes.activation.title")}>
          <SettingContainer
            grouped
            layout="stacked"
            title={t("settings.modes.activation.capture.label")}
            description={t("settings.modes.activation.capture.description")}
          >
            <div className="space-y-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving || capturingActivation}
                onClick={onCaptureActivation}
              >
                {capturingActivation
                  ? t("settings.modes.activation.capture.capturing")
                  : t("settings.modes.activation.capture.action")}
              </Button>
              {modeActivationRules.length === 0 ? (
                <p role="status" className="text-xs text-text-secondary">
                  {t("settings.modes.activation.empty")}
                </p>
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {modeActivationRules.map((rule) => (
                    <li
                      key={rule.app_id}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <code className="min-w-0 truncate text-xs text-text-secondary">
                        {rule.app_id}
                      </code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={saving || capturingActivation}
                        onClick={() => onRemoveActivation(rule.app_id)}
                      >
                        {t("settings.modes.activation.remove")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SettingContainer>
        </SettingsGroup>
      )}

      {activeTab === "automation" && activationSupported && websiteCaptureEnabled && (
        <SettingsGroup title={t("settings.modes.activation.website.title")}>
          <SettingContainer
            grouped
            title={t("settings.modes.activation.website.scope.label")}
            description={t(
              "settings.modes.activation.website.scope.description",
            )}
          >
            <Dropdown
              selectedValue={websiteMatchKind}
              options={WEBSITE_HOST_MATCHES.map((matchKind) => ({
                value: matchKind,
                label: t(
                  `settings.modes.activation.website.scope.values.${matchKind}`,
                ),
              }))}
              onSelect={(value) => {
                const matchKind = WEBSITE_HOST_MATCHES.find(
                  (candidate) => candidate === value,
                );
                if (matchKind) setWebsiteMatchKind(matchKind);
              }}
            />
          </SettingContainer>
          <SettingContainer
            grouped
            layout="stacked"
            title={t("settings.modes.activation.website.capture.label")}
            description={t(
              "settings.modes.activation.website.capture.description",
            )}
          >
            <div className="space-y-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving || capturingActivation}
                onClick={() => onCaptureWebsiteActivation(websiteMatchKind)}
              >
                {capturingActivation
                  ? t("settings.modes.activation.website.capture.capturing")
                  : t("settings.modes.activation.website.capture.action")}
              </Button>
              {modeWebsiteActivationRules.length === 0 ? (
                <p role="status" className="text-xs text-text-secondary">
                  {t("settings.modes.activation.website.empty")}
                </p>
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {modeWebsiteActivationRules.map((rule) => (
                    <li
                      key={`${rule.host}:${rule.match_kind}`}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <div className="min-w-0">
                        <code className="block truncate text-xs text-text-secondary">
                          {rule.host}
                        </code>
                        <span className="text-xs text-text-secondary">
                          {t(
                            `settings.modes.activation.website.scope.values.${rule.match_kind}`,
                          )}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={saving || capturingActivation}
                        onClick={() =>
                          onRemoveWebsiteActivation(
                            rule.host,
                            rule.match_kind,
                          )
                        }
                      >
                        {t("settings.modes.activation.remove")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SettingContainer>
        </SettingsGroup>
      )}

      {activeTab === "rewrite" ? (
        <SettingsGroup title={t("settings.modes.writing.title")}>
        <ToggleSwitch
          grouped
          checked={mode.llm.enabled}
          onChange={(enabled) => updateLlm("enabled", enabled)}
          label={t("settings.modes.writing.enabled.label")}
          description={t("settings.modes.writing.enabled.description")}
        />
        <SettingContainer
          grouped
          title={t("settings.modes.writing.preset.label")}
          description={t("settings.modes.writing.preset.description")}
        >
          <Dropdown
            selectedValue={mode.prompt.preset}
            options={PROMPT_PRESETS.map((preset) => ({
              value: preset,
              label: t(`settings.modes.writing.preset.values.${preset}`),
            }))}
            onSelect={(preset) => {
              const next = PROMPT_PRESETS.find(
                (candidate) => candidate === preset,
              );
              if (next) updatePrompt("preset", next);
            }}
            disabled={!mode.llm.enabled}
          />
        </SettingContainer>
        <SettingContainer
          grouped
          layout="stacked"
          title={t("settings.modes.writing.tone.label")}
          description={t("settings.modes.writing.tone.description")}
        >
          <fieldset
            className="flex flex-wrap gap-1"
            disabled={!mode.llm.enabled}
          >
            <legend className="sr-only">
              {t("settings.modes.writing.tone.label")}
            </legend>
            {TONES.map((tone) => (
              <label key={tone} className="cursor-pointer">
                <input
                  type="radio"
                  name="mode-tone"
                  value={tone}
                  checked={mode.tone === tone}
                  onChange={() => update("tone", tone)}
                  className="peer sr-only"
                />
                <span className="inline-flex min-h-8 items-center rounded-md border border-border px-2 text-xs font-medium text-text-secondary transition-colors peer-checked:border-border-strong peer-checked:bg-subtle peer-checked:text-text-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-strong">
                  {t(`settings.modes.writing.tone.values.${tone}`)}
                </span>
              </label>
            ))}
          </fieldset>
        </SettingContainer>
        <SettingContainer
          grouped
          title={t("settings.modes.writing.provider.label")}
          description={t("settings.modes.writing.provider.description")}
        >
          <Dropdown
            selectedValue={mode.llm.provider_id}
            options={providerOptions}
            onSelect={(providerId) => updateLlm("provider_id", providerId)}
            disabled={!mode.llm.enabled || providerOptions.length === 0}
            placeholder={t("settings.modes.writing.provider.empty")}
          />
        </SettingContainer>
        <SettingContainer
          grouped
          layout="stacked"
          title={t("settings.modes.writing.model.label")}
          description={t("settings.modes.writing.model.description")}
          controlId="mode-llm-model"
        >
          <Input
            id="mode-llm-model"
            value={mode.llm.model_id}
            onChange={(event) => updateLlm("model_id", event.target.value)}
            disabled={!mode.llm.enabled}
            className="w-full"
          />
        </SettingContainer>
        </SettingsGroup>
      ) : null}

      {activeTab === "recognition" ? (
        <SettingsGroup title={t("settings.modes.recognition.title")}>
        <SettingContainer
          grouped
          title={t("settings.modes.recognition.engine.label")}
          description={t("settings.modes.recognition.engine.description")}
          controlId="mode-engine"
        >
          <select
            aria-label={t("settings.modes.recognition.engine.label")}
            id="mode-engine"
            value={requestedEngine}
            onChange={(event) => {
              // SAFETY: every rendered option is a RequestedEngine value.
              changeEngine(event.target.value as RequestedEngine);
            }}
            className="min-h-9 min-w-0 rounded-md border border-border bg-surface px-3 text-sm font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
          >
            <option value="local">
              {t("settings.modes.recognition.engine.local")}
            </option>
            {configuredCloudProviders.length > 0 && (
              <optgroup label={t("settings.modes.recognition.engine.cloud")}>
                {configuredCloudProviders.map((provider) => (
                  <option key={provider.provider} value={provider.provider}>
                    {t(provider.labelKey)}
                  </option>
                ))}
              </optgroup>
            )}
            {selectedCloudProvider &&
              !configuredCloudProviders.some(
                (provider) =>
                  provider.provider === selectedCloudProvider.provider,
              ) && (
                <option value={selectedCloudProvider.provider} disabled>
                  {t("settings.modes.recognition.engine.unavailable", {
                    provider: t(selectedCloudProvider.labelKey),
                  })}
                </option>
              )}
          </select>
        </SettingContainer>
        {!selectedCloudProvider && (
          <SettingContainer
            grouped
            title={t("settings.modes.recognition.model.label")}
            description={t("settings.modes.recognition.model.description")}
          >
            <Dropdown
              selectedValue={mode.asr.model_id}
              options={localModelOptions}
              onSelect={(modelId) => updateAsr("model_id", modelId)}
              placeholder={t("settings.modes.recognition.noModelSelected")}
            />
          </SettingContainer>
        )}
        <SettingContainer
          grouped
          title={t("settings.modes.recognition.language.label")}
          description={
            selectedCloudProvider
              ? t("settings.modes.recognition.language.cloudDescription")
              : t("settings.modes.recognition.language.description")
          }
        >
          <Dropdown
            selectedValue={mode.asr.language}
            options={SELECTABLE_LANGUAGES.map((language) => ({
              value: language.value,
              label:
                language.value === "auto"
                  ? t("settings.modes.recognition.language.auto")
                  : language.label,
            }))}
            onSelect={(language) => updateAsr("language", language)}
          />
        </SettingContainer>
        {selectedCloudProvider && !cloudControlsAvailable && (
          <p role="status" className="px-4 pb-3 text-sm text-text-secondary">
            {t("settings.modes.recognition.cloud.setupRequired", {
              provider: t(selectedCloudProvider.labelKey),
            })}
          </p>
        )}
        {selectedCloudProvider && cloudControlsAvailable && (
          <>
            <ToggleSwitch
              grouped
              checked={mode.asr.local_fallback_enabled ?? true}
              onChange={(enabled) =>
                updateAsr("local_fallback_enabled", enabled)
              }
              label={t("settings.modes.recognition.cloud.fallback.label")}
              description={t(
                "settings.modes.recognition.cloud.fallback.description",
              )}
            />
            {(mode.asr.local_fallback_enabled ?? true) && (
              <SettingContainer
                grouped
                title={t(
                  "settings.modes.recognition.cloud.fallback.model.label",
                )}
                description={t(
                  "settings.modes.recognition.cloud.fallback.model.description",
                )}
              >
                <Dropdown
                  selectedValue={
                    mode.asr.local_fallback_model_id ??
                    DEFAULT_FALLBACK_MODEL_OPTION
                  }
                  options={fallbackModelOptions}
                  onSelect={(modelId) =>
                    updateAsr(
                      "local_fallback_model_id",
                      modelId === DEFAULT_FALLBACK_MODEL_OPTION
                        ? null
                        : modelId,
                    )
                  }
                />
              </SettingContainer>
            )}
            {missingLocalFallbackModel && (
              <p role="alert" className="px-4 pb-3 text-sm text-danger">
                {t("settings.modes.recognition.cloud.fallback.model.required")}
              </p>
            )}
            <SettingContainer
              grouped
              layout="stacked"
              title={t("settings.modes.recognition.cloud.keyterms.label")}
              description={t(
                "settings.modes.recognition.cloud.keyterms.description",
              )}
              controlId="mode-cloud-keyterms"
            >
              <Textarea
                id="mode-cloud-keyterms"
                value={mode.asr.cloud_keyterms?.join("\n") ?? ""}
                onChange={(event) =>
                  updateAsr(
                    "cloud_keyterms",
                    event.target.value
                      .split("\n")
                      .map((keyterm) => keyterm.trim())
                      .filter((keyterm) => keyterm.length > 0),
                  )
                }
                placeholder={t(
                  "settings.modes.recognition.cloud.keyterms.placeholder",
                )}
                rows={3}
                className="w-full"
              />
            </SettingContainer>
            <ToggleSwitch
              grouped
              checked
              disabled
              onChange={() => undefined}
              label={t("settings.modes.recognition.cloud.timestamps.label")}
              description={t(
                "settings.modes.recognition.cloud.timestamps.description",
              )}
            />
          </>
        )}
        <ToggleSwitch
          grouped
          checked={mode.asr.translate_to_english}
          onChange={(enabled) => updateAsr("translate_to_english", enabled)}
          label={t("settings.modes.recognition.translate.label")}
          description={t("settings.modes.recognition.translate.description")}
        />
        <ToggleSwitch
          grouped
          checked={mode.asr.vad_enabled}
          onChange={(enabled) => updateAsr("vad_enabled", enabled)}
          label={t("settings.modes.recognition.vad.label")}
          description={t("settings.modes.recognition.vad.description")}
        />
        <ToggleSwitch
          grouped
          checked={mode.asr.literal_punctuation ?? false}
          onChange={(enabled) => updateAsr("literal_punctuation", enabled)}
          label={t("settings.modes.recognition.literalPunctuation.label")}
          description={t(
            "settings.modes.recognition.literalPunctuation.description",
          )}
        />
        <ToggleSwitch
          grouped
          checked={mode.asr.filler_word_removal_enabled}
          onChange={(enabled) =>
            updateAsr("filler_word_removal_enabled", enabled)
          }
          label={t("settings.modes.recognition.fillerRemoval.label")}
          description={t(
            "settings.modes.recognition.fillerRemoval.description",
          )}
        />
        <SettingContainer
          grouped
          layout="stacked"
          title={t("settings.modes.recognition.vocabulary.label")}
          description={t("settings.modes.recognition.vocabulary.description")}
        >
          <div className="space-y-2">
            {mode.asr.custom_words.map((entry, index) => (
              <div
                key={getVocabularyRowKey(entry)}
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <Input
                  value={entry.spoken}
                  onChange={(event) =>
                    updateVocabularyEntry(index, "spoken", event.target.value)
                  }
                  placeholder={t(
                    "settings.modes.recognition.vocabulary.spokenPlaceholder",
                  )}
                  aria-label={t("settings.modes.recognition.vocabulary.spoken")}
                />
                <Input
                  value={entry.written}
                  onChange={(event) =>
                    updateVocabularyEntry(index, "written", event.target.value)
                  }
                  placeholder={t(
                    "settings.modes.recognition.vocabulary.writtenPlaceholder",
                  )}
                  aria-label={t(
                    "settings.modes.recognition.vocabulary.written",
                  )}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2"
                  onClick={() =>
                    updateAsr(
                      "custom_words",
                      mode.asr.custom_words.filter((_, row) => row !== index),
                    )
                  }
                  aria-label={t(
                    "settings.modes.recognition.vocabulary.remove",
                    {
                      spoken: entry.spoken,
                    },
                  )}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              className="gap-1"
              onClick={() => {
                const entry = { spoken: "", written: "" };
                vocabularyKeysRef.current.set(
                  entry,
                  `mode-vocabulary-${nextVocabularyKeyRef.current}`,
                );
                nextVocabularyKeyRef.current += 1;
                updateAsr("custom_words", [...mode.asr.custom_words, entry]);
              }}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {t("settings.modes.recognition.vocabulary.add")}
            </Button>
            {hasIncompleteVocabulary && (
              <p role="alert" className="text-xs text-danger">
                {t("settings.modes.recognition.vocabulary.incomplete")}
              </p>
            )}
          </div>
        </SettingContainer>
        </SettingsGroup>
      ) : null}

      {activeTab === "context" ? (
        <SettingsGroup title={t("settings.modes.context.title")}>
        <SettingContainer
          grouped
          layout="stacked"
          title={t("settings.modes.context.policy.label")}
          description={t("settings.modes.context.policy.description")}
        >
          <fieldset className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            <legend className="sr-only">
              {t("settings.modes.context.policy.label")}
            </legend>
            {CONTEXT_POLICIES.map((policy) => {
              const blocked = hasHigherPolicy(policy, ceiling);
              return (
                <label
                  key={policy}
                  className={blocked ? "cursor-not-allowed" : "cursor-pointer"}
                >
                  <input
                    type="radio"
                    name="mode-context-policy"
                    value={policy}
                    checked={mode.context_policy === policy}
                    disabled={blocked}
                    onChange={() => update("context_policy", policy)}
                    className="peer sr-only"
                  />
                  <span className="flex min-h-8 items-center justify-center rounded-md border border-border px-2 text-center text-xs font-medium text-text-secondary transition-colors peer-checked:border-border-strong peer-checked:bg-subtle peer-checked:text-text-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-strong">
                    {t(`settings.modes.context.policy.values.${policy}`)}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {mode.context_policy !== "none" &&
            hasHigherPolicy(mode.context_policy, ceiling) && (
              <p className="mt-2 text-xs text-text-secondary">
                {t("settings.modes.context.policy.limitedByPrivacy")}
              </p>
            )}
        </SettingContainer>
        </SettingsGroup>
      ) : null}

      {activeTab === "delivery" ? (
        <SettingsGroup title={t("settings.modes.delivery.title")}>
        <SettingContainer
          grouped
          title={t("settings.modes.delivery.method.label")}
          description={t("settings.modes.delivery.method.description")}
        >
          <Dropdown
            selectedValue={mode.delivery.paste_method}
            options={PASTE_METHODS.map((method) => ({
              value: method,
              label: t(`settings.modes.delivery.method.values.${method}`),
            }))}
            onSelect={(method) => {
              const next = PASTE_METHODS.find(
                (candidate) => candidate === method,
              );
              if (next) updateDelivery("paste_method", next);
            }}
          />
        </SettingContainer>
        <SettingContainer
          grouped
          title={t("settings.modes.delivery.clipboard.label")}
          description={t("settings.modes.delivery.clipboard.description")}
        >
          <Dropdown
            selectedValue={mode.delivery.clipboard_handling}
            options={CLIPBOARD_HANDLING.map((handling) => ({
              value: handling,
              label: t(`settings.modes.delivery.clipboard.values.${handling}`),
            }))}
            onSelect={(handling) => {
              const next = CLIPBOARD_HANDLING.find(
                (candidate) => candidate === handling,
              );
              if (next) updateDelivery("clipboard_handling", next);
            }}
          />
        </SettingContainer>
        <ToggleSwitch
          grouped
          checked={mode.delivery.auto_submit}
          onChange={(enabled) => updateDelivery("auto_submit", enabled)}
          label={t("settings.modes.delivery.autoSubmit.label")}
          description={t("settings.modes.delivery.autoSubmit.description")}
        />
        <SettingContainer
          grouped
          title={t("settings.modes.delivery.autoSubmitKey.label")}
          description={t("settings.modes.delivery.autoSubmitKey.description")}
        >
          <Dropdown
            selectedValue={mode.delivery.auto_submit_key}
            options={AUTO_SUBMIT_KEYS.map((key) => ({
              value: key,
              label: t(`settings.modes.delivery.autoSubmitKey.values.${key}`),
            }))}
            onSelect={(key) => {
              const next = AUTO_SUBMIT_KEYS.find(
                (candidate) => candidate === key,
              );
              if (next) updateDelivery("auto_submit_key", next);
            }}
            disabled={!mode.delivery.auto_submit}
          />
        </SettingContainer>
        <ToggleSwitch
          grouped
          checked={mode.delivery.append_trailing_space}
          onChange={(enabled) =>
            updateDelivery("append_trailing_space", enabled)
          }
          label={t("settings.modes.delivery.trailingSpace.label")}
          description={t("settings.modes.delivery.trailingSpace.description")}
        />
        <ToggleSwitch
          grouped
          checked={mode.delivery.reliable_paste}
          onChange={(enabled) => updateDelivery("reliable_paste", enabled)}
          label={t("settings.modes.delivery.reliablePaste.label")}
          description={t("settings.modes.delivery.reliablePaste.description")}
        />
        <SettingContainer
          grouped
          layout="stacked"
          title={t("settings.modes.delivery.delay.label")}
          description={t("settings.modes.delivery.delay.description")}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="min-w-0 text-xs text-text-secondary">
              <span className="mb-1 block">
                {t("settings.modes.delivery.delay.before")}
              </span>
              <Input
                type="number"
                min="0"
                value={mode.delivery.paste_delay_ms}
                onChange={(event) =>
                  updateNumber("paste_delay_ms", event.target.value)
                }
                className="w-full"
              />
            </label>
            <label className="min-w-0 text-xs text-text-secondary">
              <span className="mb-1 block">
                {t("settings.modes.delivery.delay.after")}
              </span>
              <Input
                type="number"
                min="0"
                value={mode.delivery.paste_delay_after_ms}
                onChange={(event) =>
                  updateNumber("paste_delay_after_ms", event.target.value)
                }
                className="w-full"
              />
            </label>
          </div>
        </SettingContainer>
        <SettingContainer
          grouped
          title={t("settings.modes.delivery.typingTool.label")}
          description={t("settings.modes.delivery.typingTool.description")}
        >
          <Dropdown
            selectedValue={mode.delivery.typing_tool}
            options={TYPING_TOOLS.map((tool) => ({
              value: tool,
              label: t(`settings.modes.delivery.typingTool.values.${tool}`),
            }))}
            onSelect={(tool) => {
              const next = TYPING_TOOLS.find((candidate) => candidate === tool);
              if (next) updateDelivery("typing_tool", next);
            }}
            disabled={mode.delivery.paste_method !== "direct"}
          />
        </SettingContainer>
        {mode.delivery.paste_method === "external_script" && (
          <SettingContainer
            grouped
            layout="stacked"
            title={t("settings.modes.delivery.script.label")}
            description={t("settings.modes.delivery.script.description")}
            controlId="mode-external-script"
          >
            <Input
              id="mode-external-script"
              value={mode.delivery.external_script_path ?? ""}
              onChange={(event) =>
                updateDelivery(
                  "external_script_path",
                  event.target.value || null,
                )
              }
              className="w-full"
            />
          </SettingContainer>
        )}
        </SettingsGroup>
      ) : null}

      {activeTab === "automation" ? (
        <SettingsGroup title={t("settings.modes.shortcuts.title")}>
        <div className="px-4 pt-3 text-xs text-text-secondary">
          {modeCount > 9
            ? t("settings.modes.shortcuts.manyModes")
            : t("settings.modes.shortcuts.description")}
        </div>
        <ShortcutInput
          grouped
          descriptionMode="inline"
          shortcutId={modeBindingId(mode.id, "transcribe")}
        />
        <ShortcutInput
          grouped
          descriptionMode="inline"
          shortcutId={modeBindingId(mode.id, "switch")}
        />
        </SettingsGroup>
      ) : null}
      </div>
      <Dialog
        open={pendingCloudConsent !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCloudConsent(null);
            setCloudConsentError(null);
          }
        }}
        title={t("settings.modes.recognition.cloud.consent.title", {
          provider: pendingCloudConsent ? t(pendingCloudConsent.labelKey) : "",
        })}
        description={t("settings.modes.recognition.cloud.consent.description", {
          provider: pendingCloudConsent ? t(pendingCloudConsent.labelKey) : "",
        })}
        closeLabel={t("common.close")}
        dismissible={!acceptingCloudConsent}
        closeOnBackdrop={!acceptingCloudConsent}
        showCloseButton={!acceptingCloudConsent}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setPendingCloudConsent(null);
                setCloudConsentError(null);
              }}
              disabled={acceptingCloudConsent}
            >
              {t("settings.modes.recognition.cloud.consent.decline")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void acceptCloudConsent()}
              disabled={acceptingCloudConsent}
            >
              {acceptingCloudConsent
                ? t("settings.modes.recognition.cloud.consent.accepting")
                : t("settings.modes.recognition.cloud.consent.accept")}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-text-secondary">
          <p>{t("settings.modes.recognition.cloud.consent.intro")}</p>
          <ul className="space-y-2">
            <li>
              <p className="font-medium text-text-primary">
                {t(
                  "settings.modes.recognition.cloud.consent.audioTransfer.label",
                )}
              </p>
              <p>
                {t(
                  "settings.modes.recognition.cloud.consent.audioTransfer.description",
                  {
                    provider: pendingCloudConsent
                      ? t(pendingCloudConsent.labelKey)
                      : "",
                  },
                )}
              </p>
            </li>
            <li>
              <p className="font-medium text-text-primary">
                {t("settings.modes.recognition.cloud.consent.privacy.label")}
              </p>
              <p>
                {t(
                  "settings.modes.recognition.cloud.consent.privacy.description",
                )}
              </p>
            </li>
            <li>
              <p className="font-medium text-text-primary">
                {t(
                  "settings.modes.recognition.cloud.consent.localFallback.label",
                )}
              </p>
              <p>
                {t(
                  "settings.modes.recognition.cloud.consent.localFallback.description",
                )}
              </p>
            </li>
          </ul>
          {cloudConsentError && (
            <p role="alert" className="text-danger">
              {t(
                "settings.modes.recognition.cloud.consent.errors." +
                  cloudConsentError,
              )}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
};

const useModesSettings = () => {
  const { t } = useTranslation();
  const { refreshSettings } = useSettings();
  const osType = useOsType();
  const [snapshot, setSnapshot] = useState<ModeSettingsSnapshot | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<ModeDefinition | null>(null);
  const [workspaceView, setWorkspaceView] =
    useState<"modes" | "vocabulary">("modes");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ModeView | null>(null);
  const [capturingActivation, setCapturingActivation] = useState(false);

  const applySnapshot = useCallback(
    (next: ModeSettingsSnapshot) => {
      setSnapshot(next);
      void refreshSettings();
    },
    [refreshSettings],
  );

  const loadModes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applySnapshot(await commands.getModes());
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void loadModes();
  }, [loadModes]);

  useEffect(() => {
    let cancelled = false;
    void commands
      .getAvailableModels()
      .then((result) => {
        if (!cancelled && result.status === "ok") {
          setModels(result.data);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // A stale-revision rejection must not throw away the draft the user is
  // editing. The snapshot refreshes so the next Save carries the current
  // revision; the editor keeps the unsaved changes and the conflict banner
  // tells the user to review before saving again.
  const reloadAfterConflict = useCallback(async () => {
    try {
      applySnapshot(await commands.getModes());
      setConflict(true);
    } catch (reloadError) {
      setError(String(reloadError));
    }
  }, [applySnapshot]);

  const handleMutationError = useCallback(
    async (mutationError: ModeMutationError, _editedModeId?: string) => {
      if (mutationError.kind === "stale_revision") {
        await reloadAfterConflict();
        return;
      }
      setError(t(`settings.modes.errors.${mutationError.kind}`));
    },
    [reloadAfterConflict, t],
  );

  const createMode = useCallback(
    async (source: ModeView) => {
      if (!snapshot) return;
      setSaving(true);
      setError(null);
      setConflict(false);
      const duplicate = modeDefinitionFromView(source);
      duplicate.id = modeId();
      duplicate.name = `${source.name} ${t("settings.modes.copySuffix")}`;
      try {
        const result = await commands.upsertMode(duplicate, snapshot.revision);
        if (result.status === "ok") {
          applySnapshot(result.data);
          const created = result.data.modes.find(
            (mode) => mode.id === duplicate.id,
          );
          setEditor(created ? modeDefinitionFromView(created) : duplicate);
        } else {
          await handleMutationError(result.error, duplicate.id);
        }
      } catch (createError) {
        setError(String(createError));
      } finally {
        setSaving(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot, t],
  );

  const saveEditor = useCallback(
    async (draft: ModeDefinition) => {
      if (!snapshot) return;
      const nextEditor = modeWithRequiredCloudTimestamps(draft);
      if (nextEditor !== draft) setEditor(nextEditor);
      setSaving(true);
      setError(null);
      setConflict(false);
      try {
        const result = await commands.upsertMode(nextEditor, snapshot.revision);
        if (result.status === "ok") {
          applySnapshot(result.data);
          const saved = result.data.modes.find(
            (mode) => mode.id === nextEditor.id,
          );
          setEditor(saved ? modeDefinitionFromView(saved) : nextEditor);
        } else {
          await handleMutationError(result.error, nextEditor.id);
        }
      } catch (saveError) {
        setError(String(saveError));
      } finally {
        setSaving(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const activateMode = useCallback(
    async (modeIdToActivate: string) => {
      setSaving(true);
      setError(null);
      try {
        const result = await commands.setActiveMode(modeIdToActivate);
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          setError(String(result.error));
        }
      } catch (activationError) {
        setError(String(activationError));
      } finally {
        setSaving(false);
      }
    },
    [applySnapshot],
  );

  const captureModeActivation = useCallback(
    async (modeIdToActivate: string) => {
      if (!snapshot) return;
      setCapturingActivation(true);
      setError(null);
      try {
        const result = await commands.captureModeActivationRule(
          modeIdToActivate,
          snapshot.revision,
        );
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          await handleMutationError(result.error, modeIdToActivate);
        }
      } catch (captureError) {
        setError(String(captureError));
      } finally {
        setCapturingActivation(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const removeModeActivation = useCallback(
    async (appId: string) => {
      if (!snapshot) return;
      setCapturingActivation(true);
      setError(null);
      try {
        const result = await commands.removeModeActivationRule(
          appId,
          snapshot.revision,
        );
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          await handleMutationError(result.error);
        }
      } catch (removeError) {
        setError(String(removeError));
      } finally {
        setCapturingActivation(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const captureModeWebsiteActivation = useCallback(
    async (modeIdToActivate: string, matchKind: WebsiteHostMatch) => {
      if (!snapshot) return;
      setCapturingActivation(true);
      setError(null);
      try {
        const result = await commands.captureModeWebsiteActivationRule(
          modeIdToActivate,
          matchKind,
          snapshot.revision,
        );
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          await handleMutationError(result.error, modeIdToActivate);
        }
      } catch (captureError) {
        setError(String(captureError));
      } finally {
        setCapturingActivation(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const removeModeWebsiteActivation = useCallback(
    async (host: string, matchKind: WebsiteHostMatch) => {
      if (!snapshot) return;
      setCapturingActivation(true);
      setError(null);
      try {
        const result = await commands.removeModeWebsiteActivationRule(
          host,
          matchKind,
          snapshot.revision,
        );
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          await handleMutationError(result.error);
        }
      } catch (removeError) {
        setError(String(removeError));
      } finally {
        setCapturingActivation(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const reorder = useCallback(
    async (modeIdToMove: string, direction: -1 | 1) => {
      if (!snapshot) return;
      const currentIndex = snapshot.modes.findIndex(
        (mode) => mode.id === modeIdToMove,
      );
      const targetIndex = currentIndex + direction;
      if (
        currentIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= snapshot.modes.length
      ) {
        return;
      }
      const orderedIds = snapshot.modes.map((mode) => mode.id);
      [orderedIds[currentIndex], orderedIds[targetIndex]] = [
        orderedIds[targetIndex],
        orderedIds[currentIndex],
      ];
      setSaving(true);
      setError(null);
      try {
        const result = await commands.reorderModes(
          orderedIds,
          snapshot.revision,
        );
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          await handleMutationError(result.error);
        }
      } catch (reorderError) {
        setError(String(reorderError));
      } finally {
        setSaving(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const deleteMode = useCallback(async () => {
    if (!snapshot || !pendingDelete) return;
    setSaving(true);
    setError(null);
    try {
      const result = await commands.deleteMode(
        pendingDelete.id,
        snapshot.revision,
      );
      if (result.status === "ok") {
        applySnapshot(result.data);
        if (editor?.id === pendingDelete.id) setEditor(null);
        setPendingDelete(null);
      } else {
        await handleMutationError(result.error);
      }
    } catch (deleteError) {
      setError(String(deleteError));
    } finally {
      setSaving(false);
    }
  }, [applySnapshot, editor, handleMutationError, pendingDelete, snapshot]);


  if (loading) {
    return (
      <div className="settings-page space-y-4">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("settings.modes.title")}</h1>
          <p className="settings-page-description">
            {t("settings.modes.description")}
          </p>
        </header>
        <div
          role="status"
          className="py-8 text-center text-sm text-text-secondary"
        >
          {t("settings.modes.loading")}
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="settings-page space-y-4">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("settings.modes.title")}</h1>
          <p className="settings-page-description">
            {t("settings.modes.description")}
          </p>
        </header>
        <div
          role="alert"
          className="flex flex-col items-center gap-3 py-8 text-center"
        >
          <p className="text-sm text-text-primary">
            {t("settings.modes.loadError")}
          </p>
          {error && <p className="text-xs text-text-tertiary">{error}</p>}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadModes()}
          >
            {t("settings.modes.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const defaultMode =
    snapshot.modes.find((mode) => mode.id === DEFAULT_MODE_ID) ??
    snapshot.modes[0];
  const activeMode =
    snapshot.modes.find((mode) => mode.id === snapshot.active_mode_id) ??
    defaultMode;
  const selectedEditor =
    editor ?? (activeMode ? modeDefinitionFromView(activeMode) : null);

  return (
    <div className="settings-page modes-page density-page">

      <nav
        className="settings-local-nav modes-view-nav"
        aria-label={t("settings.modes.viewNavigation")}
      >
        {(["modes", "vocabulary"] as const).map((view) => (
          <button
            key={view}
            type="button"
            aria-current={workspaceView === view ? "page" : undefined}
            onClick={() => setWorkspaceView(view)}
          >
            {t(`settings.modes.views.${view}`)}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="inline-error" role="alert">
          {error}
        </div>
      ) : null}

      {workspaceView === "vocabulary" ? (
        <section
          className="mode-vocabulary-view"
          aria-labelledby="global-vocabulary-title"
        >
          <div className="section-heading-inline">
            <div>
              <h2 id="global-vocabulary-title">
                {t("settings.modes.globalVocabulary.title")}
              </h2>
              <p>{t("settings.modes.globalVocabulary.description")}</p>
            </div>
          </div>
          <SettingsGroup>
            <CustomWords descriptionMode="inline" grouped />
          </SettingsGroup>
        </section>
      ) : (
        <div className="modes-workspace">
          <aside
            className="modes-master"
            aria-label={t("settings.modes.listTitle")}
          >
            <div className="modes-master-heading">
              <h2>{t("settings.modes.listTitle")}</h2>
              <div className="modes-master-actions">
                <span>{snapshot.modes.length}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="modes-add-button"
                  aria-label={t("settings.modes.new")}
                  title={t("settings.modes.new")}
                  disabled={saving || !defaultMode}
                  onClick={() => defaultMode && void createMode(defaultMode)}
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="modes-master-list">
              {snapshot.modes.map((mode, index) => {
                const isActive = mode.id === snapshot.active_mode_id;
                const isDefault = mode.id === DEFAULT_MODE_ID;
                const isSelected = selectedEditor?.id === mode.id;
                return (
                  <div
                    key={mode.id}
                    className="mode-master-row"
                    data-selected={isSelected || undefined}
                  >
                    <button
                      type="button"
                      className="mode-select"
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => {
                        setEditor(modeDefinitionFromView(mode));
                        setConflict(false);
                      }}
                    >
                      <strong>{mode.name}</strong>
                    </button>
                    <details className="mode-actions-menu">
                      <summary
                        aria-label={t("settings.modes.actionsFor", {
                          mode: mode.name,
                        })}
                        title={t("settings.modes.actionsFor", {
                          mode: mode.name,
                        })}
                      >
                        <Ellipsis aria-hidden="true" className="h-4 w-4" />
                      </summary>
                      <div role="menu">
                        {!isActive ? (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={saving}
                            onClick={(event) => {
                              void activateMode(mode.id);
                              const menu = event.currentTarget.closest("details");
                              if (menu) menu.open = false;
                            }}
                          >
                            {t("settings.modes.activate")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          disabled={saving}
                          onClick={(event) => {
                            void createMode(mode);
                            const menu = event.currentTarget.closest("details");
                            if (menu) menu.open = false;
                          }}
                        >
                          {t("settings.modes.duplicate")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={saving || index === 0}
                          onClick={(event) => {
                            void reorder(mode.id, -1);
                            const menu = event.currentTarget.closest("details");
                            if (menu) menu.open = false;
                          }}
                        >
                          {t("settings.modes.moveUp")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={saving || index === snapshot.modes.length - 1}
                          onClick={(event) => {
                            void reorder(mode.id, 1);
                            const menu = event.currentTarget.closest("details");
                            if (menu) menu.open = false;
                          }}
                        >
                          {t("settings.modes.moveDown")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="danger-menu-item"
                          disabled={saving || isDefault}
                          onClick={(event) => {
                            setPendingDelete(mode);
                            const menu = event.currentTarget.closest("details");
                            if (menu) menu.open = false;
                          }}
                        >
                          {isDefault
                            ? t("settings.modes.defaultProtected")
                            : t("settings.modes.delete")}
                        </button>
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          </aside>

          <section
            className="modes-detail-shell"
            aria-label={t("settings.modes.editorLabel")}
          >
            {selectedEditor ? (
              <ModeEditor
                mode={selectedEditor}
                modeCount={snapshot.modes.length}
                models={models}
                onChange={setEditor}
                onSave={() => void saveEditor(selectedEditor)}
                saving={saving}
                conflict={conflict}
                activationRules={snapshot.mode_activation_rules}
                websiteActivationRules={snapshot.mode_website_activation_rules}
                activationSupported={osType === "macos"}
                capturingActivation={capturingActivation}
                onCaptureActivation={() =>
                  void captureModeActivation(selectedEditor.id)
                }
                onRemoveActivation={(appId) => void removeModeActivation(appId)}
                onCaptureWebsiteActivation={(matchKind) =>
                  void captureModeWebsiteActivation(selectedEditor.id, matchKind)
                }
                onRemoveWebsiteActivation={(host, matchKind) =>
                  void removeModeWebsiteActivation(host, matchKind)
                }
              />
            ) : (
              <p className="compact-empty-row">{t("settings.modes.empty")}</p>
            )}
          </section>
        </div>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t("settings.modes.deleteTitle")}
        description={t("settings.modes.deleteDescription", {
          mode: pendingDelete?.name ?? "",
        })}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPendingDelete(null)}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void deleteMode()}
              disabled={saving}
            >
              {t("settings.modes.delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          {t("settings.modes.deleteBody")}
        </p>
      </Dialog>
    </div>
  );
};


const ModeEditor: React.FC<ModeEditorProps> = (props) => useModeEditor(props);

export const ModesSettings: React.FC = () => useModesSettings();
