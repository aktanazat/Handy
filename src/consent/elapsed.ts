import { formatClock } from "@/components/settings/meetings/meetingUtils";

/**
 * The recording pill's clock: how long this capture has been running.
 *
 * A start that is missing, zero, or in the future is not a start this pill can
 * count from, so it reads 0:00 rather than measuring from the epoch — which is
 * how a stale fixture put "534032:50" in front of a reader.
 */
export const elapsedLabel = (
  startedAtUtcMs: number | null | undefined,
  nowMs: number,
): string => {
  if (
    startedAtUtcMs === null ||
    startedAtUtcMs === undefined ||
    startedAtUtcMs === 0
  ) {
    return formatClock(0);
  }

  return formatClock((nowMs - startedAtUtcMs) / 1_000);
};
