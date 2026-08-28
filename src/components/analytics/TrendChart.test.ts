import { describe, expect, test } from "bun:test";
import { bucketTrendPoints, compareTrendHalves } from "./trendChartData";

const point = (local_date: string, value: number) => ({
  local_date,
  recordings: value,
  duration_ms: 0,
  words: 0,
  by_source: [],
});

describe("compareTrendHalves", () => {
  test("reports growth when the second half is larger", () => {
    const delta = compareTrendHalves([1, 2, 3, 4, 5, 6]);
    expect(delta.kind).toBe("change");
    expect(delta.percent).toBe(150);
  });

  test("reports decline when the second half is smaller", () => {
    const delta = compareTrendHalves([6, 5, 4, 3, 2, 1]);
    expect(delta.kind).toBe("change");
    expect(delta.percent).toBe(-60);
  });

  test("reports flat for equal halves", () => {
    expect(compareTrendHalves([2, 2, 2, 2])).toEqual({
      kind: "change",
      percent: 0,
    });
  });

  test("reports flat when both halves are empty", () => {
    expect(compareTrendHalves([0, 0, 0, 0]).kind).toBe("flat");
  });

  test("reports new when the baseline half is empty", () => {
    expect(compareTrendHalves([0, 0, 4, 5]).kind).toBe("new");
  });

  test("reports unavailable when there is no second half", () => {
    expect(compareTrendHalves([1]).kind).toBe("unavailable");
    expect(compareTrendHalves([]).kind).toBe("unavailable");
  });
});

describe("bucketTrendPoints", () => {
  const byRecordings = (p: { recordings: number }) => p.recordings;

  test("keeps daily granularity for a 7-day range", () => {
    const points = ["2026-08-21", "2026-08-22", "2026-08-27"].map((d, i) =>
      point(d, i + 1),
    );
    const buckets = bucketTrendPoints(points, "days_7", byRecordings, "en");
    expect(buckets.length).toBe(3);
    expect(buckets[0].value).toBe(1);
    expect(buckets[1].value).toBe(2);
    expect(buckets[2].value).toBe(3);
  });

  test("sums values inside a 30-day bucket", () => {
    const points = Array.from({ length: 30 }, (_, i) =>
      point(`2026-07-${String(i + 1).padStart(2, "0")}`, 1),
    );
    const buckets = bucketTrendPoints(points, "days_30", byRecordings, "en");
    expect(buckets.length).toBe(30);
    expect(buckets.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(30);
  });

  test("sums values inside a 180-day bucket", () => {
    const points = Array.from({ length: 180 }, (_, i) =>
      point(
        `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
        2,
      ),
    );
    const buckets = bucketTrendPoints(points, "days_180", byRecordings, "en");
    expect(buckets.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(360);
  });

  test("returns an empty array for empty input", () => {
    expect(bucketTrendPoints([], "days_30", byRecordings, "en")).toEqual([]);
  });
});
