import React from "react";
import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingExportFormat, MeetingHistorySummary } from "@/bindings";
import { Button } from "@/components/vg/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/vg/dropdown-menu";
import { cn } from "@/lib/cn";
import { formatDurationShort, formatRelativeTime } from "@/lib/utils/format";
import { formatTimeOfDay } from "@/lib/utils/localDay";
import { processingStatusKey } from "../meetingUtils";
import { MeetingStatusChip, meetingCardStatus } from "./MeetingStatusChip";

/* Every row that can be acted on keeps its actions behind this one outlined
 * glyph at the end of the row, the same menu on the meetings list and on a
 * person's meetings. */
const RowActionsMenu: React.FC<{
  label: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, className, children }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className={cn("text-gray-900 hover:text-gray-1000", className)}
        aria-label={label}
        title={label}
      >
        <Ellipsis aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-52">
      {children}
    </DropdownMenuContent>
  </DropdownMenu>
);

interface MeetingSummaryRowProps
  extends Omit<React.ComponentProps<"li">, "children" | "title"> {
  title: string;
  headline: React.ReactNode | null;
  titleAside?: React.ReactNode;
  footerLeading?: React.ReactNode;
  metadata?: React.ReactNode[];
  actionsLabel: string;
  actions: React.ReactNode;
  onOpen?: () => void;
  openTitle?: string;
  contentClassName?: string;
}

export const MeetingSummaryRow: React.FC<MeetingSummaryRowProps> = ({
  title,
  headline,
  titleAside,
  footerLeading,
  metadata = [],
  actionsLabel,
  actions,
  onOpen,
  openTitle,
  className,
  contentClassName,
  ...props
}) => {
  const content = (
    <>
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="truncate text-[14px] leading-[21px] font-medium text-gray-1000">
          {title}
        </span>
        {titleAside}
      </span>
      {headline === null ? null : (
        <span className="w-full truncate text-[14px] leading-[21px] text-gray-900">
          {headline}
        </span>
      )}
      {footerLeading === undefined && metadata.length === 0 ? null : (
        <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {footerLeading}
          {metadata.length === 0 ? null : (
            <span
              data-slot="meeting-facts"
              className="snap-measured ms-auto flex flex-none items-center text-[13px] leading-[18px] text-gray-900 tabular-nums"
            >
              {metadata.map((fact, index) => (
                <React.Fragment key={index}>
                  {index === 0 ? null : (
                    <span aria-hidden="true" className="px-1.5 text-gray-700">
                      ·
                    </span>
                  )}
                  {fact}
                </React.Fragment>
              ))}
            </span>
          )}
        </span>
      )}
    </>
  );
  const contentClass = cn(
    "flex min-w-0 flex-1 flex-col gap-1 text-start",
    contentClassName,
  );

  return (
    <li className={cn("flex items-start gap-2", className)} {...props}>
      {onOpen === undefined ? (
        <div className={contentClass}>{content}</div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className={contentClass}
          title={openTitle}
        >
          {content}
        </button>
      )}

      <RowActionsMenu label={actionsLabel} className="-mt-1 -me-1">
        {actions}
      </RowActionsMenu>
    </li>
  );
};

interface MeetingCardProps {
  meeting: MeetingHistorySummary;
  onOpen: () => void;
  onExport: (format: MeetingExportFormat) => void;
  onExportLedger: () => void;
  onDelete: () => void;
  /** Reprocess a meeting an interrupted launch left behind. */
  onRetry: () => void;
}

/* One meeting inside its day group: what it was called, how long it ran, and
 * the time of day it started. The heading above the group already carries the
 * date, and a finished meeting says nothing further about itself — the status
 * chip appears only while a meeting is live, still processing, or waiting on
 * the reader. The summary line the row used to print lives on the meeting
 * itself, one click away, and stays here as the row's hover title.
 *
 * A meeting that ended badly says why on its own line, because "Needs
 * attention" is a state and not an explanation. Retry appears only where it
 * can actually run — a meeting parked in recovery — and stays enabled while it
 * runs: a second press is refused by the phase it already left, so there is no
 * pressed-state bookkeeping here to disagree with the store. */
export const MeetingCard: React.FC<MeetingCardProps> = ({
  meeting,
  onOpen,
  onExport,
  onExportLedger,
  onDelete,
  onRetry,
}) => {
  const { t } = useTranslation();
  const headline = meeting.headline ?? { kind: "none" };
  const recordedMs = meeting.recorded_duration_ms ?? null;
  const status = meetingCardStatus(meeting.phase, meeting.processing_status);
  const openTitle =
    headline.kind === "ledger" || headline.kind === "summary"
      ? `${meeting.title} — ${headline.text}`
      : meeting.title;
  /* One line under the title, in the order a person asks: when, how long, who
   * was in it. Each part appears only when the meeting reported it, so a
   * capture with nothing to report says the time and stops rather than
   * printing a zero and an empty list. */
  const speakers = meeting.speaker_labels ?? [];
  const measured = [
    formatTimeOfDay(meeting.created_at_utc_ms),
    recordedMs === null ? null : formatDurationShort(recordedMs / 1000),
    speakers.length === 0 ? null : speakers.join(", "),
  ]
    .filter((fact): fact is string => fact !== null)
    .join(" · ");

  return (
    <li
      data-slot="meeting-entry"
      data-headline={headline.kind}
      className="flex items-center gap-1 pe-4"
    >
      <button
        type="button"
        onClick={onOpen}
        title={openTitle}
        className="hover-fast flex min-w-0 flex-1 items-start gap-4 px-6 py-3.5 text-start hover:bg-background-200"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[14px] leading-[21px] font-medium text-gray-1000">
            {meeting.title}
          </span>
          <span className="flex min-w-0 items-baseline gap-2 text-[13px] leading-[18px] text-gray-900">
            <span className="snap-measured truncate tabular-nums">
              {measured}
            </span>
            {status === "ready" ? null : (
              <MeetingStatusChip
                phase={meeting.phase}
                processing={meeting.processing_status}
              />
            )}
            {/* The state word carries the colour; its explanation is ordinary
             * type beside it, because two red phrases on one line read as one
             * long alarm rather than a state and its reason. */}
            {status === "needs_attention" ? (
              <span className="truncate">
                {t(processingStatusKey(meeting.processing_status))}
              </span>
            ) : null}
          </span>
        </span>
        {/* How long ago, on the title's line at the row's end. The day
         * heading above the group says which day and the line below the title
         * says the clock time; neither answers "recent or not" at a glance,
         * which is what somebody scanning a log of meetings is asking. */}
        <span className="snap-measured flex-none text-end text-[13px] leading-[21px] text-gray-900 tabular-nums">
          {formatRelativeTime(meeting.created_at_utc_ms)}
        </span>
      </button>

      {meeting.phase === "recovery_required" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-none"
          onClick={onRetry}
        >
          {t("meetings.actions.retry")}
        </Button>
      ) : null}

      <RowActionsMenu label={t("meetings.list.rowActions")}>
        <DropdownMenuItem onSelect={() => onExport("markdown")}>
          {t("meetings.list.exportMarkdown")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onExport("json")}>
          {t("meetings.list.exportJson")}
        </DropdownMenuItem>
        {headline.kind === "ledger" ? (
          <DropdownMenuItem onSelect={onExportLedger}>
            {t("meetings.list.exportLedger")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          {t("meetings.actions.delete")}
        </DropdownMenuItem>
      </RowActionsMenu>
    </li>
  );
};
