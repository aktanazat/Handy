import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { FileAudio, Video } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  commands,
  events,
  type DashboardTrendRange,
  type HistoryRunReceipt,
  type HistoryStats,
  type HistoryTrendProjection,
  type ModelLoadStatus,
  type RequestedEngine,
  type MeetingTrendProjection,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination, keyCapParts } from "@/lib/utils/keyboard";
import { getTranslatedModelName } from "@/lib/utils/modelTranslation";
import { useModelStore } from "@/stores/modelStore";
import {
  Button,
  EmptyState,
  Kbd,
  Section,
  ShaderHero,
  Skeleton,
  StatusText,
} from "@/components/ui";
import { isFreshInstall, summarizeMeetings } from "./analytics";
import {
  buildInstrumentCells,
  buildRecentActivity,
  newestReceipt,
  readFailure,
  shortenModelId,
  type InstrumentCell,
  type ReadFailure,
  type RecentActivityRow,
} from "./instrument";
import { InstrumentStrip } from "./InstrumentStrip";
import { OverviewAnalytics } from "./OverviewAnalytics";
import { UpdateBanner, UpdateCheckFailure } from "./UpdateNotice";
import { checkForUpdates, type UpdateCheckResult } from "@/lib/updateCheck";
import "./overview.css";

interface OverviewProps {
  /* The shell passes its section setter. Overview sends people to the two
   * places its own content comes from, plus Settings when the shortcut the
   * hero draws has to be changed. */
  onOpenSection?: (section: "history" | "meetings" | "settings") => void;
}

/* A failed read is a null payload for the projections: every one of those
 * commands answers with a zero-filled projection when there is simply nothing
 * yet, so null and empty are already distinguishable. The recent list is the
 * exception, because a successful empty range and a failed query are both an
 * empty array — so its failures are carried as the commands that failed and
 * whatever they said, and rendered verbatim. */
interface OverviewState {
  historyTrend: HistoryTrendProjection | null;
  meetingTrend: MeetingTrendProjection | null;
  recentActivity: RecentActivityRow[];
  historyStats: HistoryStats | null;
  /** Amplitudes off the newest run receipt; null when it did not measure. */
  inputPeak: number | null;
  inputRms: number | null;
  /** Realtime factor of the newest run's local decode; null when that run had
   * none to report. */
  realtimeFactor: number | null;
  loading: boolean;
  activityFailures: ReadFailure[];
}

type OverviewAction =
  | { type: "load-start" }
  | { type: "load-settled"; data: Omit<OverviewState, "loading"> }
  | { type: "load-finished" };

const DEFAULT_TREND_RANGE: DashboardTrendRange = "days_30";
const RECENT_ACTIVITY_ROWS = 5;
/* One page of each source. Both lists are merged and cut to
 * RECENT_ACTIVITY_ROWS, so fetching more would be receipts read for rows that
 * never render. */
const RECENT_SOURCE_PAGE = 5;
/* Fraction of the hero band the text column owns. The prism accent clamps
 * itself to the remainder — one number, two consumers, so the accent can never
 * be drawn across the copy. */
const HERO_CONTENT_SHARE = 0.62;
const MEDIA_IMPORT_EXTENSIONS = [
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "mov",
  "mp4",
  "m4v",
];

/**
 * Whether no explicit input device is chosen.
 *
 * `settingsStore.ts` substitutes the literal `"Default"` for an unset
 * `selected_microphone`, because that is the name the backend's own device list
 * gives its default entry and the Microphone dropdown has to be able to select
 * it. The instrument strip is a label, not that list, so it reports the
 * condition in the user's language instead of echoing the store's sentinel.
 */
const isDefaultMicrophone = (device: string | null): boolean =>
  device === null || device.length === 0 || device === "Default";

/* The engine reads as the thing it actually is: the local runtime, or the
 * named cloud provider. Every label already exists elsewhere in the bundle,
 * so this page adds no engine strings of its own. */
const ENGINE_LABEL_KEY = {
  local: "settings.modes.recognition.engine.local",
  deepgram_nova_3: "settings.models.cloud.providers.deepgram",
  eleven_labs_scribe_v2: "settings.models.cloud.providers.elevenLabs",
} satisfies Record<RequestedEngine, string>;

