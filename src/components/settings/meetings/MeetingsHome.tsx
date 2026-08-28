import React from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MeetingHistorySummary,
  MeetingSuggestion,
} from "@/bindings";
import { Button } from "../../ui/Button";
import { CloudSyncPanel } from "../../cloud-sync/CloudSyncPanel";
import {
  CaptureCompletenessBadge,
  MeetingPhaseBadge,
  ProcessingStatusLine,
} from "./MeetingStatus";
import { formatMeetingDate, meetingProviderKey } from "./meetingUtils";

interface MeetingsHomeProps {
  suggestions: MeetingSuggestion[];
  recovery: MeetingHistorySummary[];
  meetings: MeetingHistorySummary[];
  loading: boolean;
  error: string | null;
  onStartManual: () => void;
  onStartSuggestion: (suggestion: MeetingSuggestion) => void;
  onOpenMeeting: (sessionId: string) => void;
  onFinalizeRecovery: (sessionId: string) => void;
  onDiscardRecovery: (sessionId: string) => void;
  onRetry: () => void;
}

export const MeetingsHome: React.FC<MeetingsHomeProps> = ({
  suggestions,
  recovery,
  meetings,
  loading,
  error,
  onStartManual,
  onStartSuggestion,
  onOpenMeeting,
  onFinalizeRecovery,
  onDiscardRecovery,
  onRetry,
}) => {
  const { t } = useTranslation();

  return (
    <div className="meetings-page meetings-home">
      <header className="settings-page-header data-page-header">
        <div>
          <h1 className="settings-page-title">{t("meetings.title")}</h1>
          <p className="settings-page-description">{t("meetings.description")}</p>
        </div>
        <div className="data-page-actions">
          <Button type="button" onClick={onStartManual}>
            {t("meetings.actions.newMeeting")}
          </Button>
        </div>
      </header>

      <CloudSyncPanel />

      {error ? (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
            {t("meetings.actions.retry")}
          </Button>
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <section className="detected-meeting-strip" aria-labelledby="meeting-detected">
          <h2 id="meeting-detected">{t("meetings.detected.title")}</h2>
          <div>
            {suggestions.map((suggestion) => (
              <div key={suggestion.offer_id} className="detected-meeting-row">
                <span>{t(meetingProviderKey(suggestion.provider))}</span>
                <strong>
                  {t("meetings.detected.mayBeActive", {
                    provider: t(meetingProviderKey(suggestion.provider)),
                  })}
                </strong>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onStartSuggestion(suggestion)}
                >
                  {t("meetings.actions.startLocal")}
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {recovery.length > 0 ? (
        <section className="meeting-recovery-section" aria-labelledby="meeting-recovery">
          <div className="section-heading-inline">
            <div>
              <h2 id="meeting-recovery">{t("meetings.recovery.title")}</h2>
              <p>{t("meetings.recovery.description")}</p>
            </div>
          </div>
          <div className="meeting-history-list">
            {recovery.map((meeting) => (
              <div key={meeting.session_id} className="meeting-history-row">
                <div className="meeting-history-row-copy">
                  <strong>{meeting.title}</strong>
                  <span>{formatMeetingDate(meeting.created_at_utc_ms)}</span>
                </div>
                <div className="meeting-history-row-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onFinalizeRecovery(meeting.session_id)}
                  >
                    {t("meetings.recovery.finalize")}
                  </Button>
                  <Button
                    type="button"
                    variant="danger-ghost"
                    size="sm"
                    onClick={() => onDiscardRecovery(meeting.session_id)}
                  >
                    {t("meetings.actions.discard")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="meeting-history-section" aria-labelledby="meeting-history">
        <div className="section-heading-inline">
          <div>
            <h2 id="meeting-history">{t("meetings.history.title")}</h2>
          </div>
        </div>
        {loading ? (
          <p className="compact-empty-row" role="status">
            {t("meetings.history.loading")}
          </p>
        ) : meetings.length === 0 ? (
          <div className="meetings-empty-state">
            <div>
              <h3>{t("meetings.history.emptyTitle")}</h3>
              <p>{t("meetings.history.emptyDescription")}</p>
            </div>
            <Button type="button" onClick={onStartManual}>
              {t("meetings.actions.newMeeting")}
            </Button>
          </div>
        ) : (
          <div className="meeting-history-list">
            {meetings.map((meeting) => (
              <button
                key={meeting.session_id}
                type="button"
                className="meeting-history-row meeting-history-button"
                onClick={() => onOpenMeeting(meeting.session_id)}
              >
                <span className="meeting-history-row-copy">
                  <strong>{meeting.title}</strong>
                  <span>{formatMeetingDate(meeting.created_at_utc_ms)}</span>
                </span>
                <span className="meeting-history-row-meta">
                  <MeetingPhaseBadge phase={meeting.phase} />
                  <CaptureCompletenessBadge completeness={meeting.capture_completeness} />
                  <ProcessingStatusLine status={meeting.processing_status} />
                  <ChevronRight size={15} aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

    </div>
  );
};
