import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  commands,
  events,
  type CloudSttProvider,
  type ContextDiagnostics,
  type ContextPolicy,
  type RecordingRetentionPeriod,
  type SecretState,
  type UpstreamImportError,
  type UpstreamImportProgressEvent,
  type UpstreamImportResult,
  type UpstreamImportSelection,
  type UpstreamImportStatus,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import {
  CLOUD_STT_PROVIDERS,
  cloudSttProviderHasCurrentConsent,
} from "@/lib/cloudStt";
import { AppDataDirectory } from "../AppDataDirectory";
import { CloudSyncPanel } from "../../cloud-sync/CloudSyncPanel";
import {
  Alert,
  Button,
  Dropdown,
  Input,
  SettingContainer,
  SettingsGroup,
  StatusText,
  ToggleSwitch,
  type StatusTone,
} from "@/components/ui";
import { MeetingRetentionSettings } from "../meetings/MeetingRetention";
import {
  useCloudSyncServiceStatus,
  useHistoryStorageStatus,
} from "./privacyStatus";

const CONTEXT_POLICIES = [
  "none",
  "target",
  "target_and_selection",
  "full",
] as const satisfies readonly ContextPolicy[];

/* The per-source rows in the diagnostics group, in capture order, with the
 * English fallback for each. The keys are harvested at integration; the
 * wording mirrors the Rust doc comments on ContextDiagnostics. */
const CONTEXT_SOURCE_DETAILS = {
  target_identity: "The frontmost application's name and identifier.",
  focused_field: "The contents of the focused control.",
  selected_text: "The current selection.",
  browser_url: "The frontmost browser's page URL.",
  clipboard: "Recently changed clipboard text.",
} as const;

const CONTEXT_SOURCES = [
  "target_identity",
  "focused_field",
  "selected_text",
  "browser_url",
  "clipboard",
] as const satisfies readonly (keyof typeof CONTEXT_SOURCE_DETAILS)[];

const RETENTION_OPTIONS = [
  "never",
  "preserve_limit",
  "days_3",
  "weeks_2",
  "months_3",
] as const satisfies readonly RecordingRetentionPeriod[];

const BYTE_UNITS = ["bytes", "kilobytes", "megabytes", "gigabytes"] as const;
const NUMBER_FORMATTER = new Intl.NumberFormat();

const byteSize = (bytes: number) => {
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return { value, unit: BYTE_UNITS[unitIndex] };
};

const subscribeToUpstreamImportProgress = (
  onUpdate: (progress: UpstreamImportProgressEvent) => void,
) => {
  let active = true;
  let unlisten: (() => void) | undefined;

  void events.upstreamImportProgressEvent
    .listen((event) => {
      if (active) onUpdate(event.payload);
    })
    .then(
      (nextUnlisten) => {
        if (active) {
          unlisten = nextUnlisten;
        } else {
          nextUnlisten();
        }
      },
      () => undefined,
    );

  return () => {
    active = false;
    unlisten?.();
  };
};

