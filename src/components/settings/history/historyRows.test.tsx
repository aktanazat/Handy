import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type {
  ContextReceipt,
  HistoryEntry as HistoryEntryRow,
  HistoryRunReceipt,
  HistoryStats,
  ModeReceipt,
} from "@/bindings";
import { HistoryEntryComponent } from "./HistoryEntry";
import { HistorySummary } from "./HistorySettings";

/* What a Library row is allowed to say, and what it must never say.
 *
 * Six defects are pinned dead here, each of which shipped and each of which a
 * plausible refactor would bring back:
 *   - a player on a capture that holds nothing to play;
 *   - a 0:00 elapsed beside a 0:00 total, one measurement printed twice;
 *   - "0h 0m" for a library that holds real recordings;
 *   - a printed 0.0000 for an input level nobody measured;
 *   - row actions scattered across six controls of three weights;
 *   - a transcript line on a row whose receipt says there was no speech.
 *
 * Static rendering runs no effects, so these are pure prop-to-markup checks and
 * no Tauri command is reachable from here. */

const localeFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
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
    en: { translation: JSON.parse(fs.readFileSync(localeFile, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const render = (node: React.ReactElement): string =>
  renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

const occurrences = (markup: string, needle: string) =>
  markup.split(needle).length - 1;

const CONTEXT: ContextReceipt = {
  requested_policy: "target",
  policy: "target",
  accessibility: "granted",
  sources: {
    target: "captured",
    focused_field: "captured",
    selected_text: "not_requested",
    browser_url: "not_requested",
    clipboard: "not_requested",
  },
  captured_at_ms: 1_756_000_000_000,
};

const MODE: ModeReceipt = {
  run_id: 7,
  settings_revision: 12,
  mode_id: "email",
  tone: "semi_formal",
  requested_context_policy: "target",
  context_policy_ceiling: "full",
  context_policy: "target",
  prompt_preset: "email",
  post_process_requested: false,
  provider_id: null,
  model_id: null,
  engine_requested: "local",
};

const ENTRY: HistoryEntryRow = {
  id: 41,
  file_name: "sona-1787979738.wav",
  timestamp: 1_756_000_000,
  saved: false,
  title: "",
  transcription_text: "Ship the dense Library rows today.",
  post_processed_text: null,
  post_process_requested: false,
  parent_id: null,
};

const receipt = (
  overrides: Partial<HistoryRunReceipt> = {},
): HistoryRunReceipt => ({
  id: 3,
  history_id: ENTRY.id,
  run_id: 7,
  retry_of_run_id: null,
  started_at_ms: 1_756_000_000_000,
  completed_at_ms: 1_756_000_001_000,
  mode: MODE,
  context: CONTEXT,
  duration_ms: 15_000,
  word_count: 6,
  source_kind: "microphone",
  has_audio: true,
  capture_status: "complete",
  delivery_attempts: [],
  ...overrides,
});

const noop = async () => undefined;
const noText = async () => undefined;
const noBlob = async () => null;

const row = (
  overrides: {
    entry?: Partial<HistoryEntryRow>;
    receipts?: HistoryRunReceipt[] | null | undefined;
  } = {},
) =>
  render(
    <HistoryEntryComponent
      entry={{ ...ENTRY, ...overrides.entry }}
      receipts={"receipts" in overrides ? overrides.receipts : [receipt()]}
      view="processed"
      onToggleSaved={noop}
      onCopyText={noText}
      getAudioBlob={noBlob}
      deleteAudio={noop}
      retryTranscription={noop}
    />,
  );

describe("library row, line 1", () => {
  const markup = row();

  test("states timestamp, length, words, mode, engine and source as one mono run", () => {
    const meta = markup.slice(
      markup.indexOf('data-testid="history-entry-meta"'),
      markup.indexOf("</p>", markup.indexOf("history-entry-meta")),
    );
    expect(meta).toContain("15s");
    expect(meta).toContain("6 words");
    expect(meta).toContain("email");
    expect(meta).toContain("Local");
    expect(meta).toContain("Microphone");
    // Exactly one rendered time on the line, absolute, from the shared
    // formatter. The fixture is fixed in the past, so its year always differs
    // from now and always renders — a second time would double the count.
    expect(occurrences(meta, "2025")).toBe(1);
    // Machine values, so the mono data role, not the body face.
    expect(markup).toContain('class="history-row-meta type-data"');
  });

  test("shows the transcript on its own line", () => {
    expect(markup).toContain("Ship the dense Library rows today.");
    expect(markup).toContain('class="history-transcript type-body"');
  });

  test("names the row it was reprocessed from by id", () => {
    expect(row({ entry: { parent_id: 17 } })).toContain("from #17");
  });

  test("omits an input level the run never measured", () => {
    expect(markup).not.toContain(">peak<");
    expect(markup).not.toContain("0.0000");
  });

  test("reports a measured input level at the precision the backend logged", () => {
    const measured = row({
      receipts: [
        receipt({ mode: { ...MODE, input_peak: 0.1456, input_rms: 0.011 } }),
      ],
    });
    expect(measured).toContain(">peak<");
    expect(measured).toContain("0.1456");
    expect(measured).toContain(">rms<");
    expect(measured).toContain("0.0110");
  });
});

describe("library row, no-speech capture", () => {
  const silent = receipt({
    capture_status: "no_speech_detected",
    word_count: 0,
    duration_ms: 1_140,
    mode: { ...MODE, input_peak: 0.0119, input_rms: 0.0024 },
  });
  const markup = row({ receipts: [silent] });

  test("collapses to one line: the reason plus the measured level", () => {
    expect(markup).toContain("No speech detected");
    expect(markup).toContain("0.0119");
    expect(markup).toContain("0.0024");
    expect(markup).not.toContain('class="history-transcript type-body"');
  });

  test("does not claim a word count for a capture with no speech", () => {
    expect(markup).not.toContain("0 words");
  });

  test("keeps the player, because the retained sample is the evidence", () => {
    expect(markup).toContain('data-testid="audio-player-seek"');
  });

  test("drops the player when the receipt says there is nothing to play", () => {
    const empty = row({
      receipts: [
        receipt({ capture_status: "no_speech_detected", duration_ms: 0 }),
      ],
    });
    expect(empty).not.toContain('data-testid="audio-player-seek"');
    expect(empty).not.toContain('data-testid="audio-player-toggle"');

    const silentNoFile = row({
      receipts: [receipt({ has_audio: false })],
    });
    expect(silentNoFile).not.toContain('data-testid="audio-player-seek"');
  });
});

describe("library row, audio player", () => {
  test("shows the receipt's length as the total instead of a second zero", () => {
    const markup = row();
    // Elapsed 0s on the left, the real length on the right: one pair, and the
    // total is never the elapsed value printed twice.
    expect(markup).toContain(">0s<");
    expect(markup).toContain(">15s<");
    expect(occurrences(markup, ">0s<")).toBe(1);
    expect(markup).not.toContain("0:00");
  });

  test("keeps a real range control rather than an unstyled nub", () => {
    const markup = row();
    expect(markup).toContain('type="range"');
    expect(markup).not.toContain("appearance-none");
    expect(markup).toContain('max="15"');
  });

  test("offers the player when no receipt can prove the row is empty", () => {
    expect(row({ receipts: [] })).toContain(
      'data-testid="audio-player-toggle"',
    );
    expect(row({ receipts: null })).toContain(
      'data-testid="audio-player-toggle"',
    );
  });
});

describe("library row, actions", () => {
  const markup = row();

  test("keeps copy visible and everything destructive behind one menu", () => {
    expect(markup).toContain('data-testid="history-entry-copy"');
    expect(markup).toContain('data-testid="history-entry-expand"');
    expect(markup).toContain('data-testid="history-entry-actions"');
    expect(occurrences(markup, 'class="history-actions-menu"')).toBe(1);
  });

  test("every operation the row had before is still reachable", () => {
    for (const action of [
      "history-entry-correct",
      "history-entry-save",
      "history-entry-retry",
      "history-entry-process-again",
      "history-entry-delete",
    ]) {
      expect(markup).toContain(`data-testid="${action}"`);
    }
    expect(occurrences(markup, 'role="menuitem"')).toBe(5);
  });

  test("names the star action by what pressing it does", () => {
    expect(markup).toContain("Save transcription");
    expect(row({ entry: { saved: true } })).toContain("Remove from saved");
  });

  test("disables copy and correction when there is no text to act on", () => {
    const empty = row({ entry: { transcription_text: "" } });
    const copy = empty.slice(
      empty.lastIndexOf("<button", empty.indexOf("history-entry-copy")),
      empty.indexOf("history-entry-copy"),
    );
    expect(copy).toContain("disabled");
  });
});

describe("library row, receipt inspector", () => {
  test("stays closed until the row is expanded", () => {
    const markup = row();
    expect(markup).not.toContain('data-testid="history-receipts"');
    expect(markup).toContain('aria-expanded="false"');
  });
});

describe("library stats bar", () => {
  const stats: HistoryStats = {
    entries: 4,
    total_duration_ms: 15_000,
    total_words: 96,
    by_source: [],
  };

  test("reports a 15-second library as 15s, never as 0h 0m", () => {
    const markup = render(
      <HistorySummary
        stats={stats}
        loading={false}
        error={false}
        onRetry={() => undefined}
      />,
    );
    expect(markup).toContain("15s");
    expect(markup).not.toContain("0h 0m");
    expect(markup).toContain("recordings");
    expect(markup).toContain("recording time");
    expect(markup).toContain("words");
    expect(occurrences(markup, "type-metric")).toBe(3);
  });

  test("carries hours when the library actually holds hours", () => {
    const markup = render(
      <HistorySummary
        stats={{ ...stats, total_duration_ms: 3_840_000 }}
        loading={false}
        error={false}
        onRetry={() => undefined}
      />,
    );
    expect(markup).toContain("1h 4m");
  });
});
