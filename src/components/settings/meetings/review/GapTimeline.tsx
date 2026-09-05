import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SourceGap } from "@/bindings";
import { Button } from "@/components/vg/button";
import { formatMeetingOffset } from "../meetingUtils";
import {
  aggregateSourceGaps,
  formatGapDuration,
  type AggregatedGap,
} from "./gapLedger";

/* Where the audio went missing, moment by moment.
 *
 * Rows under the capture sources rather than a section of their own: a source
 * that lost audio and the moments it lost are one fact, and the second box
 * used to say "No gaps detected" under a header that had already said the
 * recording was complete. Nothing at all when nothing was lost.
 *
 * The reason is the row: the wire's `invalid_format` reads as "Unreadable
 * audio", and the three severity glyphs that used to sit beside it said in a
 * shape what the words already said. */

const COLLAPSED_ROW_LIMIT = 8;

/** Meta: every measurement on the row, tabular where it is a number. */
const META = "text-[13px] leading-[18px] tabular-nums text-gray-900";

const GapRow: React.FC<{ gap: AggregatedGap }> = ({ gap }) => {
  const { t } = useTranslation();
  const hasKnownRange = gap.startOffsetNs !== null && gap.endOffsetNs !== null;
  const range = hasKnownRange
    ? gap.startOffsetNs === gap.endOffsetNs
      ? formatMeetingOffset(gap.startOffsetNs)
      : `${formatMeetingOffset(gap.startOffsetNs)} – ${formatMeetingOffset(gap.endOffsetNs)}`
    : t("meetings.review.timeUnknown");

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-6 py-3">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="text-[14px] leading-[21px] text-gray-1000">
          {t(`meetings.gaps.${gap.reason}`)}
        </span>
        {gap.count > 1 ? (
          <span className={META}>{`\u00D7${gap.count}`}</span>
        ) : null}
        <span className={META}>{range}</span>
      </span>
      <span className="flex flex-none flex-wrap justify-end gap-x-3 gap-y-0.5">
        {gap.durationNs === null ? null : (
          <span className={META}>
            {t("meetings.review.gapDuration", "{{duration}} missing", {
              duration: formatGapDuration(gap.durationNs),
            })}
          </span>
        )}
        {gap.droppedFrames === null ? null : (
          <span className={META}>
            {t("meetings.review.droppedFrames", "{{total}} frames dropped", {
              total: gap.droppedFrames,
            })}
          </span>
        )}
      </span>
    </li>
  );
};

export const GapRows: React.FC<{ gaps: SourceGap[] }> = ({ gaps }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const rows = aggregateSourceGaps(gaps);
  if (rows.length === 0) return null;

  const hiddenCount = Math.max(0, rows.length - COLLAPSED_ROW_LIMIT);
  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED_ROW_LIMIT);

  return (
    <>
      <ul
        id="meeting-gap-timeline"
        role="list"
        aria-label={t("meetings.review.timeline")}
        className="divide-y divide-gray-alpha-400"
      >
        {visibleRows.map((gap) => (
          <GapRow key={gap.key} gap={gap} />
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <div className="px-4 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-controls="meeting-gap-timeline"
            onClick={() => setExpanded((current) => !current)}
            className="font-normal text-gray-900"
          >
            {expanded
              ? t("meetings.review.showFewerGaps", "Show fewer")
              : t("meetings.review.showMoreGaps", "Show {{count}} more", {
                  count: hiddenCount,
                })}
          </Button>
        </div>
      ) : null}
    </>
  );
};