const usePrivacySettings = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings, settings } = useSettings();
  const [diagnostics, setDiagnostics] = useState<ContextDiagnostics | null>(
    null,
  );
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true);
  const [ceilingError, setCeilingError] = useState<string | null>(null);
  const [ceilingUpdating, setCeilingUpdating] = useState(false);
  const [urlCaptureError, setUrlCaptureError] = useState<string | null>(null);
  const [urlCaptureUpdating, setUrlCaptureUpdating] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataUpdating, setDataUpdating] = useState(false);
  const [upstreamStatus, setUpstreamStatus] =
    useState<UpstreamImportStatus | null>(null);
  const [loadingUpstreamStatus, setLoadingUpstreamStatus] = useState(true);
  const [upstreamSelection, setUpstreamSelection] =
    useState<UpstreamImportSelection>({
      settings: false,
      history: false,
      recordings: false,
    });
  const [upstreamProgress, setUpstreamProgress] =
    useState<UpstreamImportProgressEvent | null>(null);
  const [upstreamResult, setUpstreamResult] =
    useState<UpstreamImportResult | null>(null);
  const [upstreamError, setUpstreamError] = useState<
    UpstreamImportError | "status" | null
  >(null);
  const [upstreamImporting, setUpstreamImporting] = useState(false);
  const upstreamSelectionInitialized = useRef(false);
  const contextCeiling = getSetting("context_policy_ceiling") ?? "none";
  const contextUrlCaptureEnabled =
    getSetting("context_url_capture_enabled") ?? false;
  const historyLimit = getSetting("history_limit") ?? 5;
  const retentionPeriod = getSetting("recording_retention_period") ?? "never";

  const cloudCandidateProviders = useMemo(() => {
    const enabledProviderIds = new Set<string>();
    for (const mode of settings?.modes ?? []) {
      if (mode.llm.enabled) enabledProviderIds.add(mode.llm.provider_id);
    }

    const candidates = [];
    for (const provider of settings?.post_process_providers ?? []) {
      if (
        !enabledProviderIds.has(provider.id) ||
        provider.id === "apple_intelligence"
      ) {
        continue;
      }
      try {
        const hostname = new URL(provider.base_url).hostname.toLowerCase();
        if (
          hostname !== "localhost" &&
          hostname !== "127.0.0.1" &&
          hostname !== "::1"
        ) {
          candidates.push(provider);
        }
      } catch {
        candidates.push(provider);
      }
    }
    return candidates;
  }, [settings?.modes, settings?.post_process_providers]);
  const [providerSecretStates, setProviderSecretStates] = useState<
    Record<string, boolean | undefined>
  >({});
  const [cloudSttSecretStates, setCloudSttSecretStates] = useState<
    Map<CloudSttProvider, SecretState>
  >(() => new Map());
  const [checkingCloudSttRoutes, setCheckingCloudSttRoutes] = useState(true);
  const [cloudSttRouteError, setCloudSttRouteError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (cloudCandidateProviders.length === 0) {
      setProviderSecretStates({});
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      cloudCandidateProviders.map(async (provider) => {
        try {
          const result = await commands.getProviderSecretState(
            "llm",
            provider.id,
          );
          return [
            provider.id,
            result.status === "ok" && result.data.configured,
          ] as const;
        } catch {
          return [provider.id, false] as const;
        }
      }),
    ).then((states) => {
      if (!cancelled) setProviderSecretStates(Object.fromEntries(states));
    });

    return () => {
      cancelled = true;
    };
  }, [cloudCandidateProviders, settings?.post_process_secret_states]);

  const configuredCloudProviders = useMemo(() => {
    const configured: string[] = [];
    for (const provider of cloudCandidateProviders) {
      if (providerSecretStates[provider.id] === true) {
        configured.push(provider.label);
      }
    }
    return configured;
  }, [cloudCandidateProviders, providerSecretStates]);
  const cloudRoutePending = cloudCandidateProviders.some(
    (provider) => providerSecretStates[provider.id] === undefined,
  );

  const [cloudSttAttempt, setCloudSttAttempt] = useState(0);
  // A failed secret-state read is transient (the credential store can be
  // locked), so the row offers a retry rather than a dead end.
  const retryCloudSttRoutes = useCallback(
    () => setCloudSttAttempt((current) => current + 1),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const loadCloudSttSecretStates = async () => {
      setCheckingCloudSttRoutes(true);
      setCloudSttRouteError(false);
      const results = await Promise.all(
        CLOUD_STT_PROVIDERS.map(async (provider) => {
          try {
            const result = await commands.getProviderSecretState(
              "stt",
              provider.secretAccountId,
            );
            return {
              provider: provider.provider,
              state: result.status === "ok" ? result.data : null,
              failed: result.status === "error",
            };
          } catch {
            return { provider: provider.provider, state: null, failed: true };
          }
        }),
      );
      if (cancelled) return;

      const next = new Map<CloudSttProvider, SecretState>();
      for (const result of results) {
        if (result.state) next.set(result.provider, result.state);
      }
      setCloudSttSecretStates(next);
      setCloudSttRouteError(results.some((result) => result.failed));
      setCheckingCloudSttRoutes(false);
    };

    void loadCloudSttSecretStates();
    return () => {
      cancelled = true;
    };
  }, [cloudSttAttempt, settings?.cloud_stt_providers]);

  const cloudSttDisclosureProviders = useMemo(
    () =>
      CLOUD_STT_PROVIDERS.filter(
        (provider) =>
          cloudSttSecretStates.get(provider.provider)?.configured &&
          cloudSttProviderHasCurrentConsent(
            settings?.cloud_stt_providers,
            provider.provider,
          ),
      ),
    [cloudSttSecretStates, settings?.cloud_stt_providers],
  );

  const refreshDiagnostics = useCallback(async () => {
    setLoadingDiagnostics(true);
    setDiagnosticsError(null);
    try {
      setDiagnostics(await commands.getContextDiagnostics());
    } catch (error) {
      setDiagnosticsError(String(error));
    } finally {
      setLoadingDiagnostics(false);
    }
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  const changeContextCeiling = async (ceiling: ContextPolicy) => {
    setCeilingUpdating(true);
    setCeilingError(null);
    try {
      await commands.changeContextPolicyCeilingSetting(ceiling);
      await refreshSettings();
      await refreshDiagnostics();
    } catch (error) {
      setCeilingError(String(error));
    } finally {
      setCeilingUpdating(false);
    }
  };

  const changeContextUrlCaptureEnabled = async (enabled: boolean) => {
    setUrlCaptureUpdating(true);
    setUrlCaptureError(null);
    try {
      await commands.changeContextUrlCaptureEnabledSetting(enabled);
      await refreshSettings();
      await refreshDiagnostics();
    } catch {
      setUrlCaptureError(t("settings.privacy.context.urlCapture.error"));
    } finally {
      setUrlCaptureUpdating(false);
    }
  };

  const refreshUpstreamStatus = useCallback(async () => {
    setLoadingUpstreamStatus(true);
    try {
      const result = await commands.getUpstreamImportStatus();
      if (result.status === "error") {
        setUpstreamStatus(null);
        setUpstreamError(
          result.error === "source_unavailable" ? null : result.error,
        );
        return;
      }
      setUpstreamStatus(result.data);
      setUpstreamError(null);
      if (!upstreamSelectionInitialized.current) {
        upstreamSelectionInitialized.current = true;
        setUpstreamSelection({
          settings:
            result.data.settings_available && !result.data.settings_imported,
          history: result.data.history_entries > 0,
          recordings: false,
        });
      } else {
        setUpstreamSelection((current) => ({
          settings: current.settings && result.data.settings_available,
          history: current.history && result.data.history_entries > 0,
          recordings:
            current.recordings &&
            result.data.history_entries > 0 &&
            result.data.recording_files > 0,
        }));
      }
    } catch {
      setUpstreamStatus(null);
      setUpstreamError("status");
    } finally {
      setLoadingUpstreamStatus(false);
    }
  }, []);

  useEffect(() => {
    void refreshUpstreamStatus();
  }, [refreshUpstreamStatus]);

  useEffect(() => {
    const unsubscribe = subscribeToUpstreamImportProgress(setUpstreamProgress);
    return () => {
      unsubscribe();
    };
  }, []);

  const changeUpstreamHistorySelection = (history: boolean) => {
    setUpstreamSelection((current) => ({
      ...current,
      history,
      recordings: history ? current.recordings : false,
    }));
  };

  const upstreamSourceHasImportableData =
    upstreamStatus?.settings_available === true ||
    (upstreamStatus?.history_entries ?? 0) > 0;
  const upstreamSelectionValid =
    (upstreamSelection.settings &&
      upstreamStatus?.settings_available === true) ||
    (upstreamSelection.history && (upstreamStatus?.history_entries ?? 0) > 0);

  const startUpstreamImport = async () => {
    if (
      upstreamImporting ||
      !upstreamStatus ||
      upstreamStatus.app_state !== "closed"
    ) {
      return;
    }
    if (!upstreamSelectionValid) {
      setUpstreamError("invalid_selection");
      return;
    }

    setUpstreamImporting(true);
    setUpstreamError(null);
    setUpstreamProgress(null);
    setUpstreamResult(null);
    try {
      const result = await commands.importLegacyApp(upstreamSelection);
      if (result.status === "error") {
        setUpstreamError(result.error);
        return;
      }
      setUpstreamResult(result.data);
      await Promise.all([refreshSettings(), refreshUpstreamStatus()]);
    } catch {
      setUpstreamError("internal");
    } finally {
      setUpstreamImporting(false);
    }
  };

  const updateHistoryLimit = async (value: string) => {
    const next = Number.parseInt(value, 10);
    if (!Number.isFinite(next) || next < 0) return;
    setDataUpdating(true);
    setDataError(null);
    try {
      const result = await commands.updateHistoryLimit(next);
      if (result.status === "error") {
        setDataError(String(result.error));
        return;
      }
      await refreshSettings();
    } catch (error) {
      setDataError(String(error));
    } finally {
      setDataUpdating(false);
    }
  };

  const updateRetentionPeriod = async (period: RecordingRetentionPeriod) => {
    setDataUpdating(true);
    setDataError(null);
    try {
      const result = await commands.updateRecordingRetentionPeriod(period);
      if (result.status === "error") {
        setDataError(String(result.error));
        return;
      }
      await refreshSettings();
    } catch (error) {
      setDataError(String(error));
    } finally {
      setDataUpdating(false);
    }
  };

  const upstreamRecordingSize = byteSize(upstreamStatus?.recording_bytes ?? 0);
  const upstreamImportAvailable =
    upstreamStatus?.available === true && upstreamStatus.app_state === "closed";

  return {
    contextCeiling,
    contextUrlCaptureEnabled,
    ceilingError,
    ceilingUpdating,
    urlCaptureError,
    urlCaptureUpdating,
    cloudRoutePending,
    configuredCloudProviders,
    changeContextCeiling,
    changeContextUrlCaptureEnabled,
    checkingCloudSttRoutes,
    cloudSttRouteError,
    cloudSttDisclosureProviders,
    retryCloudSttRoutes,
    diagnostics,
    diagnosticsError,
    loadingDiagnostics,
    refreshDiagnostics,
    dataError,
    dataUpdating,
    historyLimit,
    retentionPeriod,
    updateHistoryLimit,
    updateRetentionPeriod,
    upstreamStatus,
    loadingUpstreamStatus,
    upstreamSelection,
    setUpstreamSelection,
    upstreamProgress,
    upstreamResult,
    upstreamError,
    upstreamImporting,
    upstreamSourceHasImportableData,
    upstreamSelectionValid,
    upstreamRecordingSize,
    upstreamImportAvailable,
    changeUpstreamHistorySelection,
    startUpstreamImport,
    refreshUpstreamStatus,
  };
};

type PrivacySettingsModel = ReturnType<typeof usePrivacySettings>;

export const PrivacySettings: React.FC = () => {
  const model = usePrivacySettings();
  return <PrivacySettingsPage model={model} />;
};

const PrivacySettingsPage: React.FC<{ model: PrivacySettingsModel }> = ({
  model,
}) => {
  const { t } = useTranslation();

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("settings.privacy.title")}</h1>
        <p className="settings-page-description">
          {t("settings.privacy.description")}
        </p>
      </header>
      {/* Ordered by how far the data travels: what Sona reads from other
       * apps, then what leaves the machine, then what stays on disk. */}
      <PrivacyContextSettings model={model} />
      <PrivacyCloudTranscription model={model} />
      <PrivacyCloudSync />
      <PrivacyDataSettings model={model} />
      <PrivacyDiagnostics model={model} />
      <PrivacyUpstreamImport model={model} />
    </div>
  );
};

