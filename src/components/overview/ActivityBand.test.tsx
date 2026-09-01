import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { HistoryTrendProjection } from "@/bindings";
import { TooltipProvider } from "@/components/vg/tooltip";
import { ActivityBand } from "./ActivityBand";
import {
  ActivityBars,
  ActivitySparkline,
  ActivityWeek,
  activitySparklineDomain,
} from "./ActivityBandCharts";

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

const render = (node: React.ReactElement): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  );

const occurrences = (markup: string, needle: string): number =>
  markup.split(needle).length - 1;

const svgFor = (markup: string, label: string): string => {
  const labelIndex = markup.indexOf(`aria-label="${label}"`);
  if (labelIndex === -1) throw new Error(`Missing chart image: ${label}`);

  const start = markup.lastIndexOf("<svg", labelIndex);
  const end = markup.indexOf("</svg>", labelIndex);
  return markup.slice(start, end + "</svg>".length);
};

const trend: HistoryTrendProjection = {
  range: "days_180",
  range_start_local_date: "2026-03-04",
  range_end_local_date: "2026-08-30",
  all_time: { recordings: 18, duration_ms: 12_000, words: 180, by_source: [] },
  range_total: {
    recordings: 18,
    duration_ms: 12_000,
    words: 180,
    by_source: [],
  },
  active_days: 6,
  current_streak_days: 3,
  points: [
    {
      local_date: "2026-08-24",
      recordings: 1,
      duration_ms: 1000,
      words: 10,
      by_source: [],
    },
    {
      local_date: "2026-08-25",
      recordings: 4,
      duration_ms: 2000,
      words: 40,
      by_source: [],
    },
    {
      local_date: "2026-08-26",
      recordings: 2,
      duration_ms: 1000,
      words: 20,
      by_source: [],
    },
    {
      local_date: "2026-08-27",
      recordings: 0,
      duration_ms: 0,
      words: 0,
      by_source: [],
    },
    {
      local_date: "2026-08-28",
      recordings: 6,
      duration_ms: 4000,
      words: 60,
      by_source: [],
    },
    {
      local_date: "2026-08-29",
      recordings: 3,
      duration_ms: 2000,
      words: 30,
      by_source: [],
    },
    {
      local_date: "2026-08-30",
      recordings: 2,
      duration_ms: 2000,
      words: 20,
      by_source: [],
    },
  ],
};

describe("ActivityBand charts", () => {
  test("keeps three labeled activity images on the shared 84px rhythm", () => {
    const markup = render(<ActivityBand trend={trend} />);

    expect(occurrences(markup, 'role="img"')).toBe(3);
    expect(markup).toContain(
      'aria-label="Dictations per day, highest 6 on Friday"',
    );
    expect(markup).toContain(
      'aria-label="Words per day, 180 total, ending at 20"',
    );
    expect(markup).toContain(
      'aria-label="Current streak, 3 days. Active days this week:',
    );
    expect(occurrences(markup, "h-[84px]")).toBe(3);
    expect(occurrences(markup, 'data-slot="activity-streak-day"')).toBe(7);
    expect(markup).toContain("size-[10px]");
  });

  test("draws Words as a padded monotone curve with a soft area and solid endpoint", () => {
    const words = svgFor(
      render(
        <ActivitySparkline
          values={[0, 6, 3, 10]}
          ariaLabel="Words per day, 19 total, ending at 10"
        />,
      ),
      "Words per day, 19 total, ending at 10",
    );

    expect(words).toContain('role="img"');
    expect(words).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(words).toContain(" C ");
    expect(words.includes("<polyline")).toBe(false);
    expect(words).toContain('stroke-width="1.5"');
    expect(words).toContain('stroke-linecap="round"');
    expect(words).toContain('stroke-linejoin="round"');
    expect(words).toContain('stop-opacity="0.12"');
    expect(words).toContain('stop-opacity="0"');
    expect(words).toContain('<circle cx="208"');
    expect(words).toContain('r="3.5"');
    expect(words).toContain("fill-blue-900");
    expect(words.includes("<text")).toBe(false);
    expect(words.includes("transition")).toBe(false);
  });

  test("pads a flat Words domain and retains a single point above its baseline", () => {
    const domain = activitySparklineDomain([12, 12, 12]);
    const single = svgFor(
      render(
        <ActivitySparkline
          values={[12]}
          ariaLabel="Words per day, 12 total, ending at 12"
        />,
      ),
      "Words per day, 12 total, ending at 12",
    );

    expect(domain.min >= 0).toBe(true);
    expect(domain.min).toBeLessThan(12);
    expect(domain.max).toBeGreaterThan(12);
    expect(single).toContain('d="M 8 58 H 208"');
    expect(single).toContain('<circle cx="108" cy="38" r="3.5"');
    expect(single.includes("stroke-blue-900")).toBe(false);
  });

  test("draws seven labeled Dictation slots with flat zero stubs and blue gradients", () => {
    const bars = svgFor(
      render(
        <ActivityBars
          values={[0, 2]}
          weekdayLabels={["M", "T"]}
          ariaLabel="Dictations per day, highest 2 on Tuesday"
        />,
      ),
      "Dictations per day, highest 2 on Tuesday",
    );

    expect(bars).toContain('role="img"');
    expect(occurrences(bars, 'data-slot="activity-bar"')).toBe(7);
    expect(bars).toContain('<rect data-slot="activity-bar" x="8" y="56"');
    expect(occurrences(bars, "fill-gray-alpha-300")).toBe(6);
    expect(bars).toContain('fill="url(#activity-dictations-bar-');
    expect(bars).toContain('stop-opacity="0.4"');
    expect(bars).toContain(">M</text>");
    expect(bars).toContain(">T</text>");
    expect(bars).toContain('stroke-width="1"');
    expect(bars.includes("transition")).toBe(false);
  });

  test("renders localized weekday labels beneath seven active-state Streak dots", () => {
    const week = render(
      <ActivityWeek
        days={[
          { label: "M", active: true, today: true },
          { label: "T", active: false },
          { label: "W", active: true },
          { label: "T", active: false },
          { label: "F", active: false },
          { label: "S", active: false },
          { label: "S", active: false },
        ]}
        ariaLabel="Current streak, 2 days. Active days this week: Monday and Wednesday."
      />,
    );

    expect(week).toContain(
      'aria-label="Current streak, 2 days. Active days this week: Monday and Wednesday."',
    );
    expect(occurrences(week, 'data-slot="activity-streak-day"')).toBe(7);
    expect(occurrences(week, 'data-active="true"')).toBe(2);
    expect(occurrences(week, 'data-today="true"')).toBe(1);
    expect(week).toContain("size-[10px]");
    expect(week).toContain("outline-offset-2");
    expect(week).toContain("text-[9px]");
  });
});
