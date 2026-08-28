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
  type DashboardTrendRange,
  type HistoryEntry,
  type HistoryStats,
  type HistoryTrendProjection,
  type MeetingHistorySummary,
  type MeetingTrendProjection,
} from "@/bindings";
import { formatRelativeTime } from "@/utils/dateFormat";
import { useSettings } from "@/hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import { formatKeyCombination } from "@/lib/utils/keyboard";
import {
  Alert,
  Button,
  EmptyState,
  Kbd,
  List,
  Row,
  Section,
  Skeleton,
  StatusText,
} from "@/components/ui";
import { isFreshInstall, summarizeMeetings } from "./analytics";
import { OverviewAnalytics } from "./OverviewAnalytics";
import { UpdateBanner, UpdateCheckFailure } from "./UpdateNotice";
import { checkForUpdates, type UpdateCheckResult } from "@/lib/updateCheck";
import "./overview.css";

type RecentActivity =
  | {
      kind: "history";
      id: string;
      title: string;
      timestampMs: number;
    }
  | {
      kind: "meeting";
      id: string;
      title: string;
      timestampMs: number;
    };

interface OverviewProps {
  /* The shell passes its section setter. Overview only ever sends people to
   * the two places its own content comes from. */
  onOpenSection?: (section: "history" | "meetings") => void;
}

/* A failed read is a null payload: every one of these commands answers with a
 * zero-filled projection when there is simply nothing yet, so null and empty
 * are already distinguishable without a parallel set of error booleans.
 * `activityError` is the exception, because an empty recent list and a failed
 * one are both an empty array. */
interface OverviewState {
  historyTrend: HistoryTrendProjection | null;
  meetingTrend: MeetingTrendProjection | null;
  recentActivity: RecentActivity[];
  historyStats: HistoryStats | null;
  loading: boolean;
  activityError: boolean;
}

type OverviewAction =
  | { type: "load-start" }
  | { type: "load-settled"; data: Omit<OverviewState, "loading"> }
  | { type: "load-finished" };

const DEFAULT_TREND_RANGE: DashboardTrendRange = "days_30";
const RECENT_ACTIVITY_ROWS = 5;
/* Interpolated into the translated instruction, then split back out, so the
 * shortcut can be rendered as keycaps without hard-coding word order for the
 * 24 locales that already translate this sentence. */
const SHORTCUT_SLOT = "\u0000";
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

const INITIAL_OVERVIEW_STATE: OverviewState = {
  historyTrend: null,
  meetingTrend: null,
  recentActivity: [],
  historyStats: null,
  loading: true,
  activityError: false,
};

const overviewReducer = (
  state: OverviewState,
  action: OverviewAction,
): OverviewState => {
  switch (action.type) {
    case "load-start":
      return { ...state, loading: true, activityError: false };
    case "load-settled":
      return { ...state, ...action.data };
    case "load-finished":
      return { ...state, loading: false };
    default:
      return state;
  }
};

const mergeRecentActivity = (
  history: HistoryEntry[],
  meetings: MeetingHistorySummary[],
): RecentActivity[] => {
  const items: RecentActivity[] = [];
  for (const entry of history) {
    items.push({
      kind: "history",
      id: `history-${entry.id}`,
      title: entry.title || entry.file_name,
      timestampMs: entry.timestamp * 1000,
    });
  }
  for (const meeting of meetings) {
    items.push({
      kind: "meeting",
      id: `meeting-${meeting.session_id}`,
      title: meeting.title,
      timestampMs: meeting.created_at_utc_ms,
    });
  }
  items.sort((left, right) => right.timestampMs - left.timestampMs);
  return items.slice(0, 8);
};

interface OverviewHeroProps {
  isRecording: boolean;
  transcribeBinding: string | null;
  activeModeName: string | null;
  startingAudioImport: boolean;
  onStartAudioImport: () => void;
  onOpenMeetings: () => void;
}

const OverviewHero: React.FC<OverviewHeroProps> = ({
  isRecording,
  transcribeBinding,
  activeModeName,
  startingAudioImport,
  onStartAudioImport,
  onOpenMeetings,
}) => {
  const { t } = useTranslation();
  const osType = useOsType();

  const keys =
    transcribeBinding === null
      ? []
      : formatKeyCombination(transcribeBinding, osType)
          .split(" + ")
          .filter((key) => key.length > 0);
  const instruction = t("overview.hero.instruction", {
    shortcut: SHORTCUT_SLOT,
  }).split(SHORTCUT_SLOT);

  return (
    <section className="ov-hero" aria-labelledby="overview-status">
      <div className="ov-hero-text">
        <h1
          className="ov-hero-title"
          id="overview-status"
          data-recording={isRecording ? "true" : undefined}
          aria-live="polite"
        >
          {t(isRecording ? "overview.hero.recording" : "overview.hero.ready")}
        </h1>
        {keys.length > 0 ? (
          <p className="ov-hero-instruction">
            {instruction[0]}
            <span className="ov-keys">
              {keys.map((key, index) => (
                <Kbd key={`${key}-${index}`}>{key}</Kbd>
              ))}
            </span>
            {instruction.length > 1 ? instruction[1] : null}
          </p>
        ) : (
          <StatusText tone="warning">
            {`${t("overview.actions.unavailable")} ${t(
              "overview.hero.setShortcut",
              "Set a dictation shortcut in Settings to capture from any app.",
            )}`}
          </StatusText>
        )}
        {activeModeName !== null && (
          <p className="ov-hero-meta">
            {t("overview.hero.mode", "Mode: {{name}}", {
              name: activeModeName,
            })}
          </p>
        )}
      </div>
      <div className="ov-hero-actions">
        <Button type="button" onClick={onOpenMeetings}>
          <Video aria-hidden="true" className="size-3.5" />
          {t("overview.hero.newMeeting")}
        </Button>
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
    </section>
  );
};

