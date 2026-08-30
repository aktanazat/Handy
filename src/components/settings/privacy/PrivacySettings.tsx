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
import { cn } from "@/lib/cn";
import { Button } from "@/components/vg/button";
import { Checkbox } from "@/components/vg/checkbox";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Switch } from "@/components/vg/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/vg/toggle-group";
import {
  FactChip,
  Notice,
  SettingsCard,
  SettingsField,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { AppDataDirectory } from "../AppDataDirectory";
import { CloudSyncPanel } from "../../cloud-sync/CloudSyncPanel";
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

/* The per-source rows in the diagnostics section, in capture order. Each row
 * is a name and a status word: the prose that used to restate the name from
 * the Rust doc comments is gone. */
const CONTEXT_SOURCES = [
  "target_identity",
  "focused_field",
  "selected_text",
  "browser_url",
  "clipboard",
] as const satisfies readonly (keyof ContextDiagnostics)[];

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
    <SettingsPage title={t("settings.privacy.title")}>
      {/* Ordered by how far the data travels: the egress card answers the one
       * question this page exists for, then what Sona reads from other apps,
       * then what this build can actually read, then what stays on disk. */}
      <PrivacyEgress model={model} />
      <PrivacyContextSettings model={model} />
      <PrivacyDiagnostics model={model} />
      <PrivacyDataSettings model={model} />
      {/* Setup, recovery and pairing stay collapsed: they are a one-time
       * task, and they must not read as a switch that is simply off. */}
      <CloudSyncPanel />
      <PrivacyUpstreamImport model={model} />
    </SettingsPage>
  );
};