const PrivacyContextSettings: React.FC<{
  model: PrivacySettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();

  return (
    <SettingsGroup
      title={t("settings.privacy.context.title")}
      description={t("settings.privacy.context.description")}
    >
      <SettingContainer
        grouped
        layout="stacked"
        title={t("settings.privacy.context.ceiling.label")}
        description={t("settings.privacy.context.ceiling.description")}
      >
        <fieldset className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <legend className="sr-only">
            {t("settings.privacy.context.ceiling.label")}
          </legend>
          {CONTEXT_POLICIES.map((policy) => (
            <label key={policy} className="cursor-pointer">
              <input
                type="radio"
                name="context-policy-ceiling"
                value={policy}
                checked={model.contextCeiling === policy}
                onChange={() => void model.changeContextCeiling(policy)}
                disabled={model.ceilingUpdating}
                className="peer sr-only"
              />
              <span className="flex min-h-8 items-center justify-center rounded-md border border-border px-2 text-center text-xs font-medium text-text-secondary transition-colors peer-checked:border-border-strong peer-checked:bg-subtle peer-checked:text-text-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-strong">
                {t("settings.privacy.context.ceiling.values." + policy)}
              </span>
            </label>
          ))}
        </fieldset>
      </SettingContainer>
      <SettingContainer
        grouped
        layout="stacked"
        title={t("settings.privacy.context.sources.title")}
        description={t("settings.privacy.context.sources.description")}
      >
        <ul className="space-y-1.5 text-sm text-text-secondary">
          {CONTEXT_POLICIES.map((policy) => (
            <li key={policy} className="flex gap-2">
              <span className="font-medium text-text-primary">
                {t("settings.privacy.context.ceiling.values." + policy)}
              </span>
              <span>{t("settings.privacy.context.sources." + policy)}</span>
            </li>
          ))}
        </ul>
      </SettingContainer>
      <ToggleSwitch
        grouped
        checked={model.contextUrlCaptureEnabled}
        onChange={(enabled) =>
          void model.changeContextUrlCaptureEnabled(enabled)
        }
        isUpdating={model.urlCaptureUpdating}
        label={t("settings.privacy.context.urlCapture.label")}
        description={t("settings.privacy.context.urlCapture.description")}
      />
      {model.urlCaptureError ? (
        <Alert contained variant="error">
          {model.urlCaptureError}
        </Alert>
      ) : null}
      {model.ceilingError ? (
        <Alert contained variant="error">
          {t("settings.privacy.context.ceiling.error")}: {model.ceilingError}
        </Alert>
      ) : null}
      <div className="px-4 py-3">
        <StatusText live="polite">
          {model.cloudRoutePending
            ? t("settings.privacy.context.checkingRoute")
            : model.configuredCloudProviders.length > 0
              ? t("settings.privacy.context.cloudRoute", {
                  providers: model.configuredCloudProviders.join(", "),
                })
              : t("settings.privacy.context.localRoute")}
        </StatusText>
      </div>
    </SettingsGroup>
  );
};

