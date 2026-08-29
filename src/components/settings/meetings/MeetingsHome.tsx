import React, { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MeetingHistorySummary,
  MeetingRetentionPolicy,
  MeetingSuggestion,
  SourceKind,
} from "@/bindings";
import { Alert, Button, EmptyState, Input, Section, Skeleton } from "../../ui";
import {
  CaptureCompletenessText,
  MeetingPhaseText,
  ProcessingStatusText,
} from "./MeetingStatus";
import {
  MEETING_SOURCES,
  formatMeetingDate,
  meetingProviderKey,
  sourceKey,
} from "./meetingUtils";
import { MeetingDetectionSettings } from "./MeetingDetectionSettings";
import { PreMeetingCountdownCard } from "./PreMeetingCountdownCard";
import { MeetingTrackersSettings } from "./MeetingTrackersSettings";

/** DOM id of the primary Start control, so a deep link can land on it. */
const START_BUTTON_ID = "meeting-start-button";

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
  /** Sources the next capture will request. */
  sources: SourceKind[];
  starting: boolean;
  /** True when the person arrived here asking to start, so Start takes focus. */
  focusStart: boolean;
  onSourcesChange: (sources: SourceKind[]) => void;
  onStart: () => void;
  onStartSuggestion: (suggestion: MeetingSuggestion) => void;
  onOpenMeeting: (sessionId: string) => void;
  onFinalizeRecovery: (sessionId: string) => void;
  onDiscardRecovery: (sessionId: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

const MeetingListSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div role="status" aria-label={label} className="flex flex-col gap-2">
    {[0, 1, 2].map((row) => (
      <div
        key={row}
        className="flex min-h-14 items-center justify-between gap-4 rounded-panel border border-border-subtle px-4 py-3"
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

interface SourceChipProps {
  source: SourceKind;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}

/* A capture source is a two-state control, so it is one control with two
 * states rather than a checkbox pretending to be a setting. */
const SourceChip: React.FC<SourceChipProps> = ({
  source,
  selected,
  disabled,
  onToggle,
}) => {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className="meeting-source-chip"
    >
      {selected ? <Check size={13} aria-hidden="true" /> : null}
      {t(sourceKey(source))}
    </button>
  );
};

interface MeetingStartBlockProps {
  sources: SourceKind[];
  retention: MeetingRetentionPolicy | null;
  starting: boolean;
  focusStart: boolean;
  onSourcesChange: (sources: SourceKind[]) => void;
  onStart: () => void;
}

/* One press records a meeting. Everything else on this block is a state the
 * press will use, shown inline and changeable in place: never a step, never a
 * screen. The assurance sentence is beside the button because it is what the
 * press does to the room, and because pressing it is the acknowledgment the
 * backend records. */
const MeetingStartBlock: React.FC<MeetingStartBlockProps> = ({
  sources,
  retention,
  starting,
  focusStart,
  onSourcesChange,
  onStart,
}) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!focusStart) return;
    document.getElementById(START_BUTTON_ID)?.focus();
  }, [focusStart]);

  const toggle = (source: SourceKind) =>
    onSourcesChange(
      sources.includes(source)
        ? sources.filter((candidate) => candidate !== source)
        : [...sources, source],
    );

  return (
    <section
      className="meeting-start"
      aria-label={t("meetings.start.label", "Start a meeting")}
    >
      <div className="meeting-start-primary">
        <Button
          type="button"
          id={START_BUTTON_ID}
          className="meeting-start-button"
          onClick={onStart}
          disabled={starting || sources.length === 0}
        >
          {starting
            ? t("meetings.start.starting", "Starting…")
            : t("meetings.start.action", "Start recording")}
        </Button>
        <p className="meeting-start-assurance">
          {t(
            "meetings.start.assurance",
            "Records your Mac's audio locally. Nothing joins the call.",
          )}
        </p>
      </div>
      <div className="meeting-start-controls">
        <span className="microlabel">
          {t("meetings.start.capture", "Capture")}
        </span>
        {MEETING_SOURCES.map((source) => (
          <SourceChip
            key={source}
            source={source}
            selected={sources.includes(source)}
            disabled={starting}
            onToggle={() => toggle(source)}
          />
        ))}
        <span className="meeting-start-facts ms-auto">
          <span className="microlabel">
            {t("meetings.start.localOnly", "Local only")}
          </span>
          {retention === null ? null : (
            <span className="microlabel">
              {t("meetings.start.retention", "Kept: {{policy}}", {
                policy:
                  retention.kind === "forever"
                    ? t("meetings.retention.forever")
                    : t("meetings.retention.days", { days: retention.days }),
              })}
            </span>
          )}
        </span>
      </div>
      {sources.length === 0 ? (
        <p className="text-[12.5px] leading-[18px] text-warning">
          {t("meetings.start.noSources", "Choose at least one source.")}
        </p>
      ) : null}
    </section>
  );
};

