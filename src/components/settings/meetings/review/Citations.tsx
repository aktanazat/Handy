import React from "react";
import { useTranslation } from "react-i18next";
import type {
  CitedArtifactText,
  MeetingCitation,
  SummaryLineTrace,
} from "@/bindings";
import { formatMeetingOffset } from "../meetingUtils";
import { summaryLines } from "./summaryTrace";

export interface SegmentJump {
  segmentId: string;
  /** Bumped on every jump so repeating the same citation scrolls again. */
  nonce: number;
}

export interface CitationJumpProps {
  startOffsetNs: number | null;
  segmentId: string | null;
  onJump: (segmentId: string) => void;
}

/* A citation is a jump, so it looks like the thing that jumps: the accent
 * colour with a tabular timestamp. It degrades to plain text when it points
 * at a manual note or the title, which have no transcript
 * row to scroll to. */
export const CitationJump: React.FC<CitationJumpProps> = ({
  startOffsetNs,
  segmentId,
  onJump,
}) => {
  const { t } = useTranslation();
  const label = t("meetings.review.citation", {
    time: formatMeetingOffset(startOffsetNs),
  });

  if (segmentId === null) {
    return (
      <span className="px-1.5 py-0.5 text-[11px] tabular-nums text-gray-700">
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onJump(segmentId)}
      className="rounded-md px-1.5 py-0.5 text-[11px] tabular-nums text-blue-900 transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
    >
      {label}
    </button>
  );
};

interface CitedTextProps {
  value: CitedArtifactText;
  onJump: (segmentId: string) => void;
}

export const CitedText: React.FC<CitedTextProps> = ({ value, onJump }) => (
  <div className="flex flex-col gap-1">
    <p className="text-[13px] leading-5 text-pretty text-gray-1000">
      {value.text}
    </p>
    {value.citations.length > 0 ? (
      <div className="-ms-1.5 flex flex-wrap items-center gap-1">
        {value.citations.map((citation) => (
          <CitationJump
            key={citation.segment_id}
            startOffsetNs={citation.start_offset_ns}
            segmentId={citation.segment_id}
            onJump={onJump}
          />
        ))}
      </div>
    ) : null}
  </div>
);

interface TracedSummaryProps {
  summary: CitedArtifactText;
  trace: SummaryLineTrace[] | null | undefined;
  onJump: (segmentId: string) => void;
}

/* The Granola move: a summary line is itself the way back to the moment it
 * came from. Quiet by default — the line reads as the sentence it is, and only
 * hover, focus, and its timestamp say it is pressable — so the summary stays a
 * summary and does not turn into a wall of links. A summary with no line
 * provenance renders exactly as it did before, chips and all. */
export const TracedSummary: React.FC<TracedSummaryProps> = ({
  summary,
  trace,
  onJump,
}) => {
  const { t } = useTranslation();
  const lines = summaryLines(summary, trace);

  if (lines === null) {
    return <CitedText value={summary} onJump={onJump} />;
  }

  return (
    <ul role="list" className="flex flex-col gap-1">
      {lines.map((line, index) => {
        const segmentId = line.segmentId;
        if (segmentId === null) {
          return (
            <li
              key={`line:${index}`}
              data-slot="summary-line"
              className="px-1.5 text-[13px] leading-5 text-pretty text-gray-1000"
            >
              {line.text}
            </li>
          );
        }
        const time = formatMeetingOffset(line.startOffsetNs);
        const label = t("meetings.transcript.trace.jumpLine", { time });
        return (
          <li key={`line:${index}`} data-slot="summary-line">
            <button
              type="button"
              data-slot="summary-line-jump"
              onClick={() => onJump(segmentId)}
              title={t("meetings.transcript.trace.tooltip")}
              aria-label={label}
              className="group -ms-1.5 flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-md px-1.5 text-start transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
            >
              <span className="text-[13px] leading-5 text-pretty text-gray-1000">
                {line.text}
              </span>
              <span className="flex-none text-[11px] tabular-nums text-gray-700 group-hover:text-blue-900">
                {time}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

interface AnswerCitationsProps {
  citations: MeetingCitation[];
  onJump: (segmentId: string) => void;
}

export const AnswerCitations: React.FC<AnswerCitationsProps> = ({
  citations,
  onJump,
}) => (
  <div className="-ms-1.5 flex flex-wrap items-center gap-1">
    {citations.map((citation) => (
      <CitationJump
        key={`${citation.kind}:${citation.entity_id}`}
        startOffsetNs={citation.start_offset_ns}
        segmentId={citation.kind === "transcript" ? citation.entity_id : null}
        onJump={onJump}
      />
    ))}
  </div>
);
