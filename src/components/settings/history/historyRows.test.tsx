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
import { HistorySettings, HistorySummary } from "./HistorySettings";

/* What a Library row is allowed to say, and what it must never say.
 *
 * Defects are pinned dead here, each of which shipped and each of which a
 * plausible refactor would bring back:
 *   - a metadata line of seven mono fragments: the row states date, words and
 *     mode, and the measured detail (peak/rms, engine, source, parentage)
 *     stays behind the expander;
 *   - the duration printed twice, once in the meta line and once at the
 *     player's right edge — a row states its length exactly once;
 *   - a player on a capture that holds nothing to play;
 *   - "0h 0m" for a library that holds real recordings, and a stats band of
 *     giant metrics where one quiet line belongs;
 *   - a printed 0.0000 for an input level nobody measured;
 *   - row actions scattered across six controls of three weights;
 *   - a transcript line on a row whose receipt says there was no speech;
 *   - the toolbar controls (search, view switch, folder button) overlapping —
 *     the DOM order pinned here is what the honest flex wrap relies on.
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
  /* A real decode always names the engine it ran on; only the failure path
   * leaves this unset. It is the discriminator the empty-text line reads. */
  engine_used: "local",
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

/* The metadata line alone: everything inside the <p> that carries it,
 * mode chip included. */
const metaOf = (markup: string): string =>
  markup.slice(
    markup.indexOf('data-testid="history-entry-meta"'),
    markup.indexOf("</p>", markup.indexOf("history-entry-meta")),
  );

