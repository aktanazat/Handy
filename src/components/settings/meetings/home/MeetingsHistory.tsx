import React from "react";
import { useTranslation } from "react-i18next";
import type {
  MeetingExportFormat,
  MeetingHistorySummary,
  MeetingListFilter,
} from "@/bindings";
import { Microlabel, Notice } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Skeleton } from "@/components/vg/skeleton";
import { destinationIcons } from "@/lib/navIcons";
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
  onRetry: () => void;
}

const MeetingListSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div role="status" aria-label={label} className="flex flex-col gap-3">
    {[0, 1, 2].map((row) => (
      <div
        key={row}
        className="rounded-card border border-gray-alpha-400 bg-background-100 px-5 py-4"
      >
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </div>
    ))}
  </div>
);

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
  onRetry,
}) => {
  const { t } = useTranslation();
  const unfiltered = isUnfilteredMeetingList(filter);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-6 items-center">
        <h2>
          <Microlabel>{t("meetings.history.title")}</Microlabel>
        </h2>
      </div>

      <MeetingsFilterBar filter={filter} onFilterChange={onFilterChange} />

      {error ? (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-gray-alpha-400 bg-background-100 px-4 py-3">
          <Notice tone="danger">{error}</Notice>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("meetings.actions.retry")}
          </Button>
        </div>
      ) : null}

      <div data-slot="meeting-list-region" className="flex flex-col gap-3">
        {loading ? (
          <MeetingListSkeleton label={t("meetings.history.loading")} />
        ) : meetings.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-card border border-gray-alpha-400 bg-background-100 px-4 py-12 text-center">
            <MeetingsEmptyIcon
              aria-hidden="true"
              className="size-6 text-gray-700"
            />
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
            className="flex flex-col gap-3"
          >
            {meetings.map((meeting) => (
              <MeetingCard
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
