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
import { Button } from "../ui/Button";

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
  onOpenSection?: (section: "meetings") => void;
}

interface OverviewState {
  historyTrend: HistoryTrendProjection | null;
  meetingTrend: MeetingTrendProjection | null;
  recentActivity: RecentActivity[];
  historyStats: HistoryStats | null;
  loading: boolean;
  historyError: boolean;
  meetingError: boolean;
  activityError: boolean;
  statsError: boolean;
}

type OverviewAction =
  | { type: "load-start" }
  | { type: "load-settled"; data: Omit<OverviewState, "loading"> }
  | { type: "load-finished" };

const DEFAULT_TREND_RANGE: DashboardTrendRange = "days_30";
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
  historyError: false,
  meetingError: false,
  activityError: false,
  statsError: false,
};

const overviewReducer = (
  state: OverviewState,
  action: OverviewAction,
): OverviewState => {
  switch (action.type) {
    case "load-start":
      return {
        ...state,
        loading: true,
        historyError: false,
        meetingError: false,
        activityError: false,
        statsError: false,
      };
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
  startingAudioImport: boolean;
  onStartAudioImport: () => void;
  onOpenMeetings: () => void;
}

const OverviewHero: React.FC<OverviewHeroProps> = ({
  isRecording,
  transcribeBinding,
  startingAudioImport,
  onStartAudioImport,
  onOpenMeetings,
}) => {
  const { t } = useTranslation();
  const shortcut = transcribeBinding ?? t("overview.actions.unavailable");

  return (
    <section className="overview-product" aria-labelledby="overview-status">
      <h1 id="overview-status" aria-live="polite">
        {t(isRecording ? "overview.hero.recording" : "overview.hero.ready")}
      </h1>
      <div className="overview-instruction">
        {t("overview.hero.instruction", { shortcut })}
      </div>
      <div className="overview-action-row">
        <div className="overview-shortcut" aria-label={t("overview.actions.dictate")}>
          <span>{t("overview.actions.dictate")}</span>
          <kbd>{shortcut}</kbd>
        </div>
        <Button
          type="button"
          className="overview-action"
          onClick={onOpenMeetings}
        >
          <Video aria-hidden="true" className="overview-action-icon" />
          {t("overview.hero.newMeeting")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="overview-action"
          onClick={onStartAudioImport}
          disabled={startingAudioImport}
        >
          <FileAudio aria-hidden="true" className="overview-action-icon" />
          {t("overview.hero.importAudio")}
        </Button>
      </div>
    </section>
  );
};

interface RecentActivityProps {
  items: RecentActivity[];
}

const RecentActivity: React.FC<RecentActivityProps> = ({ items }) => {
  const { t, i18n } = useTranslation();

  if (items.length === 0) return null;

  return (
    <section className="overview-activity" aria-label={t("overview.recent.title")}>
      <ul className="overview-recent-list">
        {items.slice(0, 3).map((item) => (
          <li key={item.id}>
            <span className="overview-recent-kind">
              {t(`overview.recent.${item.kind}`)}
            </span>
            <span className="overview-recent-title">{item.title}</span>
            <time dateTime={new Date(item.timestampMs).toISOString()}>
              {formatRelativeTime(
                String(Math.floor(item.timestampMs / 1000)),
                i18n.language,
              )}
            </time>
          </li>
        ))}
      </ul>
    </section>
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
          historyError:
            historyResult.status === "rejected" ||
            (historyResult.status === "fulfilled" &&
              historyResult.value.status === "error"),
          meetingError:
            meetingResult.status === "rejected" ||
            (meetingResult.status === "fulfilled" &&
              meetingResult.value.status === "error"),
          activityError:
            historyListResult.status === "rejected" ||
            meetingListResult.status === "rejected" ||
            (historyListResult.status === "fulfilled" &&
              historyListResult.value.status === "error") ||
            (meetingListResult.status === "fulfilled" &&
              meetingListResult.value.status === "error"),
          statsError:
            statsResult.status === "rejected" ||
            (statsResult.status === "fulfilled" &&
              statsResult.value.status === "error"),
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
    const interval = window.setInterval(() => void refreshRecordingState(), 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

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

  return (
    <div className="settings-page overview-page">
      <OverviewHero
        isRecording={isRecording}
        transcribeBinding={transcribeBinding}
        startingAudioImport={startingAudioImport}
        onStartAudioImport={() => void startAudioImport()}
        onOpenMeetings={() => onOpenSection?.("meetings")}
      />
      <RecentActivity items={overview.recentActivity} />
    </div>
  );
};
