import React, { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleX,
  Info,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SourceGap, SourceGapReason } from "@/bindings";
import { SettingsSection } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { formatMeetingOffset } from "../meetingUtils";
import {
  aggregateSourceGaps,
  formatGapDuration,
  type AggregatedGap,
} from "./gapLedger";

const COLLAPSED_ROW_LIMIT = 8;
const MONO_FACT = "font-mono text-[11px] tabular-nums text-gray-700";

type GapSeverity = "info" | "warning" | "error";

const severityForReason = (reason: SourceGapReason): GapSeverity => {
  switch (reason) {
    case "paused":
    case "source_stopped":
    case "system_sleep":
      return "info";
    case "packet_dropped":
    case "writer_pressure":
    case "timestamp_missing":
    case "timestamp_discontinuity":
    case "invalid_format":
    case "recovery_tail":
      return "warning";
    case "source_unavailable":
    case "source_start_failed":
    case "permission_lost":
    case "storage_failure":
    case "corrupt_record":
    case "missing_record":
      return "error";
  }
};

const GapSeverityIcon: React.FC<{ severity: GapSeverity }> = ({ severity }) => {
  const className = "mt-0.5 size-3.5 flex-none text-gray-800";
  if (severity === "error") {
    return <CircleX aria-hidden="true" className={className} />;
  }
  if (severity === "warning") {
    return <TriangleAlert aria-hidden="true" className={className} />;
  }
  return <Info aria-hidden="true" className={className} />;
};

const GapRow: React.FC<{ gap: AggregatedGap }> = ({ gap }) => {
  const { t } = useTranslation();
  const hasKnownRange = gap.startOffsetNs !== null && gap.endOffsetNs !== null;
  const range = hasKnownRange
    ? gap.startOffsetNs === gap.endOffsetNs
      ? formatMeetingOffset(gap.startOffsetNs)
      : `${formatMeetingOffset(gap.startOffsetNs)} – ${formatMeetingOffset(gap.endOffsetNs)}`
    : t("meetings.review.timeUnknown");

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 px-4 py-2.5">
      <span className="flex min-w-0 items-start gap-2">
        <GapSeverityIcon severity={severityForReason(gap.reason)} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="text-[13px] leading-5 text-gray-1000">
              {t(`meetings.gaps.${gap.reason}`)}
            </span>
            {gap.count > 1 ? (
              <span className={MONO_FACT}>×{gap.count}</span>
            ) : null}
          </span>
          <span className={MONO_FACT}>{range}</span>
        </span>
      </span>
      <span className="flex flex-none flex-wrap justify-end gap-x-3 gap-y-0.5">
        {gap.durationNs === null ? null : (
          <span className={MONO_FACT}>
            {t("meetings.review.gapDuration", "Duration: {{duration}}", {
              duration: formatGapDuration(gap.durationNs),
            })}
          </span>
        )}
        {gap.droppedFrames === null ? null : (
          <span className={MONO_FACT}>
            {t("meetings.review.droppedFrames", "Dropped frames: {{total}}", {
              total: gap.droppedFrames,
            })}
          </span>
        )}
      </span>
    </li>
  );
};

export const GapTimeline: React.FC<{ gaps: SourceGap[] }> = ({ gaps }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const rows = aggregateSourceGaps(gaps);
  const hiddenCount = Math.max(0, rows.length - COLLAPSED_ROW_LIMIT);
  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED_ROW_LIMIT);

  return (
    <SettingsSection label={t("meetings.review.timeline")}>
      {rows.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 text-[13px] leading-5 text-gray-800">
          <CheckCircle2 aria-hidden="true" className="size-3.5 flex-none" />
          <span>{t("meetings.review.noGaps")}</span>
        </div>
      ) : (
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
            <div className="border-t border-gray-alpha-400 px-3 py-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                aria-controls="meeting-gap-timeline"
                onClick={() => setExpanded((current) => !current)}
                className="text-gray-900"
              >
                {expanded ? (
                  <ChevronUp aria-hidden="true" className="size-3.5" />
                ) : (
                  <ChevronDown aria-hidden="true" className="size-3.5" />
                )}
                {expanded
                  ? t("meetings.review.showFewerGaps", "Show fewer")
                  : t("meetings.review.showMoreGaps", "Show {{count}} more", {
                      count: hiddenCount,
                    })}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </SettingsSection>
  );
};
