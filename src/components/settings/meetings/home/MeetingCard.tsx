import React from "react";
import { Ellipsis, Mic, MonitorSpeaker } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingExportFormat, MeetingHistorySummary } from "@/bindings";
import { Microlabel } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/vg/dropdown-menu";
import { cn } from "@/lib/cn";
import { formatDurationShort, formatEntryTimestamp } from "@/lib/utils/format";
import { CaptureCompletenessText } from "../MeetingStatus";
import { MeetingStatusChip } from "./MeetingStatusChip";
import { SpeakerBubbles } from "./SpeakerBubbles";

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
              className="ms-auto flex flex-none items-center font-mono text-[11px] text-gray-900 tabular-nums"
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-mt-1 -me-1 text-gray-700 hover:text-gray-1000"
            aria-label={actionsLabel}
            title={actionsLabel}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {actions}
        </DropdownMenuContent>
      </DropdownMenu>
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

export const MeetingCard: React.FC<MeetingCardProps> = ({
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
  const metadata: React.ReactNode[] = [];

  if (sources.length > 0) {
    metadata.push(
      <Microlabel
        key="sources"
        className="inline-flex items-center gap-2 text-gray-900"
      >
        {sources.map((source) => {
          const SourceIcon = source === "microphone" ? Mic : MonitorSpeaker;
          return (
            <span key={source} className="inline-flex items-center gap-1">
              <SourceIcon aria-hidden="true" className="size-3" />
              {source === "microphone"
                ? t("meetings.list.sourceGlyph.microphone", "MIC")
                : t("meetings.list.sourceGlyph.system_audio", "SYS")}
            </span>
          );
        })}
      </Microlabel>,
    );
  }
  if (meeting.capture_completeness === "partial") {
    metadata.push(
      <CaptureCompletenessText
        key="completeness"
        completeness="partial"
        className="font-mono text-[11px] uppercase tracking-[0.08em]"
      />,
    );
  }
  if (recordedMs !== null) {
    metadata.push(
      <span key="duration">{formatDurationShort(recordedMs / 1000)}</span>,
    );
  }
  metadata.push(
    <span key="timestamp">
      {formatEntryTimestamp(meeting.created_at_utc_ms)}
    </span>,
  );

  const headlineContent =
    headline.kind === "none"
      ? null
      : headline.kind === "words"
        ? t("meetings.list.headline.words", "{{count}} words transcribed", {
            count: headline.words,
          })
        : headline.text;
  const openTitle =
    headline.kind === "ledger" || headline.kind === "summary"
      ? `${meeting.title} — ${headline.text}`
      : meeting.title;

  return (
    <MeetingSummaryRow
      data-slot="meeting-entry"
      data-headline={headline.kind}
      className="rounded-card border border-gray-alpha-400 bg-background-100 px-5 py-4 transition-colors hover:bg-background-200"
      contentClassName="-m-1 rounded-md p-1 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
      title={meeting.title}
      headline={headlineContent}
      titleAside={
        <MeetingStatusChip
          phase={meeting.phase}
          processing={meeting.processing_status}
        />
      }
      footerLeading={<SpeakerBubbles speakers={speakers} />}
      metadata={metadata}
      actionsLabel={t("meetings.list.rowActions", "Meeting actions")}
      onOpen={onOpen}
      openTitle={openTitle}
      actions={
        <>
          <DropdownMenuItem onSelect={() => onExport("markdown")}>
            {t("meetings.list.exportMarkdown", "Export notes (Markdown)")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onExport("json")}>
            {t("meetings.list.exportJson", "Export notes (JSON)")}
          </DropdownMenuItem>
          {headline.kind === "ledger" ? (
            <DropdownMenuItem onSelect={onExportLedger}>
              {t("meetings.list.exportLedger", "Export ledger page")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            {t("meetings.actions.delete", "Delete meeting")}
          </DropdownMenuItem>
        </>
      }
    />
  );
};
