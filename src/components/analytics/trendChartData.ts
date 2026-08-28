import type { DashboardTrendRange } from "@/bindings";

const SIX_MONTH_BUCKET_DAYS = 7;

export interface TrendDatum {
  date: string;
  label: string;
  value: number;
}

interface DatedValue {
  local_date: string;
}

export interface MetricDelta {
  kind: "change" | "new" | "flat" | "unavailable";
  percent?: number;
}

export const compareTrendHalves = (values: readonly number[]): MetricDelta => {
  if (values.length < 2) return { kind: "unavailable" };

  const midpoint = Math.floor(values.length / 2);
  let previous = 0;
  let current = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (index < midpoint) previous += values[index] ?? 0;
    else current += values[index] ?? 0;
  }

  if (previous === 0) {
    return current === 0 ? { kind: "flat" } : { kind: "new" };
  }

  return {
    kind: "change",
    percent: Math.round(((current - previous) / previous) * 100),
  };
};

export const bucketTrendPoints = <Point extends DatedValue>(
  points: readonly Point[],
  range: DashboardTrendRange,
  valueFor: (point: Point) => number,
  locale: string,
): TrendDatum[] => {
  const bucketSize = range === "days_180" ? SIX_MONTH_BUCKET_DAYS : 1;
  const formatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const buckets: TrendDatum[] = [];

  for (let index = 0; index < points.length; index += bucketSize) {
    const slice = points.slice(index, index + bucketSize);
    const first = slice[0];
    const last = slice[slice.length - 1];
    if (!first || !last) continue;

    let value = 0;
    for (const point of slice) value += valueFor(point);

    const firstLabel = formatter.format(
      new Date(`${first.local_date}T12:00:00`),
    );
    const lastLabel = formatter.format(new Date(`${last.local_date}T12:00:00`));
    buckets.push({
      date: first.local_date,
      label: first === last ? firstLabel : `${firstLabel}–${lastLabel}`,
      value,
    });
  }

  return buckets;
};

export interface TrendMetricItem {
  id: string;
  label: string;
  value: string;
  detail: string;
  disabled?: boolean;
}
