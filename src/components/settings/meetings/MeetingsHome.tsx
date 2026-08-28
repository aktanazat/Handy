import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  MeetingHistorySummary,
  MeetingRetentionPolicy,
  MeetingSuggestion,
} from "@/bindings";
import {
  Alert,
  Button,
  EmptyState,
  Input,
  List,
  Row,
  Section,
  Skeleton,
} from "../../ui";
import {
  CaptureCompletenessText,
  MeetingPhaseText,
  ProcessingStatusText,
} from "./MeetingStatus";
import { formatMeetingDate, meetingProviderKey } from "./meetingUtils";

interface MeetingsHomeProps {
  suggestions: MeetingSuggestion[];
  recovery: MeetingHistorySummary[];
  meetings: MeetingHistorySummary[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** Read-only echo of the policy owned by Settings, Privacy. */
  retention: MeetingRetentionPolicy | null;
  error: string | null;
  onStartManual: () => void;
  onStartSuggestion: (suggestion: MeetingSuggestion) => void;
  onOpenMeeting: (sessionId: string) => void;
  onFinalizeRecovery: (sessionId: string) => void;
  onDiscardRecovery: (sessionId: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

const MeetingListSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div
    role="status"
    aria-label={label}
    className="divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface"
  >
    {[0, 1, 2].map((row) => (
      <div
        key={row}
        className="flex min-h-14 items-center justify-between gap-4 px-4 py-3"
      >
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-3 w-20" />
      </div>
    ))}
  </div>
);

interface MeetingRowMetaProps {
  meeting: MeetingHistorySummary;
}

/* State on the right, in words, on two lines: phase first because it decides
 * what the row can do, then how complete the capture was and where
 * processing got to. */
const MeetingRowMeta: React.FC<MeetingRowMetaProps> = ({ meeting }) => (
  <span className="flex flex-col items-end gap-0.5">
    <MeetingPhaseText phase={meeting.phase} />
    <span className="flex items-center gap-2">
      <CaptureCompletenessText completeness={meeting.capture_completeness} />
      <ProcessingStatusText status={meeting.processing_status} />
    </span>
  </span>
);

export const MeetingsHome: React.FC<MeetingsHomeProps> = ({
  suggestions,
  recovery,
  meetings,
  loading,
  loadingMore,
  hasMore,
  retention,
  error,
  onStartManual,
  onStartSuggestion,
  onOpenMeeting,
  onFinalizeRecovery,
  onDiscardRecovery,
  onLoadMore,
  onRetry,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const visibleMeetings = useMemo(() => {
    if (trimmedQuery.length === 0) return meetings;
    const needle = trimmedQuery.toLocaleLowerCase();
    return meetings.filter((meeting) =>
      meeting.title.toLocaleLowerCase().includes(needle),
    );
  }, [meetings, trimmedQuery]);

  const retentionHint =
    retention === null
      ? t("meetings.history.description")
      : t(
          "meetings.list.retentionHint",
          "Retention: {{policy}}. Change it in Settings, Privacy.",
          {
            policy:
              retention.kind === "forever"
                ? t("meetings.retention.forever")
                : t("meetings.retention.days", { days: retention.days }),
          },
        );

  return (
    <div className="settings-page">
      <header className="settings-page-header data-page-header">
        <div>
          <h1 className="settings-page-title">{t("meetings.title")}</h1>
          <p className="settings-page-description">
            {t("meetings.description")}
          </p>
        </div>
        <div className="data-page-actions">
          <Button type="button" onClick={onStartManual}>
            {t("meetings.actions.newMeeting")}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert
          variant="error"
          action={
            <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
              {t("meetings.actions.retry")}
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {suggestions.length > 0 ? (
        <Section
          title={t("meetings.detected.title")}
          description={t("meetings.detected.description")}
        >
          <List label={t("meetings.detected.title")}>
            {suggestions.map((suggestion) => (
              <Row
                key={suggestion.offer_id}
                title={t("meetings.detected.mayBeActive", {
                  provider: t(meetingProviderKey(suggestion.provider)),
                })}
                description={t(meetingProviderKey(suggestion.provider))}
                actions={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onStartSuggestion(suggestion)}
                  >
                    {t("meetings.actions.startLocal")}
                  </Button>
                }
              />
            ))}
          </List>
        </Section>
      ) : null}

      {recovery.length > 0 ? (
        <Section
          title={t("meetings.recovery.title")}
          description={t("meetings.recovery.description")}
        >
          <List label={t("meetings.recovery.title")}>
            {recovery.map((meeting) => (
              <Row
                key={meeting.session_id}
                title={meeting.title}
                description={formatMeetingDate(meeting.created_at_utc_ms)}
                meta={
                  <CaptureCompletenessText
                    completeness={meeting.capture_completeness}
                  />
                }
                actions={
                  <>
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
                  </>
                }
              />
            ))}
          </List>
        </Section>
      ) : null}

      <Section
        title={t("meetings.history.title")}
        description={retentionHint}
        actions={
          meetings.length > 0 ? (
            <Input
              type="search"
              variant="compact"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t("meetings.list.searchLabel", "Search meetings")}
              placeholder={t(
                "meetings.list.searchPlaceholder",
                "Search by title",
              )}
              className="w-56"
            />
          ) : null
        }
      >
        {loading ? (
          <MeetingListSkeleton label={t("meetings.history.loading")} />
        ) : meetings.length === 0 ? (
          <EmptyState
            title={t("meetings.history.emptyTitle")}
            description={t("meetings.history.emptyDescription")}
            action={
              <Button type="button" onClick={onStartManual}>
                {t("meetings.actions.newMeeting")}
              </Button>
            }
          />
        ) : (
          <>
            {visibleMeetings.length === 0 ? (
              <EmptyState
                title={t(
                  "meetings.list.noMatches",
                  "No meetings match that search",
                )}
                description={
                  hasMore
                    ? t(
                        "meetings.list.noMatchesNotLoaded",
                        'No loaded meeting title contains "{{query}}". Older meetings are still on disk: load them and search again.',
                        { query: trimmedQuery },
                      )
                    : t(
                        "meetings.list.noMatchesDescription",
                        'No meeting title contains "{{query}}". Clear the search to see the whole list.',
                        { query: trimmedQuery },
                      )
                }
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setQuery("")}
                  >
                    {t("meetings.list.clearSearch", "Clear search")}
                  </Button>
                }
              />
            ) : (
              <List label={t("meetings.history.title")}>
                {visibleMeetings.map((meeting) => (
                  <Row
                    key={meeting.session_id}
                    title={meeting.title}
                    description={formatMeetingDate(meeting.created_at_utc_ms)}
                    meta={<MeetingRowMeta meeting={meeting} />}
                    onSelect={() => onOpenMeeting(meeting.session_id)}
                  />
                ))}
              </List>
            )}
            {hasMore ? (
              <div className="mt-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore
                    ? t("meetings.list.loadingMore", "Loading older meetings…")
                    : t("meetings.list.loadMore", "Load older meetings")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Section>
    </div>
  );
};
