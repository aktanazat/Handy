import { describe, expect, test } from "bun:test";
import type {
  HistoryStats,
  HistoryTrendProjection,
  MeetingTrendProjection,
} from "@/bindings";
import {
  buildActivityDays,
  buildSourceShares,
  formatDayLabel,
  isFreshInstall,
  peakDictations,
  summarizeMeetings,
  totalDictations,
} from "./analytics";

const trend: HistoryTrendProjection = {
  range: "days_30",
  range_start_local_date: "2026-07-30",
  range_end_local_date: "2026-08-01",
  all_time: {
    recordings: 96,
    duration_ms: 5_400_000,
    words: 18_240,
    by_source: [],
  },
  range_total: {
    recordings: 5,
    duration_ms: 600_000,
    words: 1_240,
    by_source: [
      { source_kind: "file", recordings: 1, duration_ms: 60_000, words: 200 },
      {
        source_kind: "microphone",
        recordings: 4,
        duration_ms: 540_000,
        words: 1_040,
      },
      { source_kind: null, recordings: 0, duration_ms: 0, words: 0 },
    ],
  },
  active_days: 2,
  current_streak_days: 1,
  points: [
    {
      local_date: "2026-07-30",
      recordings: 3,
      duration_ms: 300_000,
      words: 700,
      by_source: [],
    },
    {
      local_date: "2026-07-31",
      recordings: 0,
      duration_ms: 0,
      words: 0,
      by_source: [],
    },
    {
      local_date: "2026-08-01",
      recordings: 2,
      duration_ms: 300_000,
      words: 540,
      by_source: [],
    },
  ],
};

const meetingTrend: MeetingTrendProjection = {
  status: "available",
  range: "days_30",
  range_start_local_date: "2026-07-30",
  range_end_local_date: "2026-08-01",
  all_time: {
    meetings: 7,
    verified_captured_duration_ms: 9_000_000,
    transcript_segments: 400,
    generated_action_items: 21,
  },
  range_total: {
    meetings: 2,
    verified_captured_duration_ms: 3_600_000,
    transcript_segments: 120,
    generated_action_items: 4,
  },
  points: [
    {
      local_date: "2026-07-31",
      meetings: 2,
      verified_captured_duration_ms: 3_600_000,
      transcript_segments: 120,
      generated_action_items: 4,
    },
  ],
};

describe("buildActivityDays", () => {
  test("keeps one column per history point and joins meetings by date", () => {
    expect(buildActivityDays(trend, meetingTrend)).toEqual([
      { localDate: "2026-07-30", dictations: 3, meetings: 0 },
      { localDate: "2026-07-31", dictations: 0, meetings: 2 },
      { localDate: "2026-08-01", dictations: 2, meetings: 0 },
    ]);
  });

  test("reports no columns without a history projection", () => {
    expect(buildActivityDays(null, meetingTrend)).toEqual([]);
  });

  test("leaves meetings at zero when meeting storage is unavailable", () => {
    const days = buildActivityDays(trend, {
      status: "unavailable",
      range: "days_30",
    });
    expect(days.map((day) => day.meetings)).toEqual([0, 0, 0]);
  });
});

describe("chart scale", () => {
  test("peak is the busiest day, floored at one so zero ranges still scale", () => {
    expect(peakDictations(buildActivityDays(trend, null))).toBe(3);
    expect(peakDictations([])).toBe(1);
    expect(
      peakDictations([{ localDate: "2026-08-01", dictations: 0, meetings: 0 }]),
    ).toBe(1);
  });

  test("total counts every column", () => {
    expect(totalDictations(buildActivityDays(trend, null))).toBe(5);
  });
});

describe("buildSourceShares", () => {
  test("drops empty subtotals and orders by volume", () => {
    expect(buildSourceShares(trend.range_total)).toEqual([
      { kind: "microphone", recordings: 4 },
      { kind: "file", recordings: 1 },
    ]);
  });

  test("has nothing to say without totals", () => {
    expect(buildSourceShares(null)).toEqual([]);
  });
});

describe("summarizeMeetings", () => {
  test("reads range and all-time counts from an available projection", () => {
    expect(summarizeMeetings(meetingTrend)).toEqual({
      available: true,
      rangeMeetings: 2,
      allTimeMeetings: 7,
      rangeActionItems: 4,
    });
  });

  test("unavailable storage is not a zero-valued range", () => {
    const summary = summarizeMeetings({
      status: "unavailable",
      range: "days_30",
    });
    expect(summary.available).toBe(false);
    expect(summarizeMeetings(null).available).toBe(false);
  });
});

describe("isFreshInstall", () => {
  const emptyStats: HistoryStats = {
    entries: 0,
    total_duration_ms: 0,
    total_words: 0,
    by_source: [],
  };
  const unavailable = summarizeMeetings(null);
  const available = summarizeMeetings(meetingTrend);

  test("true only when history, meetings and recents are all empty", () => {
    expect(isFreshInstall(emptyStats, unavailable, 0)).toBe(true);
    expect(isFreshInstall(emptyStats, available, 0)).toBe(false);
    expect(isFreshInstall(emptyStats, unavailable, 3)).toBe(false);
    expect(isFreshInstall({ ...emptyStats, entries: 1 }, unavailable, 0)).toBe(
      false,
    );
  });

  test("a failed stats read is never a fresh install", () => {
    expect(isFreshInstall(null, unavailable, 0)).toBe(false);
  });
});

/* Speaking time is rendered by formatDurationShort now, whose own tests live
 * with it in src/lib/utils. Directive §3: one duration renderer, one owner. */

describe("formatDayLabel", () => {
  test("reads a local calendar date without shifting it", () => {
    expect(formatDayLabel("2026-08-01", "en")).toBe("Aug 1");
  });

  test("returns unparseable input unchanged", () => {
    expect(formatDayLabel("not-a-date", "en")).toBe("not-a-date");
    expect(formatDayLabel("2026-08", "en")).toBe("2026-08");
  });
});