const PrivacyCloudTranscription: React.FC<{
  model: PrivacySettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();

  return (
    <SettingsGroup
      title={t("settings.privacy.cloudTranscription.title")}
      description={t("settings.privacy.cloudTranscription.description")}
    >
      {model.checkingCloudSttRoutes ? (
        <div className="px-4 py-3">
          <StatusText live="polite">
            {t("settings.privacy.cloudTranscription.checking")}
          </StatusText>
        </div>
      ) : model.cloudSttRouteError ? (
        <Alert
          contained
          variant="error"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={model.retryCloudSttRoutes}
            >
              {t("common.retry")}
            </Button>
          }
        >
          {t("settings.privacy.cloudTranscription.checkFailed")}
        </Alert>
      ) : model.cloudSttDisclosureProviders.length > 0 ? (
        <>
          <div className="px-4 py-3">
            <p className="text-[13px] leading-5 text-text-secondary">
              {t("settings.privacy.cloudTranscription.disclosure")}
            </p>
          </div>
          {model.cloudSttDisclosureProviders.map((provider) => (
            <SettingContainer
              key={provider.provider}
              grouped
              title={t(provider.labelKey)}
              description={t(
                "settings.privacy.cloudTranscription.providerDetail",
                { provider: t(provider.labelKey) },
              )}
            >
              <StatusText tone="warning">
                {t("settings.privacy.cloudTranscription.inUse", "In use")}
              </StatusText>
            </SettingContainer>
          ))}
        </>
      ) : (
        <div className="px-4 py-3">
          <StatusText>
            {t("settings.privacy.cloudTranscription.localOnly")}
          </StatusText>
        </div>
      )}
    </SettingsGroup>
  );
};