/** A failure and the one control that clears it, on one line — not a box. */
const FailureNotice: React.FC<{
  children: React.ReactNode;
  onRetry?: () => void;
  retryDisabled?: boolean;
  className?: string;
}> = ({ children, onRetry, retryDisabled, className }) => {
  const { t } = useTranslation();

  return (
    <div
      className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1", className)}
    >
      <Notice tone="danger">{children}</Notice>
      {onRetry ? (
        <Button
          variant="link"
          size="xs"
          className="h-auto px-0 text-red-900"
          onClick={onRetry}
          disabled={retryDisabled}
        >
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
};

/** A status word, in the mono type every measurement on this page is set in. */
const MonoState: React.FC<{
  className?: string;
  live?: boolean;
  children: React.ReactNode;
}> = ({ className, live = false, children }) => (
  <span
    aria-live={live ? "polite" : undefined}
    className={cn(
      "font-mono text-[11px] uppercase tracking-[0.12em]",
      className,
    )}
  >
    {children}
  </span>
);

/* The page in four lines: one sentence that holds regardless of settings, then
 * one mono fact per route that can carry anything off this Mac. Every other
 * reassurance paragraph that used to be scattered through the sections below
 * collapsed into here, and nothing below restates it. */
const PrivacyEgress: React.FC<{ model: PrivacySettingsModel }> = ({
  model,
}) => {
  const { t } = useTranslation();
  const service = useCloudSyncServiceStatus();
  const status = service.value;
  const thisMac = t("settings.privacy.egress.thisMac");

  return (
    <SettingsCard className="flex flex-col gap-3 px-4 py-3.5">
      <p className="text-[13px] leading-5 text-gray-900">
        {t("settings.privacy.egress.assurance")}
      </p>
      {/* A route whose state could not be read shows no fact at all: a chip
       * reading "this Mac" would be a guess, and this is the one page that
       * cannot guess. */}
      <div aria-live="polite" className="flex flex-col gap-1.5">
        <FactChip
          label={t("settings.privacy.egress.routes.cleanup")}
          value={
            model.cloudRoutePending
              ? "…"
              : model.configuredCloudProviders.length > 0
                ? model.configuredCloudProviders.join(", ")
                : thisMac
          }
        />
        {model.cloudSttRouteError ? null : (
          <FactChip
            label={t("settings.privacy.cloudTranscription.title")}
            value={
              model.checkingCloudSttRoutes
                ? "…"
                : model.cloudSttDisclosureProviders.length > 0
                  ? model.cloudSttDisclosureProviders
                      .map((provider) => t(provider.labelKey))
                      .join(", ")
                  : thisMac
            }
          />
        )}
        {/* The chip names the ROUTE — which provider, or this Mac. This names
         * the PAYLOAD, and it is the one sentence in the app that itemises
         * what actually leaves the machine — so while a cloud route exists it
         * is read, not hovered, the same standing the meetings assurance has.
         * With no cloud route there is nothing leaving and nothing to say. */}
        {model.cloudSttRouteError ||
        model.cloudSttDisclosureProviders.length === 0 ? null : (
          <p className="text-[13px] leading-5 text-gray-900">
            {t("settings.privacy.cloudTranscription.disclosure")}
          </p>
        )}
        {service.phase === "failed" ? null : (
          <FactChip
            label={t("settings.privacy.cloudSync.title", "Cloud sync")}
            value={
              status === null
                ? "…"
                : status.configured
                  ? (status.endpoint ??
                    t("settings.privacy.cloudSync.configured", "Configured"))
                  : t(
                      "settings.privacy.cloudSync.notConfigured",
                      "Not configured",
                    )
            }
          />
        )}
      </div>
      {model.cloudSttRouteError ? (
        <FailureNotice onRetry={model.retryCloudSttRoutes}>
          {t("settings.privacy.cloudTranscription.checkFailed")}
        </FailureNotice>
      ) : null}
      {service.phase === "failed" ? (
        <FailureNotice onRetry={service.reload}>
          {t(
            "settings.privacy.cloudSync.checkFailed",
            "Sona could not read the cloud sync configuration.",
          )}
          {service.error === null ? "" : ` ${service.error}`}
        </FailureNotice>
      ) : null}
    </SettingsCard>
  );
};

const PrivacyContextSettings: React.FC<{
  model: PrivacySettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();

  return (
    <SettingsSection label={t("settings.privacy.context.title")}>
      <SettingsField label={t("settings.privacy.context.ceiling.label")}>
        {/* The one segmented primitive, same as Library's Processed/Raw and
         * the Material control: a bordered track whose active segment is
         * filled. Four sibling radio chips were a second convention. */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={model.contextCeiling}
          aria-label={t("settings.privacy.context.ceiling.label")}
          onValueChange={(next) => {
            /* Radix clears the value when the active segment is pressed
             * again, and a ceiling has no empty state: only a real member
             * reaches the command. */
            const ceiling = CONTEXT_POLICIES.find((policy) => policy === next);
            if (ceiling) void model.changeContextCeiling(ceiling);
          }}
        >
          {CONTEXT_POLICIES.map((policy) => (
            <ToggleGroupItem
              key={policy}
              value={policy}
              disabled={model.ceilingUpdating}
            >
              {t("settings.privacy.context.ceiling.values." + policy)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {/* What the selected level reads: a consequence of the choice above,
         * where the old four-row table restated all four labels. */}
        <Notice className="mt-2">
          {t("settings.privacy.context.sources." + model.contextCeiling)}
        </Notice>
      </SettingsField>
      {model.ceilingError ? (
        <FailureNotice className="px-4 py-2.5">
          {`${t("settings.privacy.context.ceiling.error")}: ${model.ceilingError}`}
        </FailureNotice>
      ) : null}
      <SettingsRow
        label={t("settings.privacy.context.urlCapture.label")}
        hint={t("settings.privacy.context.urlCapture.description")}
        controlId="privacy-url-capture"
      >
        <Switch
          id="privacy-url-capture"
          checked={model.contextUrlCaptureEnabled}
          disabled={model.urlCaptureUpdating}
          onCheckedChange={(enabled) =>
            void model.changeContextUrlCaptureEnabled(enabled)
          }
        />
      </SettingsRow>
      {model.urlCaptureError ? (
        <FailureNotice className="px-4 py-2.5">
          {model.urlCaptureError}
        </FailureNotice>
      ) : null}
    </SettingsSection>
  );
};

/* Four different reasons a source went unread are four different things the
 * user can act on, so the colour follows the reason rather than flattening
 * everything to "off". The word is always present; colour never carries the
 * meaning alone. */
const diagnosticToneClass = (status: string): string => {
  switch (status) {
    case "granted":
    case "captured":
      return "text-gray-1000";
    case "denied":
    case "permission_denied":
    case "failed":
      return "text-red-900";
    case "disabled_by_ceiling":
    case "secure_field":
    case "stale":
      return "text-amber-900";
    default:
      return "text-gray-700";
  }
};

const PrivacyDiagnostics: React.FC<{
  model: PrivacySettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const { diagnostics } = model;

  return (
    <SettingsSection
      label={t("settings.privacy.diagnostics.title")}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void model.refreshDiagnostics()}
          disabled={model.loadingDiagnostics}
        >
          <RefreshCw
            aria-hidden="true"
            className={model.loadingDiagnostics ? "animate-spin" : undefined}
          />
          {t("settings.privacy.diagnostics.refresh")}
        </Button>
      }
    >
      {model.diagnosticsError ? (
        <FailureNotice className="px-4 py-2.5">
          {`${t("settings.privacy.diagnostics.error")}: ${model.diagnosticsError}`}
        </FailureNotice>
      ) : null}
      {model.loadingDiagnostics && diagnostics === null ? (
        <div className="px-4 py-2.5">
          <Notice>{t("common.loading")}</Notice>
        </div>
      ) : diagnostics === null ? null : (
        <>
          <SettingsRow
            label={t("settings.privacy.diagnostics.accessibility.label")}
          >
            <MonoState
              className={diagnosticToneClass(diagnostics.accessibility)}
            >
              {t("settings.privacy.status." + diagnostics.accessibility)}
            </MonoState>
          </SettingsRow>
          {CONTEXT_SOURCES.map((source) => (
            <SettingsRow
              key={source}
              label={t("settings.privacy.diagnostics.sources." + source)}
            >
              <MonoState className={diagnosticToneClass(diagnostics[source])}>
                {t("settings.privacy.status." + diagnostics[source])}
              </MonoState>
            </SettingsRow>
          ))}
        </>
      )}
    </SettingsSection>
  );
};

const PrivacyDataSettings: React.FC<{
  model: PrivacySettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();

  return (
    <SettingsSection label={t("settings.privacy.data.title")}>
      <PrivacyHistoryStorage />
      {model.dataError ? (
        <FailureNotice className="px-4 py-2.5">
          {`${t("settings.privacy.data.error")}: ${model.dataError}`}
        </FailureNotice>
      ) : null}
      <SettingsRow
        label={t("settings.privacy.data.historyLimit.label")}
        hint={t("settings.privacy.data.historyLimit.description")}
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
      </SettingsRow>
      <SettingsRow
        label={t("settings.privacy.data.retention.label")}
        controlId="privacy-recording-retention"
      >
        <Select
          value={model.retentionPeriod}
          disabled={model.dataUpdating}
          onValueChange={(period) => {
            const next = RETENTION_OPTIONS.find(
              (candidate) => candidate === period,
            );
            if (next) void model.updateRetentionPeriod(next);
          }}
        >
          {/* No fixed width: the retention labels are long in several locales
           * and a Select trigger clips them with no ellipsis. */}
          <SelectTrigger id="privacy-recording-retention" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RETENTION_OPTIONS.map((period) => (
              <SelectItem key={period} value={period}>
                {t("settings.privacy.data.retention.values." + period)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <MeetingRetentionSettings />
      <AppDataDirectory />
    </SettingsSection>
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

  /* Only the reasons a reader can act on. "Unlocking" said the same thing as
   * the status word beside it, so it no longer says it twice. */
  const reasonText = (reason: string): string => {
    switch (reason) {
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

  const label = t(
    "settings.privacy.data.historyStorage.label",
    "History storage",
  );
  const status = storage.value;

  if (storage.phase === "failed") {
    return (
      <SettingsField label={label}>
        <FailureNotice onRetry={storage.reload}>
          {storage.error ??
            t(
              "settings.privacy.data.historyStorage.unknown",
              "Sona could not read how history is stored.",
            )}
        </FailureNotice>
      </SettingsField>
    );
  }

  if (status === null) {
    return (
      <SettingsRow label={label}>
        <Notice>{t("common.loading")}</Notice>
      </SettingsRow>
    );
  }

  const encryptedAndReadable = status.encrypted && status.reason === null;
  const unlocking = status.reason === "unlocking";
  const reason =
    encryptedAndReadable || status.reason === null || unlocking
      ? null
      : reasonText(status.reason);

  return (
    <>
      <SettingsRow
        label={label}
        fact={
          encryptedAndReadable && status.migrated_at !== null
            ? migratedFormatter.format(new Date(status.migrated_at))
            : undefined
        }
      >
        <MonoState
          live
          className={
            encryptedAndReadable
              ? "text-gray-1000"
              : unlocking
                ? "text-gray-700"
                : "text-red-900"
          }
        >
          {encryptedAndReadable
            ? t(
                "settings.privacy.data.historyStorage.encrypted",
                "Encrypted at rest",
              )
            : unlocking
              ? t("settings.privacy.data.historyStorage.unlocking", "Unlocking")
              : status.encrypted
                ? t("settings.privacy.data.historyStorage.locked", "Locked")
                : t(
                    "settings.privacy.data.historyStorage.plaintext",
                    "Not encrypted",
                  )}
        </MonoState>
      </SettingsRow>
      {reason === null ? null : (
        <div className="px-4 py-2.5">
          <Notice tone="danger">{reason}</Notice>
        </div>
      )}
    </>
  );
};

const PrivacyUpstreamImport: React.FC<{
  model: PrivacySettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const status = model.upstreamStatus;

  if (status?.available) {
    const importing = model.upstreamImporting;

    return (
      <SettingsSection
        label={t("settings.privacy.upstreamImport.title")}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void model.refreshUpstreamStatus()}
              disabled={model.loadingUpstreamStatus || importing}
            >
              {t("settings.privacy.upstreamImport.refresh")}
            </Button>
            <Button
              size="sm"
              onClick={() => void model.startUpstreamImport()}
              disabled={
                !model.upstreamImportAvailable ||
                !model.upstreamSelectionValid ||
                importing
              }
            >
              {importing
                ? t("settings.privacy.upstreamImport.importing")
                : t("settings.privacy.upstreamImport.import")}
            </Button>
          </div>
        }
      >
        <div className="px-4 py-2.5">
          <Notice live={false}>
            {t("settings.privacy.upstreamImport.scope")}
          </Notice>
        </div>
        {/* The counts sit on the rows that import them: three sentences of
         * inventory above three checkboxes said each number twice. */}
        <fieldset disabled={importing}>
          <legend className="sr-only">
            {t("settings.privacy.upstreamImport.selection")}
          </legend>
          <div className="divide-y divide-gray-alpha-400">
            <SettingsRow
              label={t("settings.privacy.upstreamImport.selectionSettings")}
              controlId="privacy-import-settings"
              disabled={!status.settings_available}
            >
              <Checkbox
                id="privacy-import-settings"
                checked={model.upstreamSelection.settings}
                disabled={!status.settings_available || importing}
                onCheckedChange={(checked) =>
                  model.setUpstreamSelection((current) => ({
                    ...current,
                    settings: checked === true,
                  }))
                }
              />
            </SettingsRow>
            <SettingsRow
              label={t("settings.privacy.upstreamImport.selectionHistory")}
              fact={NUMBER_FORMATTER.format(status.history_entries)}
              controlId="privacy-import-history"
              disabled={status.history_entries === 0}
            >
              <Checkbox
                id="privacy-import-history"
                checked={model.upstreamSelection.history}
                disabled={status.history_entries === 0 || importing}
                onCheckedChange={(checked) =>
                  model.changeUpstreamHistorySelection(checked === true)
                }
              />
            </SettingsRow>
            <SettingsRow
              label={t("settings.privacy.upstreamImport.selectionRecordings")}
              hint={t(
                "settings.privacy.upstreamImport.recordingsRequireHistory",
              )}
              /* KiB/MiB carry meaning in their case, and the mono fact type
               * is uppercase, so the measurement opts out of it. */
              fact={
                <span className="normal-case">
                  {`${NUMBER_FORMATTER.format(status.recording_files)} · ${t(
                    "settings.privacy.upstreamImport.byteCount",
                    {
                      value: NUMBER_FORMATTER.format(
                        model.upstreamRecordingSize.value,
                      ),
                      unit: t(
                        "settings.privacy.upstreamImport.byteUnits." +
                          model.upstreamRecordingSize.unit,
                      ),
                    },
                  )}`}
                </span>
              }
              controlId="privacy-import-recordings"
              disabled={
                !model.upstreamSelection.history || status.recording_files === 0
              }
            >
              <Checkbox
                id="privacy-import-recordings"
                checked={model.upstreamSelection.recordings}
                disabled={
                  !model.upstreamSelection.history ||
                  status.recording_files === 0 ||
                  importing
                }
                onCheckedChange={(checked) =>
                  model.setUpstreamSelection((current) => ({
                    ...current,
                    recordings: checked === true,
                  }))
                }
              />
            </SettingsRow>
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5 px-4 py-2.5 empty:hidden">
          {status.app_state === "running" ? (
            <Notice tone="danger">
              {t("settings.privacy.upstreamImport.appRunning")}
            </Notice>
          ) : null}
          {status.app_state === "unverifiable" ? (
            <Notice tone="danger">
              {t("settings.privacy.upstreamImport.appUnverifiable")}
            </Notice>
          ) : null}
          {!model.upstreamSourceHasImportableData ? (
            <Notice>{t("settings.privacy.upstreamImport.source.empty")}</Notice>
          ) : !model.upstreamSelectionValid ? (
            <Notice>
              {t("settings.privacy.upstreamImport.selectionRequired")}
            </Notice>
          ) : null}
          {model.upstreamProgress ? (
            <Notice>
              {t("settings.privacy.upstreamImport.progress", {
                phase: t(
                  "settings.privacy.upstreamImport.phases." +
                    model.upstreamProgress.phase,
                ),
                completed: model.upstreamProgress.completed,
                total: model.upstreamProgress.total,
              })}
            </Notice>
          ) : null}
          {model.upstreamResult ? (
            <Notice>
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
            </Notice>
          ) : null}
          {model.upstreamError ? (
            <Notice tone="danger">
              {t(
                "settings.privacy.upstreamImport.errors." + model.upstreamError,
              )}
            </Notice>
          ) : null}
        </div>
      </SettingsSection>
    );
  }

  if (model.upstreamError) {
    return (
      <SettingsSection label={t("settings.privacy.upstreamImport.title")}>
        <FailureNotice
          className="px-4 py-2.5"
          onRetry={() => void model.refreshUpstreamStatus()}
          retryDisabled={model.loadingUpstreamStatus}
        >
          {t("settings.privacy.upstreamImport.errors." + model.upstreamError)}
        </FailureNotice>
      </SettingsSection>
    );
  }

  return null;
};
