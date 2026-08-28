import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type {
  HistoryStats,
  HistoryTrendProjection,
  MeetingTrendProjection,
} from "@/bindings";
import { OverviewAnalytics } from "./OverviewAnalytics";

/* Renders the band against the real English bundle, so new keys resolve
 * through their inline defaults exactly as they do in the app before the
 * locale harvest. The point of these assertions is that every number on the
 * screen comes out of the payload.
 *
 * Inline resources initialise synchronously, so no beforeAll hook is needed
 * (the repo's bun:test shim declares neither hooks nor `expect().not`). */

const localeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeRoot, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const point = (localDate: string, recordings: number) => ({
  local_date: localDate,
  recordings,
  duration_ms: recordings * 60_000,
  words: recordings * 200,
  by_source: [],
});

/* Thirty local days with four quiet ones, then range totals derived from
 * those points: a real projection is never inconsistent with its own days. */
const points = Array.from({ length: 30 }, (_, index) =>
  point(
    `2026-07-${String(index + 3).padStart(2, "0")}`,
    index % 5 === 0 ? 0 : (index % 4) + 1,
  ),
);
const rangeRecordings = points.reduce((sum, day) => sum + day.recordings, 0);
const rangeWords = points.reduce((sum, day) => sum + day.words, 0);
const rangeMs = points.reduce((sum, day) => sum + day.duration_ms, 0);
const fileRecordings = 3;

const trend: HistoryTrendProjection = {
  range: "days_30",
  range_start_local_date: "2026-07-03",
  range_end_local_date: "2026-08-01",
  all_time: {
    recordings: 96,
    duration_ms: 5_400_000,
    words: 18_240,
    by_source: [],
  },
  range_total: {
    recordings: rangeRecordings,
    duration_ms: rangeMs,
    words: rangeWords,
    by_source: [
      {
        source_kind: "microphone",
        recordings: rangeRecordings - fileRecordings,
        duration_ms: rangeMs - 180_000,
        words: rangeWords - 410,
      },
      {
        source_kind: "file",
        recordings: fileRecordings,
        duration_ms: 180_000,
        words: 410,
      },
    ],
  },
  active_days: 17,
  current_streak_days: 4,
  points,
};

const stats: HistoryStats = {
  entries: 96,
  total_duration_ms: 5_400_000,
  total_words: 18_240,
  by_source: [],
};

const meetingTrend: MeetingTrendProjection = {
  status: "available",
  range: "days_30",
  range_start_local_date: "2026-07-03",
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
  points: [],
};

const render = (
  props: Partial<React.ComponentProps<typeof OverviewAnalytics>> = {},
): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <OverviewAnalytics
        loading={false}
        trend={trend}
        stats={stats}
        meetingTrend={meetingTrend}
        onRetry={() => {}}
        {...props}
      />
    </I18nextProvider>,
  );

describe("OverviewAnalytics", () => {
  test("renders range totals, all-time totals and the streak", () => {
    const markup = render();

    expect(rangeRecordings).toBe(60);
    expect(markup).toContain(">60<");
    expect(markup).toContain(">12,000<");
    expect(markup).toContain(">60 min<");
    expect(markup).toContain(">4 days<");
    expect(markup).toContain("96 all time");
    expect(markup).toContain("18,240 all time");
    expect(markup).toContain("17 of 30 days active");
    expect(markup).toContain("Jul 3 to Aug 1");
  });

  test("draws one bar per day and names the graphic", () => {
    const markup = render();

    expect(markup.split("<rect").length - 1).toBe(30);
    expect(markup).toContain('data-empty="true"');
    expect(markup).toContain("Total 60, busiest day 4");
    expect(markup).toContain("Busiest day 4");
  });

  test("splits the range by source and counts meetings", () => {
    expect(render()).toContain("Microphone 57 · File import 3 · Meetings 2");
  });

  test("says so when meeting storage is unavailable", () => {
    const markup = render({
      meetingTrend: { status: "unavailable", range: "days_30" },
    });

    expect(markup).toContain("Meeting storage is unavailable");
    expect(markup).toContain("Microphone 57 · File import 3");
    expect(markup.includes("Meetings 2")).toBe(false);
  });

  test("relabels the tiles as all-time when the range read fails", () => {
    const markup = render({ trend: null });

    expect(markup).toContain("Dictations, all time");
    expect(markup).toContain("so these are all-time totals");
    expect(markup).toContain(">96<");
    expect(markup.includes("<rect")).toBe(false);
  });

  test("offers a retry when both reads fail", () => {
    const markup = render({ trend: null, stats: null });

    expect(markup).toContain("could not read your usage history");
    expect(markup).toContain("Retry");
    expect(markup).toContain('role="alert"');
  });

  test("shows placeholders, not zeros, while loading", () => {
    const markup = render({ loading: true });

    expect(markup).toContain("ui-skeleton");
    expect(markup).toContain('role="status"');
    expect(markup.includes(">60<")).toBe(false);
  });
});