/* Four different reasons a source went unread are four different things the
 * user can act on, so the tone follows the reason rather than flattening
 * everything to "off". The word is always present; colour never carries the
 * meaning alone. */
const diagnosticTone = (status: string): StatusTone => {
  switch (status) {
    case "granted":
    case "captured":
      return "success";
    case "denied":
    case "permission_denied":
    case "failed":
      return "danger";
    case "disabled_by_ceiling":
    case "secure_field":
    case "stale":
      return "warning";
    default:
      return "muted";
  }
};

const PrivacyDiagnostics: React.FC<{
  model: PrivacySettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const { diagnostics } = model;

  return (
    <SettingsGroup title={t("settings.privacy.diagnostics.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="min-w-0 text-[13px] leading-5 text-text-secondary">
          {t("settings.privacy.diagnostics.description")}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="gap-1"
          onClick={() => void model.refreshDiagnostics()}
          disabled={model.loadingDiagnostics}
        >
          <RefreshCw
            aria-hidden="true"
            className={
              model.loadingDiagnostics ? "h-4 w-4 animate-spin" : "h-4 w-4"
            }
          />
          {t("settings.privacy.diagnostics.refresh")}
        </Button>
      </div>
      {model.diagnosticsError ? (
        <Alert
          contained
          variant="error"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void model.refreshDiagnostics()}
              disabled={model.loadingDiagnostics}
            >
              {t("common.retry")}
            </Button>
          }
        >
          {t("settings.privacy.diagnostics.error")}: {model.diagnosticsError}
        </Alert>
      ) : null}
      {model.loadingDiagnostics && !diagnostics ? (
        <div className="px-4 pb-3">
          <StatusText live="polite">{t("common.loading")}</StatusText>
        </div>
      ) : diagnostics ? (
        <>
          <SettingContainer
            grouped
            title={t("settings.privacy.diagnostics.accessibility.label")}
            description={t(
              "settings.privacy.diagnostics.accessibility." +
                diagnostics.accessibility,
            )}
          >
            <StatusText tone={diagnosticTone(diagnostics.accessibility)}>
              {t("settings.privacy.status." + diagnostics.accessibility)}
            </StatusText>
          </SettingContainer>
          {CONTEXT_SOURCES.map((source) => (
            <SettingContainer
              key={source}
              grouped
              title={t("settings.privacy.diagnostics.sources." + source)}
              description={t(
                "settings.privacy.diagnostics.sourceDetail." + source,
                { defaultValue: CONTEXT_SOURCE_DETAILS[source] },
              )}
            >
              <StatusText tone={diagnosticTone(diagnostics[source])}>
                {t("settings.privacy.status." + diagnostics[source])}
              </StatusText>
            </SettingContainer>
          ))}
        </>
      ) : null}
    </SettingsGroup>
  );
};