interface RecentActivityListProps {
  items: RecentActivity[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onOpen: (section: "history" | "meetings") => void;
}

const RecentActivityList: React.FC<RecentActivityListProps> = ({
  items,
  loading,
  failed,
  onRetry,
  onOpen,
}) => {
  const { t, i18n } = useTranslation();
  const title = t("overview.recent.title");
  const rows = items.slice(0, RECENT_ACTIVITY_ROWS);

  const openLibrary = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => onOpen("history")}
    >
      {t("overview.recent.viewAll", "See all")}
    </Button>
  );

  if (loading) {
    return (
      <Section title={title}>
        <div
          role="status"
          aria-label={t("common.loading")}
          className="space-y-2"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </Section>
    );
  }

  if (failed) {
    return (
      <Section title={title}>
        <Alert
          variant="error"
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRetry}
            >
              {t("common.retry")}
            </Button>
          }
        >
          {t(
            "overview.recent.error",
            "Recent captures could not be loaded just now.",
          )}
        </Alert>
      </Section>
    );
  }

  if (rows.length === 0) {
    return (
      <Section title={title}>
        <EmptyState
          title={t("overview.recent.emptyTitle", "Nothing recent")}
          description={t(
            "overview.recent.emptyDescription",
            "Retained captures show up here as soon as you dictate or record a meeting.",
          )}
          action={openLibrary}
        />
      </Section>
    );
  }

  return (
    <Section title={title} actions={openLibrary}>
      <List label={title}>
        {rows.map((item) => (
          <Row
            key={item.id}
            title={item.title}
            description={t(`overview.recent.${item.kind}`)}
            meta={
              <time dateTime={new Date(item.timestampMs).toISOString()}>
                {formatRelativeTime(
                  String(Math.floor(item.timestampMs / 1000)),
                  i18n.language,
                )}
              </time>
            }
            onSelect={() =>
              onOpen(item.kind === "meeting" ? "meetings" : "history")
            }
          />
        ))}
      </List>
    </Section>
  );
};

export const Overview: React.FC<OverviewProps> = ({ onOpenSection }) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [overview, dispatch] = useReducer(
    overviewReducer,
    INITIAL_OVERVIEW_STATE,
  );
  const [startingAudioImport, setStartingAudioImport] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
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
        commands.getHistoryEntries(null, 4),
        commands.meetingList(null, 4),
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
      const historyStats =
        statsResult.status === "fulfilled" && statsResult.value.status === "ok"
          ? statsResult.value.data
          : null;

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
          recentActivity: mergeRecentActivity(historyEntries, meetingEntries),
          historyStats,
          activityError:
            historyListResult.status === "rejected" ||
            meetingListResult.status === "rejected" ||
            (historyListResult.status === "fulfilled" &&
              historyListResult.value.status === "error") ||
            (meetingListResult.status === "fulfilled" &&
              meetingListResult.value.status === "error"),
        },
      });
    } finally {
      if (requestRef.current === requestId) {
        dispatch({ type: "load-finished" });
      }
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    let active = true;
    const refreshRecordingState = async () => {
      try {
        const nextState = await commands.isRecording();
        if (active) setIsRecording(nextState);
      } catch {
        if (active) setIsRecording(false);
      }
    };

    void refreshRecordingState();
    const interval = window.setInterval(
      () => void refreshRecordingState(),
      1000,
    );
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

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

      <OverviewHero
        isRecording={isRecording}
        transcribeBinding={transcribeBinding}
        activeModeName={activeMode === null ? null : activeMode.name}
        startingAudioImport={startingAudioImport}
        onStartAudioImport={() => void startAudioImport()}
        onOpenMeetings={() => onOpenSection?.("meetings")}
      />

      {freshInstall ? (
        <EmptyState
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
            items={overview.recentActivity}
            loading={overview.loading}
            failed={overview.activityError}
            onRetry={() => void loadOverview()}
            onOpen={(kind) => onOpenSection?.(kind)}
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
