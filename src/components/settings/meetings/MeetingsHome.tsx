import React, { useEffect } from "react";
import { Ellipsis, FileAudio } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingRetentionPolicy, SourceKind } from "@/bindings";
import {
  Microlabel,
  Notice,
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/vg/dropdown-menu";
import { formatEntryTimestamp } from "@/lib/utils/format";
import { destinationIcons } from "@/lib/navIcons";
import { CaptureCompletenessText } from "./MeetingStatus";
import { MeetingSourceChip } from "./MeetingSourceChip";
import { MeetingSuggestionPreviews } from "./MeetingSuggestionPreviews";
import { PreMeetingCountdownCard } from "./PreMeetingCountdownCard";
import type {
  MeetingsHomeScreenActions,
  MeetingsHomeScreenModel,
} from "./meetingTypes";
import { MEETING_SOURCES } from "./meetingUtils";
import { MeetingsHistory } from "./home/MeetingsHistory";
import { MeetingsUpcoming } from "./home/MeetingsUpcoming";
import { MeetingsTrash } from "./home/MeetingsTrash";

const START_BUTTON_ID = "meeting-start-button";
const StartRecordingIcon = destinationIcons.overview;

interface MeetingStartCardProps {
  sources: SourceKind[];
  retention: MeetingRetentionPolicy | null;
  starting: boolean;
  importing: boolean;
  focusStart: boolean;
  onSourcesChange: (sources: SourceKind[]) => void;
  onStart: () => void;
  onImport: () => void;
  onOpenSettings?: () => void;
}

/* One press records a meeting. The sources it will use and how long the
 * recording is kept stay beside that press instead of becoming a setup
 * screen — and the retention line only states the policy, because the one
 * place it can be changed is Settings. */
const MeetingStartCard: React.FC<MeetingStartCardProps> = ({
  sources,
  retention,
  starting,
  importing,
  focusStart,
  onSourcesChange,
  onStart,
  onImport,
  onOpenSettings,
}) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!focusStart) return;
    document.getElementById(START_BUTTON_ID)?.focus();
  }, [focusStart]);

  const toggle = (source: SourceKind) => {
    onSourcesChange(
      sources.includes(source)
        ? sources.filter((candidate) => candidate !== source)
        : [...sources, source],
    );
  };

  return (
    <SettingsCard
      aria-label={t("meetings.start.label", "Start a meeting")}
      className="flex flex-col gap-4 px-6 py-5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button
          type="button"
          id={START_BUTTON_ID}
          onClick={onStart}
          disabled={starting || sources.length === 0}
        >
          <StartRecordingIcon aria-hidden="true" className="size-4" />
          {starting
            ? t("meetings.start.starting", "Starting…")
            : t("meetings.start.action", "Start recording")}
        </Button>
        {/* The other way a meeting begins: audio that was already recorded, or
         * a transcript another note-taker wrote. Beside the press that records
         * one, because it produces the same thing.
         *
         * `importing` is the import dialog standing open in front of this
         * button, not work in flight, so the label holds still: the dialog
         * itself reports what each file is doing. */}
        <Button
          type="button"
          variant="outline"
          onClick={onImport}
          disabled={importing}
          data-slot="meeting-import"
          data-testid="meeting-import"
        >
          <FileAudio aria-hidden="true" className="size-4" />
          {t("meetings.import.action")}
        </Button>
        {/* What the press will listen to, in the quietest register on the
         * card: these are two words with a tick, not a third and fourth
         * button. The group's name is its accessible label — printed, it was
         * a machinery word sitting where a person reads. */}
        <span
          role="group"
          aria-label={t("meetings.start.capture", "Capture")}
          className="ms-auto flex items-center gap-1"
        >
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
      {/* Two quiet lines, not two blocks: what the press does, then what
       * happens to what it records. */}
      <div className="flex flex-col gap-1">
        <Microlabel>
          {t(
            "meetings.start.assurance",
            "Records your Mac's audio locally. Nothing joins the call.",
          )}
        </Microlabel>
        {retention === null ? null : (
          <Microlabel>
            {t("meetings.start.localOnly", "Local only")}
            <span aria-hidden="true"> · </span>
            {retention.kind === "forever"
              ? t("meetingsV2.retention.keptForever")
              : t("meetingsV2.retention.keptDays", {
                  days: retention.days,
                })}
            {onOpenSettings === undefined ? null : (
              <>
                <span aria-hidden="true"> · </span>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="rounded-md text-accent-strong hover:underline"
                >
                  {t("meetingsV2.retention.change")}
                </button>
              </>
            )}
          </Microlabel>
        )}
      </div>
      {sources.length === 0 ? (
        <Notice tone="warning">
          {t("meetings.start.noSources", "Choose at least one source.")}
        </Notice>
      ) : null}
    </SettingsCard>
  );
};

type MeetingsHomeProps = MeetingsHomeScreenModel &
  MeetingsHomeScreenActions & {
    /** The shell's route setter, so the retention line can reach Settings. */
    onOpenSettings?: () => void;
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
  importing,
  focusStart,
  onSourcesChange,
  onStart,
  onImport,
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
  onOpenSettings,
}) => {
  const { t } = useTranslation();

  return (
    <SettingsPage title={t("meetings.title")}>
      <MeetingStartCard
        sources={sources}
        retention={retention}
        starting={starting}
        importing={importing}
        focusStart={focusStart}
        onSourcesChange={onSourcesChange}
        onStart={onStart}
        onImport={onImport}
        onOpenSettings={onOpenSettings}
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
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3.5"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-[14px] leading-[21px] font-medium text-gray-1000">
                    {meeting.title}
                  </span>
                  <Microlabel className="snap-measured tabular-nums">
                    {formatEntryTimestamp(meeting.created_at_utc_ms)}
                  </Microlabel>
                </span>
                <span className="flex flex-none items-center gap-2">
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
                  {/* Throwing the recording away is the other answer, and it
                   * is the one that cannot be taken back — so it waits behind
                   * the same glyph every other row in the app keeps its
                   * operations behind, rather than sitting in red beside the
                   * one that saves the meeting. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-gray-700 hover:text-gray-1000"
                        aria-label={t("meetings.list.rowActions")}
                        title={t("meetings.list.rowActions")}
                      >
                        <Ellipsis aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => onDiscardRecovery(meeting.session_id)}
                      >
                        {t("meetings.actions.discard")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : null}

      <MeetingsUpcoming sources={sources} />

      <MeetingsHistory
        meetings={meetings}
        loading={loading}
        paging={paging}
        hasMore={hasMore}
        page={page}
        filter={filter}
        error={error}
        onOpenMeeting={onOpenMeeting}
        onFilterChange={onFilterChange}
        onNextPage={onNextPage}
        onPreviousPage={onPreviousPage}
        onExportMeeting={onExportMeeting}
        onExportLedger={onExportLedger}
        onDeleteMeeting={onDeleteMeeting}
        /* The same owner the recovery section calls: one command reprocesses
         * an interrupted meeting, wherever it is offered. */
        onReprocessMeeting={onFinalizeRecovery}
        onRetry={onRetry}
      />

      <MeetingsTrash onRestored={onRetry} />
    </SettingsPage>
  );
};