const INITIAL_OVERVIEW_STATE: OverviewState = {
  historyTrend: null,
  meetingTrend: null,
  recentActivity: [],
  historyStats: null,
  inputPeak: null,
  inputRms: null,
  realtimeFactor: null,
  loading: true,
  activityFailures: [],
};

const overviewReducer = (
  state: OverviewState,
  action: OverviewAction,
): OverviewState => {
  switch (action.type) {
    case "load-start":
      return { ...state, loading: true, activityFailures: [] };
    case "load-settled":
      return { ...state, ...action.data };
    case "load-finished":
      return { ...state, loading: false };
    default:
      return state;
  }
};

/** One receipt read per row, in one wave: five rows is five short queries. */
const loadReceipts = async (
  historyIds: number[],
): Promise<Map<number, HistoryRunReceipt[] | null>> => {
  const settled = await Promise.all(
    historyIds.map(async (historyId) => {
      try {
        const result = await commands.getHistoryRunReceipts(historyId);
        return [
          historyId,
          result.status === "ok" ? result.data : null,
        ] as const;
      } catch {
        return [historyId, null] as const;
      }
    }),
  );
  return new Map(settled);
};

/**
 * Mirrors the transcription pipeline's history writes onto this page. This page
 * reads history once per mount — the trend, the recent lists, the all-time
 * stats and the newest run's receipt — so a write that lands while it is open
 * has to re-run that read or the measured cells keep reporting the capture
 * before it. `reload` is the mount read itself, so a live dictation and a fresh
 * mount arrive at the same state by the same path.
 *
 * A row arriving, changing or leaving moves all four reads. Starring one moves
 * none of them: this page never draws the star, and its counters do not
 * distinguish a starred row from a plain one. Meeting notes are not history —
 * they keep their own store and their own events — so a note save never
 * reaches here.
 */
export const subscribeToHistoryWrites = (reload: () => void) =>
  events.historyUpdatePayload.listen((event) => {
    if (event.payload.action === "toggled") return;
    reload();
  });

interface OverviewHeroProps {
  isRecording: boolean;
  transcribeBinding: string | null;
  pushToTalk: boolean;
  startingAudioImport: boolean;
  onStartAudioImport: () => void;
  onOpenMeetings: () => void;
  onOpenShortcutSettings: () => void;
}