describe("library row, line 1", () => {
  const markup = row();

  test("states date, words and the mode chip — nothing else", () => {
    const meta = metaOf(markup);
    expect(meta).toContain("6 words");
    expect(meta).toContain("email");
    expect(meta).toContain("history-mode-chip");
    // Exactly one rendered time on the line, from the shared relative
    // formatter. The fixture is fixed more than two weeks in the past, so it
    // always renders absolute with its year — a second time would double the
    // count.
    expect(occurrences(meta, "2025")).toBe(1);
    // Machine values, so the mono data role, not the body face.
    expect(markup).toContain('class="history-row-meta type-data"');
  });

  test("engine, source and levels left the line for the expanded receipt", () => {
    const meta = metaOf(markup);
    expect(meta).not.toContain("Local");
    expect(meta).not.toContain("Microphone");
    expect(meta).not.toContain(">peak<");
    expect(meta).not.toContain(">rms<");
  });

  test("shows the transcript on its own line", () => {
    expect(markup).toContain("Ship the dense Library rows today.");
    expect(markup).toContain('class="history-transcript type-body"');
  });

  test("reprocess parentage is provenance, not a metadata cell", () => {
    // "from #17" lives with the receipts behind the expander now; the
    // collapsed row does not spend a cell on it.
    expect(row({ entry: { parent_id: 17 } })).not.toContain("from #17");
  });

  test("omits an input level the run never measured", () => {
    expect(markup).not.toContain(">peak<");
    expect(markup).not.toContain("0.0000");
  });

  test("keeps a measured input level off the collapsed row too", () => {
    const measured = row({
      receipts: [
        receipt({ mode: { ...MODE, input_peak: 0.1456, input_rms: 0.011 } }),
      ],
    });
    expect(measured).not.toContain("0.1456");
    expect(measured).not.toContain(">peak<");
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

  test("collapses to one line: the reason, with the levels behind the expander", () => {
    expect(markup).toContain("No speech detected");
    expect(markup).not.toContain("0.0119");
    expect(markup).not.toContain("0.0024");
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
  test("the row states its length exactly once, at the player's right edge", () => {
    const markup = row();
    // The receipt's 15s renders as the player total and nowhere else: not in
    // the meta line, not as a second readout.
    expect(occurrences(markup, "15s")).toBe(1);
    expect(metaOf(markup)).not.toContain("15s");
    expect(markup).not.toContain("0:00");
  });

  test("a row with no player left says its length in the meta line instead", () => {
    const withoutAudio = row({ receipts: [receipt({ has_audio: false })] });
    expect(withoutAudio).not.toContain('data-testid="audio-player-toggle"');
    expect(metaOf(withoutAudio)).toContain("15s");
    // Still exactly once: the meta cell replaces the player total, it does
    // not join it.
    expect(occurrences(withoutAudio, "15s")).toBe(1);
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

  test("the hover reveal keeps the cluster in the DOM, never amputated", () => {
    // The fade is CSS opacity on .history-row-actions; the controls must stay
    // rendered and focusable so keyboard and touch reach them.
    expect(occurrences(markup, 'class="history-row-actions"')).toBe(1);
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
    expect(markup).toContain("Save entry");
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

describe("library row, empty transcript", () => {
  const empty = { transcription_text: "" };
  const markup = row({ entry: empty });

  test("a run the model heard and post-processing emptied is not a failure", () => {
    expect(markup).toContain("No text was recorded for this entry.");
    expect(markup).not.toContain("Transcription failed");
  });

  test("a run whose engine never reported still says the engine failed", () => {
    const failed = row({
      entry: empty,
      receipts: [receipt({ mode: { ...MODE, engine_used: null } })],
    });
    expect(failed).toContain("Transcription failed, so nothing was recorded.");
    expect(failed).not.toContain("No text was recorded for this entry.");
  });

  test("a held cloud run says what was held and why", () => {
    const held = row({
      entry: empty,
      receipts: [
        receipt({
          mode: { ...MODE, cloud_status: "held_cloud_unavailable" },
        }),
      ],
    });
    expect(held).toContain("The cloud run was held");
    expect(held).not.toContain("Transcription failed");
  });

  test("a truncated capture is not called a transcription failure", () => {
    // A truncated prefix is never auto-transcribed, so there was no
    // transcription to fail — and its receipt carries no engine either.
    const truncated = row({
      entry: empty,
      receipts: [
        receipt({
          capture_status: "truncated",
          mode: { ...MODE, engine_used: null },
        }),
      ],
    });
    expect(truncated).toContain("No text was recorded for this entry.");
    expect(truncated).not.toContain("Transcription failed");
  });

  test("a row from before capture_status existed is not accused of failing", () => {
    const legacy = row({
      entry: empty,
      receipts: [
        receipt({ capture_status: null, mode: { ...MODE, engine_used: null } }),
      ],
    });
    expect(legacy).toContain("No text was recorded for this entry.");
    expect(legacy).not.toContain("Transcription failed");
  });

  test("no line points at a control the row no longer has", () => {
    // Retry is a named item in the overflow menu; there is no retry icon.
    expect(markup).not.toContain("retry icon");
    expect(markup).toContain('data-testid="history-entry-retry"');
  });
});

describe("library row, search provenance", () => {
  test("marks only the row whose meaning matched, and keeps it in the mono run", () => {
    const semantic = row({ entry: { match_kind: "semantic" } });
    expect(semantic).toContain("by meaning");
    // A derived classification, so it stays at data weight rather than taking
    // the sans reason span.
    expect(semantic).not.toContain(
      '<span class="history-meta-reason">by meaning',
    );

    expect(row({ entry: { match_kind: "text" } })).not.toContain("by meaning");
    expect(row()).not.toContain("by meaning");
  });
});

describe("library row, receipt inspector", () => {
  test("stays closed until the row is expanded", () => {
    const markup = row();
    expect(markup).not.toContain('data-testid="history-receipts"');
    expect(markup).toContain('aria-expanded="false"');
  });
});

describe("library stats line", () => {
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
  });

  test("is one quiet line of figure-label pairs, not a band of metrics", () => {
    const markup = render(
      <HistorySummary
        stats={stats}
        loading={false}
        error={false}
        onRetry={() => undefined}
      />,
    );
    expect(occurrences(markup, "history-stat-value")).toBe(3);
    // Figures carry the tabular data role; nothing on the line is a metric
    // display and nothing shouts in the uppercase microlabel voice.
    expect(markup).not.toContain("type-metric");
    expect(markup).not.toContain("microlabel");
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

describe("library page chrome", () => {
  /* Static render, phase "loading": no effect runs, no Tauri command is
   * reached, and the header plus toolbar render around the skeletons. */
  const markup = render(<HistorySettings />);

  test("one toolbar owns search, the view switch and the folder button, in wrap order", () => {
    const toolbar = markup.slice(
      markup.indexOf('class="history-toolbar"'),
      markup.indexOf('data-testid="history-loading"'),
    );
    const search = toolbar.indexOf('data-testid="history-search"');
    const tabs = toolbar.indexOf('role="tablist"');
    const folder = toolbar.indexOf('data-testid="history-open-folder"');
    expect(search).toBeGreaterThan(-1);
    expect(tabs).toBeGreaterThan(-1);
    expect(folder).toBeGreaterThan(-1);
    // The honest wrap depends on this order: the growing search field first,
    // then the flex-none controls, folder last so it wraps first.
    expect(search).toBeLessThan(tabs);
    expect(tabs).toBeLessThan(folder);
  });

  test("the title row carries exactly one action, and not the folder button", () => {
    const header = markup.slice(
      markup.indexOf('class="history-header"'),
      markup.indexOf('class="history-toolbar"'),
    );
    expect(header).toContain('data-testid="history-import"');
    expect(header).not.toContain('data-testid="history-open-folder"');
  });
});
