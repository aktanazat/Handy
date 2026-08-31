import React from "react";
import { Ellipsis, Mic, MonitorSpeaker } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingExportFormat, MeetingHistorySummary } from "@/bindings";
import { Microlabel } from "@/components/settings/rows";
import { formatDurationShort, formatEntryTimestamp } from "@/lib/utils/format";
import { CaptureCompletenessText } from "../MeetingStatus";
import { MeetingStatusChip } from "./MeetingStatusChip";
import { SpeakerBubbles } from "./SpeakerBubbles";

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
  const actionsLabel = t("meetings.list.rowActions", "Meeting actions");
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
      className="flex items-start gap-2 rounded-card border border-gray-alpha-400 bg-background-100 px-5 py-4 transition-colors hover:bg-background-200"
    >
      <button
        type="button"
        onClick={onOpen}
        className="-m-1 flex min-w-0 flex-1 flex-col gap-2 rounded-md p-1 text-start focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
        title={
          headline.kind === "ledger" || headline.kind === "summary"
            ? `${meeting.title} — ${headline.text}`
            : meeting.title
        }
      >
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="truncate text-[14px] leading-5 font-medium text-gray-1000">
            {meeting.title}
          </span>
          <MeetingStatusChip
            phase={meeting.phase}
            processing={meeting.processing_status}
          />
        </span>

        {headline.kind === "none" ? null : (
          <span className="w-full truncate text-[13px] leading-[18px] text-gray-900">
            {headline.kind === "words"
              ? t(
                  "meetings.list.headline.words",
                  "{{count}} words transcribed",
                  { count: headline.words },
                )
              : headline.text}
          </span>
        )}

        <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <SpeakerBubbles speakers={speakers} />
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
        </span>
      </button>

      <details className="group relative -mt-1 -me-1 flex-none">
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
