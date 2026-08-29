import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type CloudSttProvider,
  type ModeActivationRule,
  type ModeDefinition,
  type ModeView,
  type ModeWebsiteActivationRule,
  type ModelInfo,
  type RequestedEngine,
  type SecretState,
  type VocabularyEntry,
  type WebsiteHostMatch,
} from "@/bindings";
import {
  CLOUD_STT_PROVIDERS,
  cloudSttProviderForEngine,
  cloudSttProviderHasCurrentConsent,
  type CloudSttProviderMetadata,
} from "@/lib/cloudStt";
import { useSettings } from "@/hooks/useSettings";
import {
  Alert,
  Button,
  Dialog,
  Input,
  SettingContainer,
  SettingsGroup,
  StatusText,
  Tabs,
  type TabItem,
} from "@/components/ui";
import {
  ModeRecognitionPanel,
  type ModeVocabularyEditor,
} from "./ModeRecognitionPanel";
import { ModeRewritePanel } from "./ModeRewritePanel";
import { ModeContextPanel } from "./ModeContextPanel";
import { ModeDeliveryPanel } from "./ModeDeliveryPanel";
import { ModeAutomationPanel } from "./ModeAutomationPanel";
import {
  MODE_EDITOR_PANEL_ID,
  MODE_EDITOR_TABS,
  createModeDraftUpdaters,
  modeDraftIsDirty,
  type ModeCloudState,
  type ModeEditorTab,
} from "./modeModel";

