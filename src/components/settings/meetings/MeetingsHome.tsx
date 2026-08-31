import React, { useEffect } from "react";
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

const START_BUTTON_ID = "meeting-start-button";
const StartRecordingIcon = destinationIcons.overview;

interface MeetingStartCardProps {
  sources: SourceKind[];
  retention: MeetingRetentionPolicy | null;
  starting: boolean;
  focusStart: boolean;
  onSourcesChange: (sources: SourceKind[]) => void;
  onStart: () => void;
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
  focusStart,
  onSourcesChange,
  onStart,
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
      className="flex flex-col gap-3 p-4"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
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
            <span className="text-[13px] leading-5 text-gray-800">
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
                    className="rounded-md text-blue-900 hover:underline focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
                  >
                    {t("meetingsV2.retention.change")}
                  </button>
                </>
              )}
            </span>
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
  onOpenSettings,
}) => {
  const { t } = useTranslation();

  return (
    <SettingsPage title={t("meetings.title")}>
      <MeetingStartCard
        sources={sources}
        retention={retention}
        starting={starting}
        focusStart={focusStart}
        onSourcesChange={onSourcesChange}
        onStart={onStart}
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
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] text-gray-1000">
                    {meeting.title}
                  </span>
                  <Microlabel className="normal-case text-gray-800 tabular-nums">
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
        onRetry={onRetry}
      />
    </SettingsPage>
  );
};
