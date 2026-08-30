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
  FactChip,
  Microlabel,
  Notice,
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Skeleton } from "@/components/vg/skeleton";
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
  <div
    role="status"
    aria-label={label}
    className="divide-y divide-gray-alpha-400"
  >
    {[0, 1, 2].map((row) => (
      <div key={row} className="flex items-center gap-4 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-3 w-20" />
      </div>
    ))}
  </div>
);

interface MeetingStartCardProps {
  sources: SourceKind[];
  retention: MeetingRetentionPolicy | null;
  starting: boolean;
  focusStart: boolean;
  onSourcesChange: (sources: SourceKind[]) => void;
  onStart: () => void;
}

/* One press records a meeting. Everything else on this card is a state the
 * press will use, shown inline and changeable in place: never a step, never a
 * screen. One instrument row — the press, what it captures, where it stays —
 * with the assurance sentence directly beneath the button as its caption,
 * because what the press does to the room must be readable before the press,
 * and pressing it is the acknowledgment the backend records.
 *
 * That sentence is on the page, not behind an affordance: a keyboard or touch
 * operator who never hovers must still have read it before pressing, since the
 * press is what the consent row asserts they read. It is also the surface's
 * one sentence of prose — every other fact here is set in mono. */
const MeetingStartCard: React.FC<MeetingStartCardProps> = ({
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
    <SettingsCard
      aria-label={t("meetings.start.label", "Start a meeting")}
      className="flex flex-col gap-3 p-4"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button
          type="button"
          id={START_BUTTON_ID}
          onClick={onStart}
          disabled={starting || sources.length === 0}
        >
          {starting
            ? t("meetings.start.starting", "Starting…")
            : t("meetings.start.action", "Start recording")}
        </Button>
        <span
          role="group"
          aria-label={t("meetings.start.capture", "Capture")}
          className="flex items-center gap-2"
        >
          <Microlabel>{t("meetings.start.capture", "Capture")}</Microlabel>
          {MEETING_SOURCES.map((source) => (
            <MeetingSourceChip
              key={source}
              source={source}
              selected={sources.includes(source)}
              disabled={starting}
              onToggle={() => toggle(source)}
            />
          ))}
        </span>
      </div>
      {/* The caption line: what the press does to the room on the left, what it
       * does with the result on the right. The facts sit beside the sentence
       * they qualify rather than orphaned on a rail of their own. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-[13px] leading-5 text-gray-800">
          {t(
            "meetings.start.assurance",
            "Records your Mac's audio locally. Nothing joins the call.",
          )}
        </p>
        <span className="flex flex-none items-baseline gap-4">
          <Microlabel>{t("meetings.start.localOnly", "Local only")}</Microlabel>
          {retention === null ? null : (
            <FactChip
              label={t("meetings.retention.title")}
              value={
                retention.kind === "forever"
                  ? t("meetings.retention.forever")
                  : t("meetings.retention.days", { days: retention.days })
              }
            />
          )}
        </span>
      </div>
      {sources.length === 0 ? (
        <Notice tone="warning">
          {t("meetings.start.noSources", "Choose at least one source.")}
        </Notice>
      ) : null}
    </SettingsCard>
  );
};

interface FilterSelectProps {
  /** The mono KEY the trigger states before its value. */
  filterKey: string;
  value: string;
  /** The selected option's label, stated on the trigger. */
  selected: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
}

/* One filter, stated as KEY then VALUE.
 *
 * `SelectValue` is handed its children rather than left to resolve them from
 * the item collection: the selected value is the whole point of the control,
 * and Radix cannot name it until that collection has mounted. */
const FilterSelect: React.FC<FilterSelectProps> = ({
  filterKey,
  value,
  selected,
  options,
  onSelect,
}) => (
  <Select value={value} onValueChange={onSelect}>
    <SelectTrigger size="sm" aria-label={filterKey} className="gap-2">
      <Microlabel>{filterKey}</Microlabel>
      <SelectValue>{selected}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

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
 * Line 3 is measurement, so line 3 is mono. Nothing here is rounded up: no
 * recorded duration prints no duration, not "0s"; no speakers prints no
 * speaker line, not "Unknown". */
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
    <li
      data-slot="meeting-entry"
      data-headline={headline.kind}
      className="flex items-start gap-1 px-2 py-1"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-md px-2 py-2 text-start transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
        title={
          headline.kind === "ledger" || headline.kind === "summary"
            ? `${meeting.title} — ${headline.text}`
            : meeting.title
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] text-gray-1000">
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
        <span className="min-h-[18px] w-full truncate text-[13px] leading-[18px] text-gray-900">
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
        <span className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1">
          {speakers.length === 0 ? null : (
            <span className="flex min-w-0 flex-wrap items-baseline gap-1">
              {speakers.map((speaker, index) => (
                <span
                  key={`${speaker}:${index}`}
                  data-slot="meeting-person"
                  className="truncate rounded-md border border-gray-alpha-400 px-1.5 text-[12px] leading-[18px] text-gray-900"
                >
                  {speaker}
                </span>
              ))}
            </span>
          )}
          {/* Measured facts in the machine's own face. The glyph run is a label
           * and stays uppercase; a duration and a date are values, so they
           * drop the microlabel's caps — an all-caps timestamp shouts and is
           * slower to scan than the thing it is labelling. */}
          <span
            data-slot="meeting-facts"
            className="ms-auto flex flex-none flex-wrap items-baseline gap-x-3"
          >
            {sources.length === 0 ? null : (
              <Microlabel>
                {sources
                  .map((source) =>
                    source === "microphone"
                      ? t("meetings.list.sourceGlyph.microphone", "MIC")
                      : t("meetings.list.sourceGlyph.system_audio", "SYS"),
                  )
                  .join(" ")}
              </Microlabel>
            )}
            {meeting.capture_completeness === "partial" ? (
              <CaptureCompletenessText completeness="partial" />
            ) : null}
            {recordedMs === null ? null : (
              <Microlabel className="normal-case tabular-nums text-gray-800">
                {formatDurationShort(recordedMs / 1000)}
              </Microlabel>
            )}
            <Microlabel className="normal-case tabular-nums text-gray-800">
              {formatEntryTimestamp(meeting.created_at_utc_ms)}
            </Microlabel>
          </span>
        </span>
      </button>
      {/* Everything that leaves the page or destroys the meeting sits behind
       * one summary, so a list of thirty rows carries thirty controls rather
       * than a hundred and twenty. A `<details>` is the whole menu: thirty
       * portalled popovers would cost the list more than the disclosure it
       * replaces. */}
      <details className="group relative flex-none">
        <summary
          aria-label={actionsLabel}
          title={actionsLabel}
          className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md text-gray-700 transition-colors hover:bg-gray-alpha-100 hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
        >
          <Ellipsis aria-hidden="true" className="size-4" />
        </summary>
        <div
          role="menu"
          className="absolute end-0 top-9 z-10 hidden min-w-52 flex-col gap-0.5 rounded-card border border-gray-alpha-400 bg-raised p-1 shadow-md group-open:flex"
        >
          <button
            type="button"
            role="menuitem"
            onClick={(event) => runAction(event, () => onExport("markdown"))}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-start text-[13px] text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
          >
            {t("meetings.list.exportMarkdown", "Export notes (Markdown)")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(event) => runAction(event, () => onExport("json"))}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-start text-[13px] text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
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
              className="flex w-full items-center rounded-md px-2 py-1.5 text-start text-[13px] text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
            >
              {t("meetings.list.exportLedger", "Export ledger page")}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={(event) => runAction(event, onDelete)}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-start text-[13px] text-red-900 hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
          >
            {t("meetings.actions.delete", "Delete meeting")}
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
  const clearFilters = () => {
    setQuery("");
    onFilterChange(NO_MEETING_FILTER);
  };

  return (
    <SettingsPage title={t("meetings.title")}>
      {error ? (
        <div className="flex flex-wrap items-center gap-3">
          <Notice tone="danger">{error}</Notice>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("meetings.actions.retry")}
          </Button>
        </div>
      ) : null}

      <MeetingStartCard
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
        <SettingsSection label={t("meetings.recovery.title")}>
          <ul
            aria-label={t("meetings.recovery.title")}
            className="divide-y divide-gray-alpha-400"
          >
            {recovery.map((meeting) => (
              <li
                key={meeting.session_id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] text-gray-1000">
                    {meeting.title}
                  </span>
                  <Microlabel className="normal-case tabular-nums text-gray-800">
                    {formatEntryTimestamp(meeting.created_at_utc_ms)}
                  </Microlabel>
                </span>
                <span className="flex flex-none items-center gap-2">
                  {/* "Recover partial meetings", "Partial", "Finalize partial"
                   * was the same word three times, so the chip only speaks
                   * when it disagrees with the heading. */}
                  {meeting.capture_completeness === "partial" ? null : (
                    <CaptureCompletenessText
                      completeness={meeting.capture_completeness}
                    />
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onFinalizeRecovery(meeting.session_id)}
                  >
                    {t("meetings.recovery.finalize")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-900"
                    onClick={() => onDiscardRecovery(meeting.session_id)}
                  >
                    {t("meetings.actions.discard")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : null}

      <SettingsSection label={t("meetings.history.title")}>
        {/* The bar states the whole query in mono, KEY then VALUE, because the
         * query is what decides which rows exist. Every control on it reaches
         * the store: there is no filter here the backend cannot honour. */}
        <div
          role="group"
          aria-label={t("meetings.list.filters.label", "Filter meetings")}
          className="flex flex-wrap items-center gap-2 px-4 py-3"
        >
          <FilterSelect
            filterKey={t("meetings.list.filters.statusKey", "Status")}
            value={filter.status ?? "any"}
            selected={t(meetingStatusFilterKey(filter.status ?? "any"))}
            options={MEETING_STATUS_FILTERS.map((status) => ({
              value: status,
              label: t(meetingStatusFilterKey(status)),
            }))}
            onSelect={(value) =>
              onFilterChange({
                ...filter,
                /* SAFETY: the select echoes back one of the option values it
                 * was handed, and every option above is a
                 * MEETING_STATUS_FILTERS member. */
                status: value as MeetingStatusFilter,
              })
            }
          />
          <FilterSelect
            filterKey={t("meetings.list.filters.timeKey", "Time")}
            value={filter.window ?? "any"}
            selected={t(meetingTimeWindowKey(filter.window ?? "any"))}
            options={MEETING_TIME_WINDOWS.map((window) => ({
              value: window,
              label: t(meetingTimeWindowKey(window)),
            }))}
            onSelect={(value) =>
              onFilterChange({
                ...filter,
                /* SAFETY: same contract as the status select — the value is
                 * one of the MEETING_TIME_WINDOWS entries passed in above. */
                window: value as MeetingTimeWindow,
              })
            }
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("meetings.list.searchLabel", "Search meetings")}
            placeholder={t(
              "meetings.list.searchPlaceholder",
              "Search by title",
            )}
            className="h-8 min-w-40 flex-1 text-[13px]"
          />
          {unfiltered ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearFilters}
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
           * and says the one thing about the query a reader cannot infer — that
           * it ran against the disk, not the page. Neither offers a second
           * Clear: the bar above already carries it. */
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <p className="text-[13px] text-gray-1000">
              {unfiltered
                ? t("meetings.history.emptyTitle")
                : t("meetings.list.noMatchesFiltered", "No meetings match")}
            </p>
            {unfiltered ? null : (
              <p className="max-w-[52ch] text-[13px] leading-5 text-gray-800">
                {t(
                  "meetings.list.noMatchesFilteredDescription",
                  "No retained meeting matches this filter. The query runs against every meeting on disk, not just the page on screen.",
                )}
              </p>
            )}
          </div>
        ) : (
          <ul
            aria-label={t("meetings.history.title")}
            className="divide-y divide-gray-alpha-400"
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
          <div className="flex items-center justify-between gap-4 px-4 py-2.5">
            <Microlabel className="tabular-nums">
              {t("meetings.list.pagePosition", "Page {{page}}", { page })}
            </Microlabel>
            <span className="flex flex-none items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPreviousPage}
                disabled={page === 1 || paging}
              >
                {t("meetings.list.previousPage", "Newer")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onNextPage}
                disabled={!hasMore || paging}
              >
                {t("meetings.list.nextPage", "Older")}
              </Button>
            </span>
          </div>
        )}
      </SettingsSection>

      <MeetingTrackersSettings />
      <MeetingDetectionSettings />
    </SettingsPage>
  );
};