const PrivacyDataSettings: React.FC<{
  model: PrivacySettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();

  return (
    <SettingsGroup title={t("settings.privacy.data.title")}>
      <PrivacyHistoryStorage />
      {model.dataError ? (
        <Alert contained variant="error">
          {t("settings.privacy.data.error")}: {model.dataError}
        </Alert>
      ) : null}
      <SettingContainer
        grouped
        title={t("settings.privacy.data.historyLimit.label")}
        description={t("settings.privacy.data.historyLimit.description")}
        controlId="privacy-history-limit"
      >
        <Input
          id="privacy-history-limit"
          type="number"
          min="0"
          max="1000"
          value={model.historyLimit}
          onChange={(event) =>
            void model.updateHistoryLimit(event.target.value)
          }
          disabled={model.dataUpdating}
          className="w-20"
        />
      </SettingContainer>
      <SettingContainer
        grouped
        title={t("settings.privacy.data.retention.label")}
        description={t("settings.privacy.data.retention.description")}
      >
        <Dropdown
          selectedValue={model.retentionPeriod}
          options={RETENTION_OPTIONS.map((period) => ({
            value: period,
            label: t("settings.privacy.data.retention.values." + period),
          }))}
          onSelect={(period) => {
            const next = RETENTION_OPTIONS.find(
              (candidate) => candidate === period,
            );
            if (next) void model.updateRetentionPeriod(next);
          }}
          disabled={model.dataUpdating}
        />
      </SettingContainer>
      <MeetingRetentionSettings />
      <AppDataDirectory grouped />
      <div className="space-y-1 px-4 py-3 text-xs leading-4 text-text-secondary">
        <p>{t("settings.privacy.data.credentialStore")}</p>
        <p>{t("settings.privacy.data.locations")}</p>
      </div>
    </SettingsGroup>
  );
};

/* History is encrypted at rest with a key from the OS credential store. The
 * key is fetched off the startup path, so this row begins life "unlocking"
 * and settles when the backend raises history-storage-changed. Every failure
 * mode stays visible rather than silently reading a plaintext database. */
const PrivacyHistoryStorage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const storage = useHistoryStorageStatus();
  const migratedFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language],
  );

  const reasonText = (reason: string): string => {
    switch (reason) {
      case "unlocking":
        return t(
          "settings.privacy.data.historyStorage.reasons.unlocking",
          "Opening the encrypted database. This clears moments after startup.",
        );
      case "key_unavailable":
        return t(
          "settings.privacy.data.historyStorage.reasons.key_unavailable",
          "The system credential store returned no usable key, so history is stored unencrypted.",
        );
      case "encryption_unavailable":
        return t(
          "settings.privacy.data.historyStorage.reasons.encryption_unavailable",
          "This build cannot open an encrypted database, so history is stored unencrypted.",
        );
      case "migration_failed":
        return t(
          "settings.privacy.data.historyStorage.reasons.migration_failed",
          "Encrypting the existing database failed. The unencrypted database is intact and still in use.",
        );
      case "key_rejected":
        return t(
          "settings.privacy.data.historyStorage.reasons.key_rejected",
          "The stored key does not open the encrypted database, so history cannot be read.",
        );
      default:
        return reason;
    }
  };

  const title = t(
    "settings.privacy.data.historyStorage.label",
    "History storage",
  );
  const status = storage.value;

  if (storage.phase === "failed") {
    return (
      <SettingContainer
        grouped
        title={title}
        description={
          storage.error ??
          t(
            "settings.privacy.data.historyStorage.unknown",
            "Sona could not read how history is stored.",
          )
        }
      >
        <Button variant="secondary" size="sm" onClick={storage.reload}>
          {t("common.retry")}
        </Button>
      </SettingContainer>
    );
  }

  if (status === null) {
    return (
      <SettingContainer
        grouped
        title={title}
        description={t(
          "settings.privacy.data.historyStorage.description",
          "Whether dictation history is encrypted on this disk.",
        )}
      >
        <StatusText live="polite">{t("common.loading")}</StatusText>
      </SettingContainer>
    );
  }

  const encryptedAndReadable = status.encrypted && status.reason === null;
  const description = encryptedAndReadable
    ? status.migrated_at === null
      ? t(
          "settings.privacy.data.historyStorage.description",
          "Whether dictation history is encrypted on this disk.",
        )
      : t("settings.privacy.data.historyStorage.since", {
          defaultValue: "Encrypted since {{date}}.",
          date: migratedFormatter.format(new Date(status.migrated_at)),
        })
    : reasonText(status.reason ?? "");

  return (
    <SettingContainer grouped title={title} description={description}>
      <StatusText
        tone={
          encryptedAndReadable
            ? "success"
            : status.reason === "unlocking"
              ? "muted"
              : "danger"
        }
        live="polite"
      >
        {encryptedAndReadable
          ? t(
              "settings.privacy.data.historyStorage.encrypted",
              "Encrypted at rest",
            )
          : status.reason === "unlocking"
            ? t("settings.privacy.data.historyStorage.unlocking", "Unlocking")
            : status.encrypted
              ? t("settings.privacy.data.historyStorage.locked", "Locked")
              : t(
                  "settings.privacy.data.historyStorage.plaintext",
                  "Not encrypted",
                )}
      </StatusText>
    </SettingContainer>
  );
};

