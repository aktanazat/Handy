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
  test("keeps three labeled chart images on the shared 72px drawing rhythm", () => {
    const markup = render(<ActivityBand trend={trend} />);

    expect(occurrences(markup, 'role="img"')).toBe(3);
    expect(markup).toContain(
      'aria-label="Dictations per day, highest 6 on Friday"',
    );
    expect(markup).toContain(
      'aria-label="Words per day, 180 total, ending at 20"',
    );
    expect(markup).toContain('aria-label="Current streak, 3 days"');
    expect(occurrences(markup, "h-[72px]")).toBe(2);
    expect(markup).toContain("size-[72px]");
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
    expect(single).toContain('d="M 8 66 H 208"');
    expect(single).toContain('<circle cx="108" cy="42.8" r="3.5"');
    expect(single.includes("stroke-blue-900")).toBe(false);
  });

  test("draws seven Dictation slots with visible zero stubs and one peak bar", () => {
    const bars = svgFor(
      render(
        <ActivityBars
          values={[0, 2]}
          highlightIndex={1}
          ariaLabel="Dictations per day, highest 2 on Tuesday"
        />,
      ),
      "Dictations per day, highest 2 on Tuesday",
    );

    expect(bars).toContain('role="img"');
    expect(occurrences(bars, 'data-slot="activity-bar"')).toBe(7);
    expect(bars).toContain(
      'd="M 8 66 V 65 Q 8 64 9 64 H 15 Q 16 64 16 65 V 66 Z"',
    );
    expect(bars).toContain(
      'd="M 40 66 V 12 Q 40 8 44 8 H 44 Q 48 8 48 12 V 66 Z"',
    );
    expect(bars).toContain("fill-gray-alpha-300");
    expect(occurrences(bars, "fill-blue-900")).toBe(1);
    expect(bars).toContain('stroke-width="1"');
    expect(bars.includes("transition")).toBe(false);
  });

  test("uses a quiet three-pixel Streak ring with a rounded blue arc", () => {
    const markup = render(<ActivityBand trend={trend} />);
    const ring = svgFor(markup, "Current streak, 3 days");

    expect(ring).toContain('viewBox="0 0 72 72"');
    expect(occurrences(ring, 'stroke-width="3"')).toBe(2);
    expect(ring).toContain("stroke-gray-alpha-300");
    expect(ring).toContain("stroke-blue-900");
    expect(ring).toContain('stroke-linecap="round"');
    expect(markup).toContain(
      "absolute inset-0 flex items-center justify-center text-[18px]",
    );
    expect(ring.includes("transition")).toBe(false);
  });
});
