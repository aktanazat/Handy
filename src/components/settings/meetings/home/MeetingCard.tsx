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
import { formatDurationShort } from "@/lib/utils/format";
import { formatTimeOfDay } from "@/lib/utils/localDay";
import { MeetingStatusChip, meetingCardStatus } from "./MeetingStatusChip";

/* Every row that can be acted on keeps its actions behind this one trigger:
 * a quiet glyph at the end of the row, the same menu on the meetings list and
 * on a person's meetings. */
const RowActionsMenu: React.FC<{
  label: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, className, children }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("text-gray-700 hover:text-gray-1000", className)}
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
        <span className="truncate text-[14px] leading-5 font-medium text-gray-1000">
          {title}
        </span>
        {titleAside}
      </span>
      {headline === null ? null : (
        <span className="w-full truncate text-[13px] leading-[18px] text-gray-900">
          {headline}
        </span>
      )}
      {footerLeading === undefined && metadata.length === 0 ? null : (
        <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {footerLeading}
          {metadata.length === 0 ? null : (
            <span
              data-slot="meeting-facts"
              className="ms-auto flex flex-none items-center text-[11px] text-gray-900 tabular-nums"
            >
              {metadata.map((fact, index) => (
                <React.Fragment key={index}>
                  {index === 0 ? null : (
                    <span aria-hidden="true" className="px-1.5 text-gray-700">
                      /
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
    "flex min-w-0 flex-1 flex-col gap-2 text-start",
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
}

/* One meeting inside its day group: what it was called, how long it ran, and
 * the time of day it started. The heading above the group already carries the
 * date, and a finished meeting says nothing further about itself — the status
 * chip appears only while a meeting is live, still processing, or waiting on
 * the reader. The summary line the row used to print lives on the meeting
 * itself, one click away, and stays here as the row's hover title. */
export const MeetingCard: React.FC<MeetingCardProps> = ({
  meeting,
  onOpen,
  onExport,
  onExportLedger,
  onDelete,
}) => {
  const { t } = useTranslation();
  const headline = meeting.headline ?? { kind: "none" };
  const recordedMs = meeting.recorded_duration_ms ?? null;
  const status = meetingCardStatus(meeting.phase, meeting.processing_status);
  const openTitle =
    headline.kind === "ledger" || headline.kind === "summary"
      ? `${meeting.title} — ${headline.text}`
      : meeting.title;

  return (
    <li
      data-slot="meeting-entry"
      data-headline={headline.kind}
      className="flex items-center gap-1 pe-2"
    >
      <button
        type="button"
        onClick={onOpen}
        title={openTitle}
        className="hover-fast flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-start hover:bg-background-200 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] leading-[19px] text-gray-1000">
          {meeting.title}
        </span>
        {status === "ready" ? null : (
          <MeetingStatusChip
            phase={meeting.phase}
            processing={meeting.processing_status}
          />
        )}
        {recordedMs === null ? null : (
          <span className="snap-measured flex-none text-[11px] text-gray-800 tabular-nums">
            {formatDurationShort(recordedMs / 1000)}
          </span>
        )}
        <span className="snap-measured w-[52px] flex-none text-end text-[11px] text-gray-800 tabular-nums">
          {formatTimeOfDay(meeting.created_at_utc_ms)}
        </span>
      </button>

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