/* Availability is derived from stored settings, never guessed, and it is
 * never a switch: bootstrapping is what turns cloud sync on, and that lives
 * in the collapsed panel below. */
const PrivacyCloudSync: React.FC = () => {
  const { t } = useTranslation();
  const service = useCloudSyncServiceStatus();
  const status = service.value;

  return (
    <>
      <SettingsGroup
        title={t("settings.privacy.cloudSync.title", "Cloud sync")}
        description={t(
          "settings.privacy.cloudSync.description",
          "Sona can mirror meetings to a server you run. Nothing is uploaded until setup finishes on this device.",
        )}
      >
        {service.phase === "failed" ? (
          <Alert
            contained
            variant="error"
            action={
              <Button variant="secondary" size="sm" onClick={service.reload}>
                {t("common.retry")}
              </Button>
            }
          >
            {t(
              "settings.privacy.cloudSync.checkFailed",
              "Sona could not read the cloud sync configuration.",
            )}
            {service.error === null ? "" : ` ${service.error}`}
          </Alert>
        ) : status === null ? (
          <div className="px-4 py-3">
            <StatusText live="polite">{t("common.loading")}</StatusText>
          </div>
        ) : (
          <>
            <SettingContainer
              grouped
              title={t("settings.privacy.cloudSync.service", "Service")}
              description={status.reason}
            >
              <StatusText tone={status.configured ? "success" : "muted"}>
                {status.configured
                  ? t("settings.privacy.cloudSync.configured", "Configured")
                  : t(
                      "settings.privacy.cloudSync.notConfigured",
                      "Not configured",
                    )}
              </StatusText>
            </SettingContainer>
            {status.endpoint === null ? null : (
              <SettingContainer
                grouped
                title={t("settings.privacy.cloudSync.endpoint", "Endpoint")}
                description={t(
                  "settings.privacy.cloudSync.endpointDescription",
                  "The server this device is pointed at.",
                )}
              >
                <code className="min-w-0 font-mono text-xs break-all text-text-primary">
                  {status.endpoint}
                </code>
              </SettingContainer>
            )}
          </>
        )}
      </SettingsGroup>
      {/* Setup, recovery and pairing stay collapsed: they are a one-time
       * task, and they must not read as a switch that is simply off. */}
      <CloudSyncPanel />
    </>
  );
};