const OverviewHero: React.FC<OverviewHeroProps> = ({
  isRecording,
  transcribeBinding,
  pushToTalk,
  startingAudioImport,
  onStartAudioImport,
  onOpenMeetings,
  onOpenShortcutSettings,
}) => {
  const { t } = useTranslation();
  const osType = useOsType();

  const keys =
    transcribeBinding === null
      ? []
      : keyCapParts(transcribeBinding, osType).filter((key) => key.length > 0);
  /* One muted sentence, not two: the chord and the gesture are one fact about
   * one control. Push-to-talk off means the chord only toggles, so the
   * sentence has to stop claiming a hold that does nothing. */
  const gesture = t(
    pushToTalk
      ? "overview.hero.gestureTapHold"
      : "overview.hero.gestureTapOnly",
    pushToTalk
      ? "Tap to toggle, hold to talk, anywhere."
      : "Tap to toggle, anywhere.",
  );

  return (
    <ShaderHero className="ov-hero-band" clear={HERO_CONTENT_SHARE}>
      <section className="ov-hero" aria-labelledby="overview-status">
        <div className="ov-hero-text">
          <h1
            className="ov-hero-title type-display snap-measured"
            id="overview-status"
            data-recording={isRecording ? "true" : undefined}
            aria-live="polite"
          >
            <span aria-hidden="true" className="ov-hero-dot" />
            {t(isRecording ? "overview.hero.recording" : "overview.hero.ready")}
          </h1>
          {/* The shortcut is the product's whole interface, so it is drawn as
           * the keys themselves and the keys are the control that goes and
           * changes them — not a sentence pointing at a settings page. */}
          {keys.length > 0 ? (
            <p className="ov-hero-instruction type-secondary">
              <button
                type="button"
                className="ov-keys"
                onClick={onOpenShortcutSettings}
                title={
                  transcribeBinding === null
                    ? undefined
                    : formatKeyCombination(transcribeBinding, osType)
                }
                aria-label={t(
                  "overview.hero.shortcutAction",
                  "Change dictation shortcut",
                )}
                data-testid="overview-shortcut"
              >
                {keys.map((key, index) => (
                  <Kbd key={`${key}-${index}`}>{key}</Kbd>
                ))}
              </button>
              {gesture}
            </p>
          ) : (
            <p className="ov-hero-instruction type-secondary">
              <StatusText tone="warning">
                {`${t("overview.actions.unavailable")} ${t(
                  "overview.hero.setShortcut",
                  "Set a dictation shortcut in Settings to capture from any app.",
                )}`}
              </StatusText>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onOpenShortcutSettings}
                data-testid="overview-shortcut"
              >
                {t("overview.hero.setShortcutAction", "Set a shortcut")}
              </Button>
            </p>
          )}
          <div className="ov-hero-actions">
            {/* One click starts a meeting, so the reassurance sits with the
             * button rather than behind a wizard step nobody reads. The key
             * lives in the meetings subtree, which owns this promise's exact
             * wording in every locale. */}
            <span className="ov-hero-action">
              <Button type="button" onClick={onOpenMeetings}>
                <Video aria-hidden="true" className="size-3.5" />
                {t("overview.hero.newMeeting")}
              </Button>
              <span className="ov-hero-assurance type-secondary">
                {t(
                  "meetings.start.assurance",
                  "Records your Mac's audio locally. Nothing joins the call.",
                )}
              </span>
            </span>
            <Button
              type="button"
              variant="secondary"
              onClick={onStartAudioImport}
              disabled={startingAudioImport}
            >
              <FileAudio aria-hidden="true" className="size-3.5" />
              {t("overview.hero.importAudio")}
            </Button>
          </div>
        </div>
      </section>
    </ShaderHero>
  );
};

interface RecentActivityListProps {
  rows: RecentActivityRow[];
  loading: boolean;
  failures: ReadFailure[];
  onRetry: () => void;
  onOpen: (section: "history" | "meetings") => void;
}

