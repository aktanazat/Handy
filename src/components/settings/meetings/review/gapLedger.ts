import type { SourceGap, SourceGapReason } from "@/bindings";
import { formatMeetingOffset } from "../meetingUtils";

export interface AggregatedGap {
  key: string;
  trackId: string;
  epoch: number;
  reason: SourceGapReason;
  count: number;
  startOffsetNs: number | null;
  endOffsetNs: number | null;
  durationNs: number | null;
  droppedFrames: number | null;
}

const measuredDuration = (gap: SourceGap) => {
  if (gap.start_offset_ns === null || gap.end_offset_ns === null) return null;
  return Math.max(0, gap.end_offset_ns - gap.start_offset_ns);
};

export const aggregateSourceGaps = (gaps: SourceGap[]): AggregatedGap[] => {
  const aggregated: AggregatedGap[] = [];

  for (const gap of gaps) {
    const previous = aggregated[aggregated.length - 1];
    const sameRun =
      previous !== undefined &&
      previous.trackId === gap.track_id &&
      previous.epoch === gap.epoch &&
      previous.reason === gap.reason;
    if (!sameRun) {
      aggregated.push({
        key: `${gap.track_id}:${gap.epoch}:${gap.reason}:${aggregated.length}`,
        trackId: gap.track_id,
        epoch: gap.epoch,
        reason: gap.reason,
        count: 1,
        startOffsetNs: gap.start_offset_ns,
        endOffsetNs: gap.end_offset_ns,
        durationNs: measuredDuration(gap),
        droppedFrames: gap.dropped_frames,
      });
      continue;
    }

    previous.count += 1;
    if (previous.endOffsetNs !== null && gap.end_offset_ns !== null) {
      previous.endOffsetNs = gap.end_offset_ns;
    } else {
      previous.startOffsetNs = null;
      previous.endOffsetNs = null;
    }
    const durationNs = measuredDuration(gap);
    previous.durationNs =
      previous.durationNs === null || durationNs === null
        ? null
        : previous.durationNs + durationNs;
    previous.droppedFrames =
      previous.droppedFrames === null || gap.dropped_frames === null
        ? null
        : previous.droppedFrames + gap.dropped_frames;
  }

  return aggregated;
};

export const formatGapDuration = (durationNs: number) => {
  if (durationNs < 1_000_000_000) {
    const milliseconds = Math.round(durationNs / 1_000_000);
    return `${durationNs === 0 ? 0 : Math.max(1, milliseconds)}ms`;
  }
  if (durationNs < 60_000_000_000) {
    const seconds = durationNs / 1_000_000_000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }
  return formatMeetingOffset(durationNs);
};