export interface ModeEditorProps {
  mode: ModeDefinition;
  /** The persisted mode behind the draft, for the unsaved-change affordance. */
  savedMode: ModeView | undefined;
  modeCount: number;
  models: ModelInfo[];
  onChange: (mode: ModeDefinition) => void;
  onSave: () => void;
  saving: boolean;
  conflict: boolean;
  activationRules: readonly ModeActivationRule[];
  websiteActivationRules: readonly ModeWebsiteActivationRule[];
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

const NO_PROVIDERS: readonly [] = [];

export const ModeEditor: React.FC<ModeEditorProps> = ({
  mode,
  savedMode,
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
}) => {
  const { t } = useTranslation();
  const { refreshSettings, settings } = useSettings();
  const [activeTab, setActiveTab] = useState<ModeEditorTab>("recognition");
  const [websiteMatchKind, setWebsiteMatchKind] =
    useState<WebsiteHostMatch>("exact");
  const [cloudSecretStates, setCloudSecretStates] = useState<
    Partial<Record<CloudSttProvider, SecretState>>
  >({});
  const [pendingCloudConsent, setPendingCloudConsent] =
    useState<CloudSttProviderMetadata | null>(null);
  const [cloudConsentError, setCloudConsentError] = useState<
    "unknown_provider" | "backend" | null
  >(null);
  const [acceptingCloudConsent, setAcceptingCloudConsent] = useState(false);
  const vocabularyKeysRef = useRef(new WeakMap<VocabularyEntry, string>());
  const nextVocabularyKeyRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const loadCloudSecretStates = async () => {
      const next: Partial<Record<CloudSttProvider, SecretState>> = {};
      await Promise.all(
        CLOUD_STT_PROVIDERS.map(async (provider) => {
          try {
            const result = await commands.getProviderSecretState(
              "stt",
              provider.secretAccountId,
            );
            if (result.status === "ok") {
              next[provider.provider] = result.data;
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

  const updaters = useMemo(
    () => createModeDraftUpdaters(mode, onChange),
    [mode, onChange],
  );

  const requestedEngine = mode.asr.requested_engine ?? "local";
  const selectedCloudProvider = cloudSttProviderForEngine(requestedEngine);
  const cloudControlsAvailable =
    selectedCloudProvider !== undefined &&
    cloudSecretStates[selectedCloudProvider.provider]?.configured === true &&
    cloudSttProviderHasCurrentConsent(
      settings?.cloud_stt_providers,
      selectedCloudProvider.provider,
    );

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
      updaters.updateAsr("requested_engine", engine);
      return;
    }

    const provider = cloudSttProviderForEngine(engine);
    if (!provider || !cloudSecretStates[provider.provider]?.configured) {
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

  const cloud: ModeCloudState = {
    requestedEngine,
    selectedProvider: selectedCloudProvider,
    isConfigured: (provider) =>
      cloudSecretStates[provider]?.configured === true,
    controlsAvailable: cloudControlsAvailable,
    selectEngine: changeEngine,
  };

  const vocabularyRowKey = (entry: VocabularyEntry): string => {
    const existingKey = vocabularyKeysRef.current.get(entry);
    if (existingKey) return existingKey;

    const nextKey = `mode-vocabulary-${nextVocabularyKeyRef.current}`;
    nextVocabularyKeyRef.current += 1;
    vocabularyKeysRef.current.set(entry, nextKey);
    return nextKey;
  };

  const hasIncompleteVocabulary = mode.asr.custom_words.some(
    (entry) => entry.spoken.trim() === "" || entry.written.trim() === "",
  );

  const vocabulary: ModeVocabularyEditor = {
    rowKey: vocabularyRowKey,
    incomplete: hasIncompleteVocabulary,
    setField: (index, field, value) => {
      const entries = mode.asr.custom_words.map((entry, row) => {
        if (row !== index) return entry;
        const next = { ...entry, [field]: value };
        // Carry the row key onto the replacement so the input keeps focus.
        vocabularyKeysRef.current.set(next, vocabularyRowKey(entry));
        return next;
      });
      updaters.updateAsr("custom_words", entries);
    },
    add: () => {
      const entry: VocabularyEntry = { spoken: "", written: "" };
      vocabularyKeysRef.current.set(
        entry,
        `mode-vocabulary-${nextVocabularyKeyRef.current}`,
      );
      nextVocabularyKeyRef.current += 1;
      updaters.updateAsr("custom_words", [...mode.asr.custom_words, entry]);
    },
    remove: (index) =>
      updaters.updateAsr(
        "custom_words",
        mode.asr.custom_words.filter((_, row) => row !== index),
      ),
  };

  /* An empty mode model inherits the globally selected one, so it only leaves
   * the cloud route without a local fallback when nothing is selected there
   * either. Blocking Save on an empty field alone would be a false alarm. */
  const globalModelId = settings?.selected_model ?? "";
  const missingLocalFallbackModel =
    cloudControlsAvailable &&
    (mode.asr.local_fallback_enabled ?? true) &&
    !mode.asr.model_id.trim() &&
    !mode.asr.local_fallback_model_id?.trim() &&
    globalModelId.trim() === "";

  const nameMissing = mode.name.trim() === "";
  const blockingReason = nameMissing
    ? t("settings.modes.errors.empty_name")
    : hasIncompleteVocabulary
      ? t("settings.modes.recognition.vocabulary.incomplete")
      : missingLocalFallbackModel
        ? t("settings.modes.recognition.cloud.fallback.model.required")
        : null;

  const dirty = modeDraftIsDirty(mode, savedMode);

  const tabItems: TabItem[] = MODE_EDITOR_TABS.map((tab) => ({
    id: tab,
    label: t(`settings.modes.tabs.${tab}`),
    panelId: MODE_EDITOR_PANEL_ID,
  }));

  return (
    <div className="mode-detail">
      <div className="mode-detail-header">
        <div className="mode-detail-heading">
          <h2>
            {mode.name.trim() === ""
              ? t("settings.modes.untitled", "Untitled mode")
              : mode.name}
          </h2>
          {dirty ? (
            <StatusText tone="neutral" live="polite">
              {t("settings.modes.unsavedChanges", "Unsaved changes")}
            </StatusText>
          ) : (
            <StatusText>{t("settings.modes.changesNextRun")}</StatusText>
          )}
        </div>
        <Button
          size="sm"
          onClick={onSave}
          disabled={
            saving ||
            capturingActivation ||
            nameMissing ||
            hasIncompleteVocabulary ||
            missingLocalFallbackModel
          }
        >
          {saving ? t("settings.modes.saving") : t("settings.modes.save")}
        </Button>
      </div>

      {conflict || blockingReason ? (
        <div className="mode-detail-notice">
          {conflict ? (
            <Alert variant="error">
              {t("settings.modes.errors.staleRevision")}
            </Alert>
          ) : null}
          {blockingReason ? (
            <StatusText tone="danger" live="polite">
              {blockingReason}
            </StatusText>
          ) : null}
        </div>
      ) : null}

      <div className="mode-tabstrip">
        <Tabs
          items={tabItems}
          value={activeTab}
          onChange={(id) => {
            const next = MODE_EDITOR_TABS.find((tab) => tab === id);
            if (next) setActiveTab(next);
          }}
          label={t("settings.modes.editorTabsLabel")}
        />
      </div>

      <div className="mode-editor-panel">
        <SettingsGroup title={t("settings.modes.identity.title")}>
          <SettingContainer
            grouped
            title={t("settings.modes.identity.name.label")}
            description={t("settings.modes.identity.name.description")}
            controlId="mode-name"
          >
            <Input
              id="mode-name"
              value={mode.name}
              onChange={(event) => updaters.update("name", event.target.value)}
              invalid={nameMissing}
              maxLength={120}
              className="w-full"
            />
          </SettingContainer>
        </SettingsGroup>

        <div
          className="mode-editor-tabpanel"
          id={MODE_EDITOR_PANEL_ID}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
        >
          {activeTab === "recognition" ? (
            <ModeRecognitionPanel
              mode={mode}
              updaters={updaters}
              models={models}
              globalModelId={globalModelId}
              cloud={cloud}
              vocabulary={vocabulary}
              missingFallbackModel={missingLocalFallbackModel}
            />
          ) : null}
          {activeTab === "rewrite" ? (
            <ModeRewritePanel
              mode={mode}
              updaters={updaters}
              providers={settings?.post_process_providers ?? NO_PROVIDERS}
            />
          ) : null}
          {activeTab === "context" ? (
            <ModeContextPanel
              mode={mode}
              updaters={updaters}
              ceiling={settings?.context_policy_ceiling ?? "none"}
            />
          ) : null}
          {activeTab === "delivery" ? (
            <ModeDeliveryPanel mode={mode} updaters={updaters} />
          ) : null}
          {activeTab === "automation" ? (
            <ModeAutomationPanel
              modeId={mode.id}
              modeCount={modeCount}
              activationRules={activationRules}
              websiteActivationRules={websiteActivationRules}
              activationSupported={activationSupported}
              websiteCaptureEnabled={
                settings?.context_url_capture_enabled ?? false
              }
              websiteMatchKind={websiteMatchKind}
              onWebsiteMatchKindChange={setWebsiteMatchKind}
              capturing={capturingActivation}
              saving={saving}
              onCaptureActivation={onCaptureActivation}
              onRemoveActivation={onRemoveActivation}
              onCaptureWebsiteActivation={onCaptureWebsiteActivation}
              onRemoveWebsiteActivation={onRemoveWebsiteActivation}
            />
          ) : null}
        </div>
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
          {cloudConsentError ? (
            <p role="alert" className="text-danger-strong">
              {t(
                `settings.modes.recognition.cloud.consent.errors.${cloudConsentError}`,
              )}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
};