const RecentActivityList: React.FC<RecentActivityListProps> = ({
  rows,
  loading,
  failures,
  onRetry,
  onOpen,
}) => {
  const { t } = useTranslation();
  const title = t("overview.recent.title");
  const visible = rows.slice(0, RECENT_ACTIVITY_ROWS);

  if (loading) {
    return (
      <Section title={title}>
        <div
          role="status"
          aria-label={t("common.loading")}
          className="ov-activity"
        >
          <Skeleton className="ov-activity-placeholder" />
          <Skeleton className="ov-activity-placeholder" />
          <Skeleton className="ov-activity-placeholder" />
        </div>
      </Section>
    );
  }

  /* A read that failed says which command failed and exactly what it said.
   * A read that succeeded and found nothing is not a failure and never says
   * one: on a healthy install these queries succeed, so the old "could not be
   * loaded" line on an empty range was a false alarm. */
  if (failures.length > 0) {
    return (
      <Section title={title}>
        <div className="ov-activity-failure">
          {failures.map((failure) => (
            <p className="type-data" key={failure.command}>
              {failure.detail === null
                ? t("overview.recent.failedCommand", "{{command}} failed", {
                    command: failure.command,
                  })
                : t(
                    "overview.recent.failedCommandWithDetail",
                    "{{command}} failed: {{detail}}",
                    { command: failure.command, detail: failure.detail },
                  )}
            </p>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      </Section>
    );
  }

  if (visible.length === 0) {
    return (
      <Section title={title}>
        <p className="ov-activity-empty type-body">
          {t(
            "overview.recent.emptyRange",
            "No dictations or meetings in the last 30 days.",
          )}
        </p>
      </Section>
    );
  }

  return (
    <Section
      title={title}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onOpen("history")}
        >
          {t("overview.recent.viewAll", "See all")}
        </Button>
      }
    >
      <ul className="ov-activity" aria-label={title}>
        {visible.map((row) => (
          <li className="ov-activity-row" key={row.key}>
            <button
              type="button"
              className="ov-activity-open"
              onClick={() => onOpen(row.section)}
              title={row.reading}
            >
              <span className="ov-activity-facts type-data snap-measured">
                {row.facts.map((fact, index) => (
                  <span className="ov-activity-fact" key={`${fact}-${index}`}>
                    {fact}
                  </span>
                ))}
              </span>
              <span className="ov-activity-snippet type-body">
                {row.snippet}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
};

export const Overview: React.FC<OverviewProps> = ({ onOpenSection }) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const osType = useOsType();
  /* The catalog is already loaded by the model chip in the top bar, so this
   * is a read of state the window is holding anyway. */
  const models = useModelStore((state) => state.models);
  const [overview, dispatch] = useReducer(
    overviewReducer,
    INITIAL_OVERVIEW_STATE,
  );
  const [startingAudioImport, setStartingAudioImport] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelLoadStatus | null>(null);
  const [deviceChannels, setDeviceChannels] = useState<number | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(
    null,
  );
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const requestRef = useRef(0);

  const loadOverview = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    dispatch({ type: "load-start" });

    try {
      const [
        historyResult,
        meetingResult,
        historyListResult,
        meetingListResult,
        statsResult,
      ] = await Promise.allSettled([
        commands.getHistoryTrend({ range: DEFAULT_TREND_RANGE }),
        commands.meetingTrend({ range: DEFAULT_TREND_RANGE }),
        commands.getHistoryEntries(null, RECENT_SOURCE_PAGE),
        // Recent activity wants the newest meetings, unnarrowed.
        commands.meetingList(null, RECENT_SOURCE_PAGE, null),
        commands.getHistoryStats(),
      ]);

      if (requestRef.current !== requestId) return;

      const historyEntries =
        historyListResult.status === "fulfilled" &&
        historyListResult.value.status === "ok"
          ? historyListResult.value.data.entries
          : [];
      const meetingEntries =
        meetingListResult.status === "fulfilled" &&
        meetingListResult.value.status === "ok"
          ? meetingListResult.value.data.entries
          : [];

      const receipts = await loadReceipts(
        historyEntries.map((entry) => entry.id),
      );
      if (requestRef.current !== requestId) return;

      /* The newest run of the newest entry is the last thing the microphone
       * actually delivered, so its amplitudes and its decode throughput are
       * what INPUT and ENGINE report. */
      const latestReceipt =
        historyEntries.length === 0
          ? null
          : newestReceipt(receipts.get(historyEntries[0].id));

      dispatch({
        type: "load-settled",
        data: {
          historyTrend:
            historyResult.status === "fulfilled" &&
            historyResult.value.status === "ok"
              ? historyResult.value.data
              : null,
          meetingTrend:
            meetingResult.status === "fulfilled" &&
            meetingResult.value.status === "ok"
              ? meetingResult.value.data
              : null,
          recentActivity: buildRecentActivity(
            historyEntries,
            receipts,
            meetingEntries,
            settings?.modes ?? [],
            {
              meeting: t("overview.recent.meeting"),
              words: (count) =>
                t("overview.recent.words", "{{count}} words", { count }),
              /* SAFETY: `engine_used` is `RequestedEngine` on the receipt, and
                 the map is keyed by that exact union; the `??` covers a receipt
                 written by a newer build with a route this one does not know. */
              engine: (engine) =>
                t(
                  ENGINE_LABEL_KEY[engine as RequestedEngine] ??
                    ENGINE_LABEL_KEY.local,
                ),
              phase: (phase) => t(`meetings.phases.${phase}`, phase),
            },
            Date.now(),
          ),
          historyStats:
            statsResult.status === "fulfilled" &&
            statsResult.value.status === "ok"
              ? statsResult.value.data
              : null,
          inputPeak: latestReceipt?.mode.input_peak ?? null,
          inputRms: latestReceipt?.mode.input_rms ?? null,
          realtimeFactor: latestReceipt?.mode.realtime_factor ?? null,
          activityFailures: [
            readFailure("get_history_entries", historyListResult),
            readFailure("meeting_list", meetingListResult),
          ].filter((failure): failure is ReadFailure => failure !== null),
        },
      });
    } finally {
      if (requestRef.current === requestId) {
        dispatch({ type: "load-finished" });
      }
    }
  }, [settings?.modes, t]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  /* `loadOverview` already discards a superseded wave, so re-reading on a
   * write costs reads rather than a wrong number, and at dictation cadence
   * that is one wave per capture. */
  useEffect(() => {
    const subscription = subscribeToHistoryWrites(() => void loadOverview());
    return () => {
      void subscription.then(
        (unlisten) => unlisten(),
        (error) => console.error("History event subscription failed:", error),
      );
    };
  }, [loadOverview]);

  useEffect(() => {
    let active = true;
    /* Recording state and engine binding are both polled: the backend loads
     * and unloads the model on its own schedule, so a cached answer would
     * report a binding that is no longer there. */
    const refresh = async () => {
      try {
        const recording = await commands.isRecording();
        if (active) setIsRecording(recording);
      } catch {
        if (active) setIsRecording(false);
      }
      try {
        const status = await commands.getModelLoadStatus();
        if (active && status.status === "ok") {
          setModelStatus(status.data);
        }
      } catch {
        if (active) setModelStatus(null);
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const selectedMicrophone = settings?.selected_microphone ?? null;
  useEffect(() => {
    let active = true;
    /* The channel count is a property of the device, so it is re-read when the
     * device changes and not on a timer. "default" resolves to whatever the OS
     * currently calls the default input. */
    const readChannels = async () => {
      try {
        const result = await commands.getMicrophoneChannels(
          selectedMicrophone ?? "default",
        );
        if (active)
          setDeviceChannels(result.status === "ok" ? result.data : null);
      } catch {
        if (active) setDeviceChannels(null);
      }
    };
    void readChannels();
    return () => {
      active = false;
    };
  }, [selectedMicrophone]);

  const runUpdateCheck = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      setUpdateResult(await checkForUpdates());
    } catch {
      /* The command reports its own failures in `status`, so a rejected call
       * means it is missing from this build. Nothing worth telling the user. */
      setUpdateResult(null);
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  /* One check per visit to this page. The backend owns the decision: when
   * automatic checks are off it answers "disabled" without touching the
   * network, and this page renders nothing for that status. */
  useEffect(() => {
    void runUpdateCheck();
  }, [runUpdateCheck]);

  const startAudioImport = async () => {
    if (startingAudioImport) return;
    setStartingAudioImport(true);
    try {
      const selectedPath = await open({
        directory: false,
        multiple: false,
        filters: [
          {
            name: t("settings.history.audioImport.fileFilter"),
            extensions: MEDIA_IMPORT_EXTENSIONS,
          },
        ],
      });
      if (selectedPath === null || Array.isArray(selectedPath)) return;
      const result = await commands.importAudioFile(selectedPath);
      if (result.status === "error") return;
    } catch {
      // History owns the authoritative error UI for audio imports.
    } finally {
      setStartingAudioImport(false);
    }
  };

  const transcribeBinding =
    settings?.bindings?.transcribe?.current_binding?.trim() || null;
  const activeMode =
    settings?.modes?.find((mode) => mode.id === settings.active_mode_id) ??
    null;
  const requestedEngine: RequestedEngine =
    activeMode?.asr.requested_engine ?? "local";
  const modelId = activeMode?.asr.model_id?.trim() || settings?.selected_model;
  const catalogEntry =
    modelId === undefined ? undefined : models.find((m) => m.id === modelId);

  const instrumentCells: InstrumentCell[] = buildInstrumentCells(
    {
      modeName: activeMode?.name ?? null,
      modelName:
        modelId === undefined || modelId.length === 0
          ? null
          : catalogEntry === undefined
            ? shortenModelId(modelId)
            : getTranslatedModelName(catalogEntry, t),
      engineLabel: t(ENGINE_LABEL_KEY[requestedEngine]),
      engineIsLocal: requestedEngine === "local",
      backend: modelStatus?.backend ?? null,
      modelLoaded: modelStatus === null ? null : modelStatus.is_loaded,
      deviceName: isDefaultMicrophone(selectedMicrophone)
        ? t("overview.instrument.systemDefault", "System default")
        : selectedMicrophone,
      deviceChannels,
      selectedChannel: settings?.selected_channel ?? null,
      inputPeak: overview.inputPeak,
      inputRms: overview.inputRms,
      realtimeFactor: overview.realtimeFactor,
      keys:
        transcribeBinding === null
          ? []
          : keyCapParts(transcribeBinding, osType).filter(
              (key) => key.length > 0,
            ),
      pushToTalk: settings === null ? null : (settings.push_to_talk ?? true),
    },
    {
      engine: t("overview.instrument.engine", "Engine"),
      input: t("overview.instrument.input", "Input"),
      shortcut: t("overview.instrument.shortcut", "Shortcut"),
      mode: t("overview.instrument.mode", "Mode"),
      loaded: t("overview.instrument.loaded", "loaded"),
      unloaded: t("overview.instrument.unloaded", "unloaded"),
      notMeasured: t("overview.instrument.notMeasured", "not measured"),
      unbound: t("overview.instrument.unbound", "not set"),
      gestureTapHold: t("overview.instrument.gestureTapHold", "tap · hold"),
      gestureTap: t("overview.instrument.gestureTap", "tap"),
      channel: (channel) =>
        t("overview.instrument.channel", "ch {{channel}}", { channel }),
      channels: (count) =>
        t("overview.instrument.channels", "{{count}} ch", { count }),
      sampleRate: (kilohertz) =>
        t("overview.instrument.rate", "{{kilohertz}} kHz", { kilohertz }),
      decode: (factor) =>
        t("overview.instrument.decode", "decode {{factor}}", { factor }),
    },
  );

  const meetings = summarizeMeetings(overview.meetingTrend);
  const freshInstall =
    !overview.loading &&
    isFreshInstall(
      overview.historyStats,
      meetings,
      overview.recentActivity.length,
    );

  return (
    <div className="settings-page ov-page">
      {updateResult !== null &&
        updateResult.status === "update_available" &&
        !updateDismissed && (
          <UpdateBanner
            result={updateResult}
            onDismiss={() => setUpdateDismissed(true)}
          />
        )}

      <div className="ov-capture">
        <OverviewHero
          isRecording={isRecording}
          transcribeBinding={transcribeBinding}
          pushToTalk={settings?.push_to_talk ?? true}
          startingAudioImport={startingAudioImport}
          onStartAudioImport={() => void startAudioImport()}
          onOpenMeetings={() => onOpenSection?.("meetings")}
          onOpenShortcutSettings={() => onOpenSection?.("settings")}
        />
        <InstrumentStrip
          cells={instrumentCells}
          label={t("overview.instrument.label", "Capture instrument")}
        />
      </div>

      {freshInstall ? (
        <EmptyState
          variant="informational"
          title={t("overview.empty.title", "No captures yet")}
          description={t(
            "overview.empty.description",
            "Hold your dictation shortcut in any app and Sona types what you say. Your usage stats and recent captures appear here after the first one.",
          )}
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenSection?.("history")}
            >
              {t("overview.empty.action", "Open Library")}
            </Button>
          }
        />
      ) : (
        <>
          <OverviewAnalytics
            loading={overview.loading}
            trend={overview.historyTrend}
            stats={overview.historyStats}
            meetingTrend={overview.meetingTrend}
            onRetry={() => void loadOverview()}
          />
          <RecentActivityList
            rows={overview.recentActivity}
            loading={overview.loading}
            failures={overview.activityFailures}
            onRetry={() => void loadOverview()}
            onOpen={(section) => onOpenSection?.(section)}
          />
        </>
      )}

      {updateResult !== null && updateResult.status === "check_failed" && (
        <UpdateCheckFailure
          result={updateResult}
          onRetry={() => void runUpdateCheck()}
          retrying={checkingUpdate}
        />
      )}
    </div>
  );
};
