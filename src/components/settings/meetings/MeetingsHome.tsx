import React, { useEffect, useState } from "react";
import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MeetingExportFormat,
  MeetingHistorySummary,
  MeetingListFilter,
  MeetingRetentionPolicy,
  MeetingStatusFilter,
  MeetingSuggestion,
  MeetingTimeWindow,
  SourceKind,
} from "@/bindings";
import {
  Alert,
  Button,
  Dropdown,
  EmptyState,
  Input,
  Section,
  Skeleton,
} from "../../ui";
import { CaptureCompletenessText, MeetingStatusChip } from "./MeetingStatus";
import {
  MEETING_SOURCES,
  MEETING_STATUS_FILTERS,
  MEETING_TIME_WINDOWS,
  NO_MEETING_FILTER,
  isUnfilteredMeetingList,
  meetingStatusFilterKey,
  meetingTimeWindowKey,
} from "./meetingUtils";
import { formatDurationShort, formatEntryTimestamp } from "@/lib/utils/format";
import { MeetingDetectionSettings } from "./MeetingDetectionSettings";
import type { MeetingPreviewFacts } from "./MeetingPreviewCard";
import { MeetingSourceChip } from "./MeetingSourceChip";
import { MeetingSuggestionPreviews } from "./MeetingSuggestionPreviews";
import { PreMeetingCountdownCard } from "./PreMeetingCountdownCard";
import { MeetingTrackersSettings } from "./MeetingTrackersSettings";

/* Long enough that a typed word is one query, short enough that the list
 * still feels like it is answering the keyboard. */
const MEETING_SEARCH_DEBOUNCE_MS = 200;

/** DOM id of the primary Start control, so a deep link can land on it. */
const START_BUTTON_ID = "meeting-start-button";

interface MeetingsHomeProps {
  suggestions: MeetingSuggestion[];
  recovery: MeetingHistorySummary[];
  meetings: MeetingHistorySummary[];
  loading: boolean;
  /** True while a page other than the one on screen is being fetched. */
  paging: boolean;
  /** Whether a page exists after the one on screen. Cursor paging cannot know
   *  a total, so this and `page` are the whole truth about position. */
  hasMore: boolean;
  /** 1-based position of the page on screen. */
  page: number;
  /** What the store was asked for. Owned by the caller, which is what makes
   *  the filters real rather than a view over an already-fetched page. */
  filter: MeetingListFilter;
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
  /** Starts a detected calendar event through the same preflight the manual
   * press uses, carrying what the operator was looking at. */
  onStartEvent: (facts: MeetingPreviewFacts) => void;
  onOpenMeeting: (sessionId: string) => void;
  onFinalizeRecovery: (sessionId: string) => void;
  onDiscardRecovery: (sessionId: string) => void;
  onFilterChange: (filter: MeetingListFilter) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onExportMeeting: (sessionId: string, format: MeetingExportFormat) => void;
  onExportLedger: (sessionId: string) => void;
  onDeleteMeeting: (sessionId: string) => void;
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
          <MeetingSourceChip
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

interface MeetingRowProps {
  meeting: MeetingHistorySummary;
  onOpen: () => void;
  onExport: (format: MeetingExportFormat) => void;
  onExportLedger: () => void;
  onDelete: () => void;
}

/* Three lines, and every one of them is a different question.
 *
 *   1  what this meeting is, and whether it can be read yet
 *   2  what came out of it, in one sentence
 *   3  who was in it, and what the capture itself was
 *
 * Line 2 is the only line that can be missing, because it is the only line
 * whose content a model had to produce. Which of the three real sources it
 * came from is stated on the row as `data-headline`, so a reader who cares
 * whether they are looking at a written headline or a measured count can find
 * out, and a test can assert on it rather than on prose.
 *
 * Nothing here is rounded up. No recorded duration prints no duration, not
 * "0s"; no speakers prints no speaker line, not "Unknown". */
const MeetingRow: React.FC<MeetingRowProps> = ({
  meeting,
  onOpen,
  onExport,
  onExportLedger,
  onDelete,
}) => {
  const { t } = useTranslation();
  const headline = meeting.headline ?? { kind: "none" };
  const speakers = meeting.speaker_labels ?? [];
  const sources = meeting.sources ?? [];
  const recordedMs = meeting.recorded_duration_ms ?? null;
  const actionsLabel = t("meetings.list.rowActions", "Meeting actions");
  /* A menu item does its thing and shuts the menu it was in. `<details>` is
   * the menu, so closing it is removing the attribute that opened it. */
  const runAction = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: () => void,
  ) => {
    action();
    event.currentTarget.closest("details")?.removeAttribute("open");
  };

