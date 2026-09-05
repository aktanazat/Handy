import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { SourceGap, SourceGapReason } from "@/bindings";
import { GapRows } from "./GapTimeline";
import { aggregateSourceGaps } from "./gapLedger";

const localePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
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
    en: { translation: JSON.parse(fs.readFileSync(localePath, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const render = (gaps: SourceGap[]) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <GapRows gaps={gaps} />
    </I18nextProvider>,
  );

const gap = (
  reason: SourceGapReason,
  startOffsetNs: number | null,
  endOffsetNs: number | null,
  droppedFrames: number | null,
): SourceGap => ({
  track_id: "track-mic",
  epoch: 0,
  reason,
  start_offset_ns: startOffsetNs,
  end_offset_ns: endOffsetNs,
  dropped_frames: droppedFrames,
});

describe("gap timeline", () => {
  test("merges only consecutive same-kind gaps and sums measured loss", () => {
    const rows = aggregateSourceGaps([
      gap("packet_dropped", 1_000_000_000, 2_000_000_000, 100),
      gap("packet_dropped", 3_000_000_000, 5_000_000_000, 200),
      gap("timestamp_missing", null, null, 512),
      gap("packet_dropped", 7_000_000_000, 8_000_000_000, 300),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      key: "track-mic:0:packet_dropped:0",
      trackId: "track-mic",
      epoch: 0,
      reason: "packet_dropped",
      count: 2,
      startOffsetNs: 1_000_000_000,
      endOffsetNs: 5_000_000_000,
      durationNs: 3_000_000_000,
      droppedFrames: 300,
    });
    expect(rows[1]).toEqual({
      key: "track-mic:0:timestamp_missing:1",
      trackId: "track-mic",
      epoch: 0,
      reason: "timestamp_missing",
      count: 1,
      startOffsetNs: null,
      endOffsetNs: null,
      durationNs: null,
      droppedFrames: 512,
    });
    expect(rows[2].count).toBe(1);
  });

  test("reduces a callback wall to one readable row", () => {
    const markup = render([
      gap("invalid_format", null, null, 512),
      gap("invalid_format", null, null, 512),
      gap("invalid_format", null, null, 512),
    ]);

    expect(markup.match(/<li/g) ?? []).toHaveLength(1);
    /* The reason reads as a sentence a person would say: the wire calls it
     * `invalid_format`, the row says the audio could not be read. */
    expect(markup).toContain("Unreadable audio");
    expect(markup).toContain("×3");
    expect(markup).toContain("1536 frames dropped");
    expect(markup).toContain("Unknown time");
  });

  test("shows eight rows before the expansion control", () => {
    const gaps = Array.from({ length: 10 }, (_, index) =>
      gap(
        index % 2 === 0 ? "packet_dropped" : "timestamp_missing",
        index * 1_000_000_000,
        (index + 1) * 1_000_000_000,
        512,
      ),
    );
    const markup = render(gaps);

    expect(markup.match(/<li/g) ?? []).toHaveLength(8);
    expect(markup).toContain("Show 2 more");
    expect(markup).toContain('aria-expanded="false"');
  });

  /* The rows sit under the capture sources now, and the header above them
   * already says whether the recording came out whole. A box saying "No gaps
   * detected" was the same fact a second time, with a hairline of its own. */
  test("says nothing at all when capture lost nothing", () => {
    expect(render([])).toBe("");
  });
});