const PrivacyUpstreamImport: React.FC<{
  model: PrivacySettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const status = model.upstreamStatus;

  if (status?.available) {
    return (
      <SettingsGroup
        title={t("settings.privacy.upstreamImport.title")}
        description={t("settings.privacy.upstreamImport.description")}
      >
        <div className="space-y-1 px-4 py-3 text-sm text-text-secondary">
          <p>
            {status.settings_available
              ? t("settings.privacy.upstreamImport.source.settingsAvailable")
              : t("settings.privacy.upstreamImport.source.settingsMissing")}
          </p>
          <p>
            {t("settings.privacy.upstreamImport.source.history", {
              count: status.history_entries,
            })}
          </p>
          <p>
            {t("settings.privacy.upstreamImport.source.recordings", {
              count: status.recording_files,
              size: t("settings.privacy.upstreamImport.byteCount", {
                value: NUMBER_FORMATTER.format(
                  model.upstreamRecordingSize.value,
                ),
                unit: t(
                  "settings.privacy.upstreamImport.byteUnits." +
                    model.upstreamRecordingSize.unit,
                ),
              }),
            })}
          </p>
          <p>{t("settings.privacy.upstreamImport.modelsNotImported")}</p>
        </div>
        {!model.upstreamSourceHasImportableData ? (
          <div className="px-4 pb-3">
            <StatusText live="polite">
              {t("settings.privacy.upstreamImport.source.empty")}
            </StatusText>
          </div>
        ) : !model.upstreamSelectionValid ? (
          <div className="px-4 pb-3">
            <StatusText live="polite">
              {t("settings.privacy.upstreamImport.selectionRequired")}
            </StatusText>
          </div>
        ) : null}
        {status.app_state === "running" ? (
          <Alert contained variant="error">
            {t("settings.privacy.upstreamImport.appRunning")}
          </Alert>
        ) : null}
        {status.app_state === "unverifiable" ? (
          <Alert contained variant="error">
            {t("settings.privacy.upstreamImport.appUnverifiable")}
          </Alert>
        ) : null}
        <fieldset
          className="space-y-2 border-t border-border px-4 py-3"
          disabled={model.upstreamImporting}
        >
          <legend className="sr-only">
            {t("settings.privacy.upstreamImport.selection")}
          </legend>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-accent-strong"
              checked={model.upstreamSelection.settings}
              disabled={!status.settings_available}
              onChange={(event) =>
                model.setUpstreamSelection((current) => ({
                  ...current,
                  settings: event.target.checked,
                }))
              }
            />
            <span className="text-sm text-text-primary">
              {t("settings.privacy.upstreamImport.selectionSettings")}
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-accent-strong"
              checked={model.upstreamSelection.history}
              disabled={status.history_entries === 0}
              onChange={(event) =>
                model.changeUpstreamHistorySelection(event.target.checked)
              }
            />
            <span className="text-sm text-text-primary">
              {t("settings.privacy.upstreamImport.selectionHistory")}
            </span>
          </label>
          <label
            className={
              model.upstreamSelection.history && status.recording_files > 0
                ? "flex cursor-pointer items-start gap-2"
                : "flex cursor-not-allowed items-start gap-2 text-text-tertiary"
            }
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-accent-strong"
              checked={model.upstreamSelection.recordings}
              disabled={
                !model.upstreamSelection.history || status.recording_files === 0
              }
              onChange={(event) =>
                model.setUpstreamSelection((current) => ({
                  ...current,
                  recordings: event.target.checked,
                }))
              }
            />
            <span className="text-sm">
              {t("settings.privacy.upstreamImport.selectionRecordings")}
            </span>
          </label>
          <p className="text-xs text-text-secondary">
            {t("settings.privacy.upstreamImport.recordingsRequireHistory")}
          </p>
        </fieldset>
        {model.upstreamProgress ? (
          <div className="px-4 pb-3">
            <StatusText live="polite">
              {t("settings.privacy.upstreamImport.progress", {
                phase: t(
                  "settings.privacy.upstreamImport.phases." +
                    model.upstreamProgress.phase,
                ),
                completed: model.upstreamProgress.completed,
                total: model.upstreamProgress.total,
              })}
            </StatusText>
          </div>
        ) : null}
        {model.upstreamResult ? (
          <div className="px-4 pb-3">
            <StatusText tone="success" live="polite">
              {t("settings.privacy.upstreamImport.result", {
                settings: model.upstreamResult.settings_imported
                  ? t("settings.privacy.upstreamImport.settingsImported")
                  : t(
                      "settings.privacy.upstreamImport.settingsAlreadyImported",
                    ),
                historyImported: model.upstreamResult.history_imported,
                historyExisting: model.upstreamResult.history_existing,
                recordingsCopied: model.upstreamResult.recordings_copied,
                recordingsExisting: model.upstreamResult.recordings_existing,
              })}
            </StatusText>
          </div>
        ) : null}
        {model.upstreamError ? (
          <Alert contained variant="error">
            {t("settings.privacy.upstreamImport.errors." + model.upstreamError)}
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void model.refreshUpstreamStatus()}
            disabled={model.loadingUpstreamStatus || model.upstreamImporting}
          >
            {t("settings.privacy.upstreamImport.refresh")}
          </Button>
          <Button
            size="sm"
            onClick={() => void model.startUpstreamImport()}
            disabled={
              !model.upstreamImportAvailable ||
              !model.upstreamSelectionValid ||
              model.upstreamImporting
            }
          >
            {model.upstreamImporting
              ? t("settings.privacy.upstreamImport.importing")
              : t("settings.privacy.upstreamImport.import")}
          </Button>
        </div>
      </SettingsGroup>
    );
  }

  if (model.upstreamError) {
    return (
      <SettingsGroup title={t("settings.privacy.upstreamImport.title")}>
        <Alert
          contained
          variant="error"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void model.refreshUpstreamStatus()}
              disabled={model.loadingUpstreamStatus}
            >
              {t("common.retry")}
            </Button>
          }
        >
          {t("settings.privacy.upstreamImport.errors." + model.upstreamError)}
        </Alert>
      </SettingsGroup>
    );
  }

  return null;
};
