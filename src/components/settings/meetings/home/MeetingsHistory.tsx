import React from "react";
import { useTranslation } from "react-i18next";
import type {
  MeetingExportFormat,
  MeetingHistorySummary,
  MeetingListFilter,
} from "@/bindings";
import {
  Microlabel,
  Notice,
  SETTINGS_SURFACE,
  SettingsCard,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Skeleton } from "@/components/vg/skeleton";
import { destinationIcons } from "@/lib/navIcons";
import { groupByLocalDay, localDayHeading } from "@/lib/utils/localDay";
import { isUnfilteredMeetingList } from "../meetingUtils";
import { MeetingCard } from "./MeetingCard";
import { MeetingsFilterBar } from "./MeetingsFilterBar";
import { MeetingsPager } from "./MeetingsPager";

const MeetingsEmptyIcon = destinationIcons.meetings;

interface MeetingsHistoryProps {
  meetings: MeetingHistorySummary[];
  loading: boolean;
  paging: boolean;
  hasMore: boolean;
  page: number;
  filter: MeetingListFilter;
  error: string | null;
  onOpenMeeting: (sessionId: string) => void;
  onFilterChange: (filter: MeetingListFilter) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onExportMeeting: (sessionId: string, format: MeetingExportFormat) => void;
  onExportLedger: (sessionId: string) => void;
  onDeleteMeeting: (sessionId: string) => void;
  /** Reprocess one meeting an interrupted launch left behind. Not `onRetry`,
   *  which retries the failed read of the list itself. */
  onReprocessMeeting: (sessionId: string) => void;
  onRetry: () => void;
}

/* The wait, in the shape the rows will take: one surface, calm lines, no
 * card-per-meeting stack to collapse when the page lands. */
const MeetingListSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div role="status" aria-label={label} className={SETTINGS_SURFACE}>
    {[0, 1, 2].map((row) => (
      <div key={row} className="flex items-center gap-3 px-4 py-2.5">
        <Skeleton className="h-3.5 flex-1" />
        <Skeleton className="h-3 w-10" />
      </div>
    ))}
  </div>
);

/**
 * Meetings as a quiet log, read by day: a heading names the day, and each row
 * under it says what the meeting was called, how long it ran, and when it
 * started. It is the same grammar the dictation log is written in, down to the
 * day formatter both surfaces share.
 */
export const MeetingsHistory: React.FC<MeetingsHistoryProps> = ({
  meetings,
  loading,
  paging,
  hasMore,
  page,
  filter,
  error,
  onOpenMeeting,
  onFilterChange,
  onNextPage,
  onPreviousPage,
  onExportMeeting,
  onExportLedger,
  onDeleteMeeting,
  onReprocessMeeting,
  onRetry,
}) => {
  const { t } = useTranslation();
  const unfiltered = isUnfilteredMeetingList(filter);
  const days = groupByLocalDay(
    meetings,
    (meeting) => meeting.created_at_utc_ms,
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-6 items-center">
        <h2>
          <Microlabel>{t("meetings.history.title")}</Microlabel>
        </h2>
      </div>

      <MeetingsFilterBar filter={filter} onFilterChange={onFilterChange} />

      {error ? (
        <SettingsCard className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Notice tone="danger">{error}</Notice>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("meetings.actions.retry")}
          </Button>
        </SettingsCard>
      ) : null}

      <div data-slot="meeting-list-region" className="flex flex-col gap-6">
        {loading ? (
          <MeetingListSkeleton label={t("meetings.history.loading")} />
        ) : meetings.length === 0 ? (
          <SettingsCard className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <MeetingsEmptyIcon
              aria-hidden="true"
              className="size-6 text-gray-700"
            />
            <p className="text-[13px] text-gray-1000">
              {unfiltered
                ? t("meetings.history.emptyTitle")
                : t("meetings.list.noMatchesFiltered")}
            </p>
            {unfiltered ? null : (
              <p className="max-w-[52ch] text-[13px] leading-5 text-gray-800">
                {t("meetings.list.noMatchesFilteredDescription")}
              </p>
            )}
          </SettingsCard>
        ) : (
          days.map((day) => {
            const heading = localDayHeading(day.startOfDayMs, t);
            return (
              <section
                key={day.startOfDayMs}
                data-slot="meeting-day"
                className="flex flex-col gap-3"
              >
                <div className="flex min-h-6 items-center">
                  <h3 className="text-[13px] leading-5 text-gray-900">
                    {heading}
                  </h3>
                </div>
                <ul
                  role="list"
                  aria-label={heading}
                  className={SETTINGS_SURFACE}
                >
                  {day.items.map((meeting) => (
                    <MeetingCard
                      key={meeting.session_id}
                      meeting={meeting}
                      onOpen={() => onOpenMeeting(meeting.session_id)}
                      onExport={(format) =>
                        onExportMeeting(meeting.session_id, format)
                      }
                      onExportLedger={() => onExportLedger(meeting.session_id)}
                      onDelete={() => onDeleteMeeting(meeting.session_id)}
                      onRetry={() => onReprocessMeeting(meeting.session_id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })
        )}

        <MeetingsPager
          loading={loading}
          paging={paging}
          hasMore={hasMore}
          page={page}
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
        />
      </div>
    </section>
  );
};
