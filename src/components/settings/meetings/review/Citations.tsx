import React from "react";
import { useTranslation } from "react-i18next";
import type {
  CitedArtifactText,
  MeetingCitation,
  SummaryLineTrace,
} from "@/bindings";
import { cn } from "@/lib/cn";
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

/**
 * The one shape a timestamp jump has anywhere in Sona: a footnote mark.
 * Exported so a transcript row, a loop, or a person's ledger sets the same
 * object instead of a second style that drifts away from this one.
 */
export const CITATION_MARK =
  "inline-flex h-[18px] items-center rounded-[5px] border border-gray-alpha-300 px-1 text-[12px] leading-none tabular-nums whitespace-nowrap text-gray-900 transition-colors hover:border-gray-alpha-500 hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none";

/** The same mark with nothing to press: no border, no hover. */
const CITATION_MARK_PLAIN =
  "inline-flex h-[18px] items-center px-1 text-[12px] leading-none tabular-nums whitespace-nowrap text-gray-900";

/**
 * Marks belonging to one sentence: inline, after its last word, on the same
 * line. They used to be a flex row under the text, which printed the word
 * "Transcript" above and below every sentence on the page.
 */
const MARKS_ROW = "ms-1 inline-flex items-center gap-1 align-[0.05em]";

/** A document's opening paragraph — the summary, and nothing else. */
const LEDE_TEXT = "text-[16px] leading-[25px] text-pretty text-gray-1000";

/** Everything else a generated artifact says. */
const BODY_TEXT = "text-[14px] leading-[21px] text-pretty text-gray-1000";

/* A citation is a footnote: the time it points at, small, at the end of the
 * sentence it supports. The word "Transcript" is what it does, not what it
 * is, so it moves to the accessible name and the tooltip — fifteen marks on
 * one page said it fifteen times. It degrades to the same mark without a
 * border and without a button when it points at a manual note or the title,
 * which have no transcript row to scroll to. */
export const CitationJump: React.FC<CitationJumpProps> = ({
  startOffsetNs,
  segmentId,
  onJump,
}) => {
  const { t } = useTranslation();
  const time = formatMeetingOffset(startOffsetNs);
  const label = t("meetings.review.citation", { time });

  if (segmentId === null) {
    return (
      <span className={CITATION_MARK_PLAIN} title={label}>
        {time}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onJump(segmentId)}
      aria-label={label}
      title={label}
      className={CITATION_MARK}
    >
      {time}
    </button>
  );
};

interface CitedTextProps {
  value: CitedArtifactText;
  onJump: (segmentId: string) => void;
  /** The type this text is set in. Body unless the document asks for the
   * lede or a topic's title. */
  className?: string;
}

export const CitedText: React.FC<CitedTextProps> = ({
  value,
  onJump,
  className,
}) => (
  <p className={cn(BODY_TEXT, className)}>
    {value.text}
    {value.citations.length === 0 ? null : (
      <span className={MARKS_ROW}>
        {value.citations.map((citation) => (
          <CitationJump
            key={citation.segment_id}
            startOffsetNs={citation.start_offset_ns}
            segmentId={citation.segment_id}
            onJump={onJump}
          />
        ))}
      </span>
    )}
  </p>
);

interface TracedSummaryProps {
  summary: CitedArtifactText;
  trace: SummaryLineTrace[] | null | undefined;
  onJump: (segmentId: string) => void;
}

/* The Granola move: a summary line is itself the way back to the moment it
 * came from. Quiet by default — the line reads as the sentence it is, and only
 * hover, focus, and the mark at its end say it is pressable — so the summary
 * stays a summary and does not turn into a wall of links. The mark sits after
 * the last word; it used to float against the right edge of the card, where it
 * belonged to no sentence at all. A summary with no line provenance renders as
 * one paragraph, marks and all. */
export const TracedSummary: React.FC<TracedSummaryProps> = ({
  summary,
  trace,
  onJump,
}) => {
  const { t } = useTranslation();
  const lines = summaryLines(summary, trace);

  if (lines === null) {
    return <CitedText value={summary} onJump={onJump} className={LEDE_TEXT} />;
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
              className={LEDE_TEXT}
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
              className={cn(
                LEDE_TEXT,
                "group -mx-1.5 block cursor-pointer rounded-md px-1.5 text-start transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
              )}
            >
              {line.text}
              <span
                className={cn(
                  CITATION_MARK,
                  "ms-1 align-[0.05em] group-hover:border-gray-alpha-500 group-hover:text-gray-1000",
                )}
              >
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

/** The marks for a generated answer, set the same way a sentence's are. */
export const AnswerCitations: React.FC<AnswerCitationsProps> = ({
  citations,
  onJump,
}) => (
  <span className={MARKS_ROW}>
    {citations.map((citation) => (
      <CitationJump
        key={`${citation.kind}:${citation.entity_id}`}
        startOffsetNs={citation.start_offset_ns}
        segmentId={citation.kind === "transcript" ? citation.entity_id : null}
        onJump={onJump}
      />
    ))}
  </span>
);
