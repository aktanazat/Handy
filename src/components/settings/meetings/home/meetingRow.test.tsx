import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { MeetingHistorySummary } from "@/bindings";
import { formatRelativeTime } from "@/lib/utils/format";
import { formatTimeOfDay } from "@/lib/utils/localDay";
import { MeetingCard } from "./MeetingCard";

/* What this file defends: the one quiet line under a recorded meeting's title
 * says only what the meeting reported.
 *
 * The row prints when it happened, how long it ran and who spoke, joined by
 * middots. Each of those is optional on the record — a capture that closed no
 * window has no duration, an unfinished one has no speakers — and the failure
 * mode of a joined line is printing the separator anyway: "9:30 AM · " with
 * nothing after it, or "0s" for a length nobody measured. */

const catalogue = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "i18n",
      "locales",
      "en",
      "translation.json",
    ),
    "utf8",
  ),
);

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: catalogue } },
  interpolation: { escapeValue: false },
});

const RECORDED_AT = Date.UTC(2026, 7, 28, 16, 30);

const MEETING: MeetingHistorySummary = {
  kind: "meeting",
  session_id: "meeting-1",
  title: "Weekly planning",
  phase: "review_ready",
  created_at_utc_ms: RECORDED_AT,
  capture_completeness: "complete",
  processing_status: { kind: "succeeded" },
  recorded_duration_ms: 192_000,
  speaker_labels: ["Ada", "Grace"],
  headline: { kind: "none" },
};

const rowMarkup = (overrides: Partial<MeetingHistorySummary>) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ul>
        <MeetingCard
          meeting={{ ...MEETING, ...overrides }}
          onOpen={() => {}}
          onExport={() => {}}
          onExportLedger={() => {}}
          onDelete={() => {}}
          onRetry={() => {}}
        />
      </ul>
    </I18nextProvider>,
  );

/** The row's quiet line: everything between the title and the row's controls. */
const metaLine = (overrides: Partial<MeetingHistorySummary>) => {
  const markup = rowMarkup(overrides);
  const at = markup.indexOf('class="snap-measured');
  if (at === -1) return "";
  const open = markup.indexOf(">", at);
  return markup.slice(open + 1, markup.indexOf("</span>", open));
};

describe("a recorded meeting's quiet line", () => {
  test("reads when, how long and who, in that order", () => {
    expect(metaLine({})).toBe(
      `${formatTimeOfDay(RECORDED_AT)} · 3m 12s · Ada, Grace`,
    );
  });

  test("a capture that measured no length prints no length and no gap for one", () => {
    expect(metaLine({ recorded_duration_ms: null })).toBe(
      `${formatTimeOfDay(RECORDED_AT)} · Ada, Grace`,
    );
  });

  test("a meeting that named nobody ends after its length", () => {
    expect(metaLine({ speaker_labels: [] })).toBe(
      `${formatTimeOfDay(RECORDED_AT)} · 3m 12s`,
    );
  });

  test("a record that reported neither is the clock time alone", () => {
    expect(
      metaLine({ recorded_duration_ms: null, speaker_labels: undefined }),
    ).toBe(formatTimeOfDay(RECORDED_AT));
  });
});

/* What this defends: the row's last cell says how long ago, in the words the
 * one shared helper prints. The clock time on the quiet line above it and the
 * date on the day heading above that both answer "when"; neither answers
 * "recent or not", which is what somebody scanning a log is asking. */
describe("how long ago a recorded meeting was", () => {
  test("the row ends in the elapsed phrasing, printed as the helper gives it", () => {
    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;

    expect(rowMarkup({ created_at_utc_ms: fiveHoursAgo })).toContain(
      `>${formatRelativeTime(fiveHoursAgo)}<`,
    );
  });
});