interface MeetingCardProps {
  meeting: MeetingHistorySummary;
  onOpen: () => void;
}

/* A meeting is the one thing on this page a person selects and opens, which
 * is what earns it a surface. Everything else here is a flat row. */
const MeetingCard: React.FC<MeetingCardProps> = ({ meeting, onOpen }) => (
  <li>
    <button type="button" onClick={onOpen} className="meeting-card">
      <span className="min-w-0">
        <span className="meeting-card-title block">{meeting.title}</span>
        <span className="microlabel mt-0.5 block">
          {formatMeetingDate(meeting.created_at_utc_ms)}
        </span>
      </span>
      <span className="meeting-card-meta">
        <MeetingPhaseText phase={meeting.phase} />
        <span className="flex items-center gap-2">
          <CaptureCompletenessText
            completeness={meeting.capture_completeness}
          />
          <ProcessingStatusText status={meeting.processing_status} />
        </span>
      </span>
    </button>
  </li>
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
  sources,
  starting,
  focusStart,
  onSourcesChange,
  onStart,
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
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("meetings.title")}</h1>
        <p className="settings-page-description">{t("meetings.description")}</p>
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

      <MeetingStartBlock
        sources={sources}
        retention={retention}
        starting={starting}
        focusStart={focusStart}
        onSourcesChange={onSourcesChange}
        onStart={onStart}
      />

      <PreMeetingCountdownCard />

      {suggestions.length > 0 ? (
        <Section
          title={t("meetings.detected.title")}
          description={t(
            "meetings.start.assurance",
            "Records your Mac's audio locally. Nothing joins the call.",
          )}
        >
          <ul
            className="meeting-rows"
            aria-label={t("meetings.detected.title")}
          >
            {suggestions.map((suggestion) => (
              <li key={suggestion.offer_id} className="meeting-row">
                <p className="meeting-row-label">
                  {t("meetings.detected.mayBeActive", {
                    provider: t(meetingProviderKey(suggestion.provider)),
                  })}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={starting}
                  onClick={() => onStartSuggestion(suggestion)}
                >
                  {t("meetings.start.action", "Start recording")}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {recovery.length > 0 ? (
        <Section
          title={t("meetings.recovery.title")}
          description={t("meetings.recovery.description")}
        >
          <ul
            className="meeting-rows"
            aria-label={t("meetings.recovery.title")}
          >
            {recovery.map((meeting) => (
              <li key={meeting.session_id} className="meeting-row">
                <span className="min-w-0">
                  <p className="meeting-row-label">{meeting.title}</p>
                  <span className="microlabel">
                    {formatMeetingDate(meeting.created_at_utc_ms)}
                  </span>
                </span>
                <span className="flex flex-none items-center gap-2">
                  <CaptureCompletenessText
                    completeness={meeting.capture_completeness}
                  />
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
                </span>
              </li>
            ))}
          </ul>
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
          />
        ) : (
          <>
            {visibleMeetings.length === 0 ? (
              <EmptyState
                variant="no-results"
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
              <ul
                className="meeting-cards"
                aria-label={t("meetings.history.title")}
              >
                {visibleMeetings.map((meeting) => (
                  <MeetingCard
                    key={meeting.session_id}
                    meeting={meeting}
                    onOpen={() => onOpenMeeting(meeting.session_id)}
                  />
                ))}
              </ul>
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

      <MeetingTrackersSettings />
      <MeetingDetectionSettings />
    </div>
  );
};
