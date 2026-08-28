import type {
  HistorySourceKind,
  HistoryStats,
  HistoryTrendProjection,
  HistoryTrendTotals,
  MeetingTrendProjection,
} from "@/bindings";

/* Pure derivations for the Overview analytics band.
 *
 * The band renders only fields the backend actually returns. Range figures
 * (recordings, words, duration, streak, per-day points) come from the history
 * trend projection; all-time figures come from the history stats aggregate.
 * Nothing here invents a metric the payload does not carry. */

/** One rendered column of the activity band. */
export interface ActivityDay {
  localDate: string;
  dictations: number;
  meetings: number;
}

/** One source subtotal, ordered for the "where these came from" line. */
export interface SourceShare {
  kind: HistorySourceKind | null;
  recordings: number;
}

/** What the meeting projection can say. Storage failures report no data at
 * all, which is different from a range with zero meetings. */
export interface MeetingSummary {
  available: boolean;
  rangeMeetings: number;
  allTimeMeetings: number;
  rangeActionItems: number;
}

export const buildActivityDays = (
  history: HistoryTrendProjection | null,
  meetings: MeetingTrendProjection | null,
): ActivityDay[] => {
  if (history === null) return [];

  const meetingsByDate = new Map<string, number>();
  if (meetings !== null && meetings.status === "available") {
    for (const point of meetings.points) {
      meetingsByDate.set(point.local_date, point.meetings);
    }
  }

  return history.points.map((point) => ({
    localDate: point.local_date,
    dictations: point.recordings,
    meetings: meetingsByDate.get(point.local_date) ?? 0,
  }));
};

/** Busiest day in the range, floored at 1 so an all-zero range still has a
 * usable bar scale. */
export const peakDictations = (days: ActivityDay[]): number => {
  let peak = 0;
  for (const day of days) {
    if (day.dictations > peak) peak = day.dictations;
  }
  return Math.max(1, peak);
};

export const totalDictations = (days: ActivityDay[]): number => {
  let total = 0;
  for (const day of days) {
    total += day.dictations;
  }
  return total;
};

/** Sources that actually contributed, largest first. Zero-valued subtotals
 * are dropped: an empty share is not a source. */
export const buildSourceShares = (
  totals: HistoryTrendTotals | null,
): SourceShare[] => {
  if (totals === null) return [];
  return totals.by_source
    .filter((entry) => entry.recordings > 0)
    .map((entry) => ({ kind: entry.source_kind, recordings: entry.recordings }))
    .sort((left, right) => right.recordings - left.recordings);
};

export const summarizeMeetings = (
  trend: MeetingTrendProjection | null,
): MeetingSummary => {
  if (trend === null || trend.status === "unavailable") {
    return {
      available: false,
      rangeMeetings: 0,
      allTimeMeetings: 0,
      rangeActionItems: 0,
    };
  }
  return {
    available: true,
    rangeMeetings: trend.range_total.meetings,
    allTimeMeetings: trend.all_time.meetings,
    rangeActionItems: trend.range_total.generated_action_items,
  };
};

/** True only when the install has nothing to show yet, which is a different
 * screen from "this range was quiet". */
export const isFreshInstall = (
  stats: HistoryStats | null,
  meetings: MeetingSummary,
  recentActivityCount: number,
): boolean =>
  stats !== null &&
  stats.entries === 0 &&
  meetings.allTimeMeetings === 0 &&
  recentActivityCount === 0;

export const formatCount = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 100_000 ? 1 : 0,
  }).format(value);

/** Speaking time at the coarsest honest unit: seconds below a minute,
 * minutes up to an hour and a half, hours after that. */
export const formatDurationCompact = (
  durationMs: number,
  locale: string,
): string => {
  const safeMs = durationMs > 0 ? durationMs : 0;
  const minutes = safeMs / 60_000;

  if (minutes < 1) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "second",
      unitDisplay: "short",
      maximumFractionDigits: 0,
    }).format(Math.round(safeMs / 1_000));
  }

  if (minutes < 90) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "minute",
      unitDisplay: "short",
      maximumFractionDigits: 0,
    }).format(Math.round(minutes));
  }

  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "hour",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(minutes / 60);
};

/** "2026-08-28" is a local calendar date, not an instant: parsing it through
 * Date.parse would shift it by the UTC offset. */
export const formatDayLabel = (localDate: string, locale: string): string => {
  const parts = localDate.split("-");
  if (parts.length !== 3) return localDate;

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return localDate;
  }

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return localDate;

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(date);
};