  return (
    <li className="meeting-entry" data-headline={headline.kind}>
      <button
        type="button"
        onClick={onOpen}
        className="meeting-entry-open"
        title={
          headline.kind === "ledger" || headline.kind === "summary"
            ? `${meeting.title} — ${headline.text}`
            : meeting.title
        }
      >
        <span className="meeting-entry-head">
          <span className="type-row-title meeting-entry-name">
            {meeting.title}
          </span>
          <MeetingStatusChip
            phase={meeting.phase}
            processing={meeting.processing_status}
          />
        </span>
        {/* The line is always here, even empty. A list whose rows change
         * height depending on whether a model wrote a sentence is harder to
         * read down than a list with a blank line in it. */}
        <span className="meeting-entry-line">
          {headline.kind === "none"
            ? null
            : headline.kind === "words"
              ? t(
                  "meetings.list.headline.words",
                  "{{count}} words transcribed",
                  { count: headline.words },
                )
              : headline.text}
        </span>
        <span className="meeting-entry-foot">
          {speakers.length === 0 ? (
            <span className="meeting-entry-speakers" />
          ) : (
            <span className="meeting-entry-speakers microlabel">
              {speakers.join(", ")}
            </span>
          )}
          <span className="meeting-entry-facts">
            {sources.length === 0 ? null : (
              <span className="microlabel">
                {sources
                  .map((source) =>
                    source === "microphone"
                      ? t("meetings.list.sourceGlyph.microphone", "MIC")
                      : t("meetings.list.sourceGlyph.system_audio", "SYS"),
                  )
                  .join(" ")}
              </span>
            )}
            {meeting.capture_completeness === "partial" ? (
              <CaptureCompletenessText
                completeness="partial"
                className="microlabel"
              />
            ) : null}
            {recordedMs === null ? null : (
              <span className="microlabel">
                {formatDurationShort(recordedMs / 1000)}
              </span>
            )}
            <span className="microlabel">
              {formatEntryTimestamp(meeting.created_at_utc_ms)}
            </span>
          </span>
        </span>
      </button>
      {/* Everything that leaves the page or destroys the meeting sits behind
       * one summary, so a list of thirty rows carries thirty controls rather
       * than a hundred and twenty. */}
      <details className="meeting-actions-menu">
        <summary aria-label={actionsLabel} title={actionsLabel}>
          <Ellipsis aria-hidden="true" width={16} height={16} />
        </summary>
        <div role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={(event) => runAction(event, () => onExport("markdown"))}
          >
            {t("meetings.list.exportMarkdown", "Export notes (Markdown)")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(event) => runAction(event, () => onExport("json"))}
          >
            {t("meetings.list.exportJson", "Export notes (JSON)")}
          </button>
          {/* The ledger page is only offered where a ledger exists, which is
           * exactly the rows whose line two came from one. */}
          {headline.kind === "ledger" ? (
            <button
              type="button"
              role="menuitem"
              onClick={(event) => runAction(event, onExportLedger)}
            >
              {t("meetings.list.exportLedger", "Export ledger page")}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="danger-menu-item"
            onClick={(event) => runAction(event, onDelete)}
          >
            {t("meetings.actions.delete", "Delete")}
          </button>
        </div>
      </details>
    </li>
  );
};

export const MeetingsHome: React.FC<MeetingsHomeProps> = ({
  suggestions,
  recovery,
  meetings,
  loading,
  paging,
  hasMore,
  page,
  filter,
  retention,
  error,
  sources,
  starting,
  focusStart,
  onSourcesChange,
  onStart,
  onStartSuggestion,
  onStartEvent,
  onOpenMeeting,
  onFinalizeRecovery,
  onDiscardRecovery,
  onFilterChange,
  onNextPage,
  onPreviousPage,
  onExportMeeting,
  onExportLedger,
  onDeleteMeeting,
  onRetry,
}) => {
  const { t } = useTranslation();
  /* The text field holds what is being typed; the store holds what was asked
   * for. They are different facts, and the gap between them is the debounce:
   * a query per keystroke would reset the page position four times a word. */
  const [query, setQuery] = useState(filter.title_query ?? "");
  const committedQuery = filter.title_query ?? "";
  useEffect(() => {
    if (query.trim() === committedQuery) return;
    const timer = window.setTimeout(() => {
      onFilterChange({ ...filter, title_query: query.trim() });
    }, MEETING_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [committedQuery, filter, onFilterChange, query]);

  const unfiltered = isUnfilteredMeetingList(filter);

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

      <PreMeetingCountdownCard
        sources={sources}
        starting={starting}
        onSourcesChange={onSourcesChange}
        onStartEvent={onStartEvent}
      />

      <MeetingSuggestionPreviews
        suggestions={suggestions}
        sources={sources}
        starting={starting}
        onSourcesChange={onSourcesChange}
        onStartSuggestion={onStartSuggestion}
      />

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
                    {formatEntryTimestamp(meeting.created_at_utc_ms)}
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

      <Section title={t("meetings.history.title")} description={retentionHint}>
        {/* The bar states the whole query in mono, KEY then VALUE, because the
         * query is what decides which rows exist. Every control on it reaches
         * the store: there is no filter here the backend cannot honour. */}
        <div
          className="meeting-filter-bar"
          role="group"
          aria-label={t("meetings.list.filters.label", "Filter meetings")}
        >
          <Dropdown
            variant="filter"
            filterKey={t("meetings.list.filters.statusKey", "STATUS")}
            selectedValue={filter.status ?? "any"}
            options={MEETING_STATUS_FILTERS.map((status) => ({
              value: status,
              label: t(meetingStatusFilterKey(status)),
            }))}
            onSelect={(value) =>
              onFilterChange({
                ...filter,
                /* SAFETY: Dropdown echoes back one of the option values it was
                 * handed, and every option above is a MEETING_STATUS_FILTERS
                 * member. */
                status: value as MeetingStatusFilter,
              })
            }
          />
          <Dropdown
            variant="filter"
            filterKey={t("meetings.list.filters.timeKey", "TIME")}
            selectedValue={filter.window ?? "any"}
            options={MEETING_TIME_WINDOWS.map((window) => ({
              value: window,
              label: t(meetingTimeWindowKey(window)),
            }))}
            onSelect={(value) =>
              onFilterChange({
                ...filter,
                /* SAFETY: same contract as the status dropdown — the value is
                 * one of the MEETING_TIME_WINDOWS entries passed in above. */
                window: value as MeetingTimeWindow,
              })
            }
          />
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
            className="meeting-filter-search"
          />
          {unfiltered ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                onFilterChange(NO_MEETING_FILTER);
              }}
            >
              {t("meetings.list.clearFilters", "Clear filters")}
            </Button>
          )}
        </div>

        {loading ? (
          <MeetingListSkeleton label={t("meetings.history.loading")} />
        ) : meetings.length === 0 ? (
          /* Two different absences. An unfiltered empty list means this Mac has
           * recorded nothing; a filtered one means this query matched nothing,
           * and says so with the way out. */
          unfiltered ? (
            <EmptyState
              title={t("meetings.history.emptyTitle")}
              description={t("meetings.history.emptyDescription")}
            />
          ) : (
            <EmptyState
              variant="no-results"
              title={t("meetings.list.noMatchesFiltered", "No meetings match")}
              description={t(
                "meetings.list.noMatchesFilteredDescription",
                "No retained meeting matches this filter. The query runs against every meeting on disk, not just the page on screen.",
              )}
              action={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    onFilterChange(NO_MEETING_FILTER);
                  }}
                >
                  {t("meetings.list.clearFilters", "Clear filters")}
                </Button>
              }
            />
          )
        ) : (
          <ul
            className="meeting-entries"
            aria-label={t("meetings.history.title")}
          >
            {meetings.map((meeting) => (
              <MeetingRow
                key={meeting.session_id}
                meeting={meeting}
                onOpen={() => onOpenMeeting(meeting.session_id)}
                onExport={(format) =>
                  onExportMeeting(meeting.session_id, format)
                }
                onExportLedger={() => onExportLedger(meeting.session_id)}
                onDelete={() => onDeleteMeeting(meeting.session_id)}
              />
            ))}
          </ul>
        )}

        {/* Cursor paging knows what is behind it and whether anything is ahead.
         * It does not know a total, so this says "Page 3" and nothing more: a
         * "3 of 8" rail would be a number the store never returned. */}
        {loading || (page === 1 && !hasMore) ? null : (
          <div className="meeting-list-footer">
            <span className="microlabel">
              {t("meetings.list.pagePosition", "Page {{page}}", { page })}
            </span>
            <span className="meeting-list-pager">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onPreviousPage}
                disabled={page === 1 || paging}
              >
                {t("meetings.list.previousPage", "Newer")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onNextPage}
                disabled={!hasMore || paging}
              >
                {t("meetings.list.nextPage", "Older")}
              </Button>
            </span>
          </div>
        )}
      </Section>

      <MeetingTrackersSettings />
      <MeetingDetectionSettings />
    </div>
  );
};
