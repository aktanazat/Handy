import React from "react";
import { useTranslation } from "react-i18next";
import type { ArtifactCitation } from "@/bindings";
import { formatMeetingOffset } from "../meetingUtils";
import { CitationJump } from "./Citations";

/* The receipt, verbatim, and the way back to where it was said.
 *
 * Shared by the ledger's thread table and its actionable loop rows: an
 * inferred state is only worth reading next to the quote it was read from, so
 * there is one way to show that quote rather than one per register. */

export interface LedgerReceiptRowProps {
  /** Absent for a question that was cited but never quoted. */
  quote: string | null;
  speaker: string | null;
  atMs: number;
  citations: ArtifactCitation[];
  onJumpToSegment: (segmentId: string) => void;
}

export const LedgerReceiptRow: React.FC<LedgerReceiptRowProps> = ({
  quote,
  speaker,
  atMs,
  citations,
  onJumpToSegment,
}) => {
  const { t } = useTranslation();
  const attribution = [speaker, formatMeetingOffset(atMs * 1_000_000)]
    .filter((part): part is string => Boolean(part))
    .join(", ");

  return (
    <div className="flex flex-col gap-1">
      {quote === null ? null : (
        <blockquote className="border-s border-gray-alpha-400 ps-2.5 text-[13px] leading-5 text-pretty text-gray-900">
          {`\u201C${quote}\u201D`}
        </blockquote>
      )}
      {/* The attribution names who said it and when; the jumps go there. They
       * sit on one line, so the citation control keeps its own gap instead of
       * the negative inline start a left-aligned citation row wants. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 ps-2.5">
        <span className="text-[11px] text-gray-700">
          {attribution || t("meetings.ledger.unattributed")}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {citations.map((citation) => (
            <CitationJump
              key={citation.segment_id}
              startOffsetNs={citation.start_offset_ns}
              segmentId={citation.segment_id}
              onJump={onJumpToSegment}
            />
          ))}
        </span>
      </div>
    </div>
  );
};
