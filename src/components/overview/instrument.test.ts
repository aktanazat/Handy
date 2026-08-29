import { describe, expect, test } from "bun:test";
import type {
  HistoryEntry,
  HistoryRunReceipt,
  MeetingHistorySummary,
} from "@/bindings";
import {
  buildInstrumentCells,
  buildRecentActivity,
  formatInputLevel,
  newestReceipt,
  readFailure,
  shortenModelId,
  type InstrumentCell,
  type InstrumentLabels,
  type InstrumentReadings,
  type RecentActivityLabels,
} from "./instrument";

/* English labels, spelled out so an assertion reads as the rendered line. */
const labels: InstrumentLabels = {
  engine: "Engine",
  input: "Input",
  shortcut: "Shortcut",
  mode: "Mode",
  loaded: "loaded",
  unloaded: "unloaded",
  notMeasured: "not measured",
  unbound: "not set",
  gestureTapHold: "tap \u00b7 hold",
  gestureTap: "tap",
  channel: (channel) => `ch ${channel}`,
  channels: (count) => `${count} ch`,
  sampleRate: (kilohertz) => `${kilohertz} kHz`,
  decode: (factor) => `decode ${factor}`,
};

const readings: InstrumentReadings = {
  modeName: "Message",
  modelName: "Parakeet TDT 0.6b",
  engineLabel: "Local",
  engineIsLocal: true,
  backend: "MTL0",
  modelLoaded: true,
  deviceName: "MacBook Pro Microphone",
  deviceChannels: 1,
  selectedChannel: null,
  inputPeak: 0.1456,
  inputRms: 0.011,
  realtimeFactor: 13.82,
  keys: ["\u2325", "\u21e7", "2"],
  pushToTalk: true,
};

const texts = (cells: InstrumentCell[], key: string): string[] =>
  cells.find((cell) => cell.key === key)?.data.map((d) => d.text) ?? [];

describe("instrument strip mapping", () => {
  test("reports the four groups from live readings, in order", () => {
    const cells = buildInstrumentCells(readings, labels);
    expect(cells.map((cell) => cell.key)).toEqual([
      "engine",
      "input",
      "shortcut",
      "mode",
    ]);
    expect(texts(cells, "engine")).toEqual([
      "Parakeet TDT 0.6b",
      "MTL0",
      "loaded",
      "decode 13.8x",
    ]);
    expect(texts(cells, "input")).toEqual([
      "MacBook Pro Microphone",
      "16 kHz",
      "1 ch",
      "0.1456 / 0.0110",
    ]);
    expect(texts(cells, "shortcut")).toEqual(["tap \u00b7 hold"]);
    expect(texts(cells, "mode")).toEqual(["Message"]);
  });

  test("puts the chord's keycaps on the shortcut cell, not in its text", () => {
    const cells = buildInstrumentCells(readings, labels);
    const shortcut = cells.find((cell) => cell.key === "shortcut");
    expect(shortcut?.keys).toEqual(["\u2325", "\u21e7", "2"]);
    expect(shortcut?.reading).toBe(
      "Shortcut \u2325 \u00b7 \u21e7 \u00b7 2 \u00b7 tap \u00b7 hold",
    );
  });

  test("names an unmeasured level instead of printing a zero", () => {
    const cells = buildInstrumentCells(
      { ...readings, inputPeak: null, inputRms: null },
      labels,
    );
    const level = cells
      .find((cell) => cell.key === "input")
      ?.data.find((datum) => datum.key === "level");
    expect(level?.text).toBe("not measured");
    expect(level?.absent).toBe(true);
  });

  test("a measured level is not marked absent", () => {
    const level = buildInstrumentCells(readings, labels)
      .find((cell) => cell.key === "input")
      ?.data.find((datum) => datum.key === "level");
    expect(level?.absent).toBe(undefined);
    expect(level?.text).toBe("0.1456 / 0.0110");
  });

  test("half a level reading is no reading", () => {
    expect(formatInputLevel(0.5, null)).toBe(null);
    expect(formatInputLevel(null, 0.5)).toBe(null);
    expect(formatInputLevel(Number.NaN, 0.5)).toBe(null);
    expect(formatInputLevel(0, 0)).toBe("0.0000 / 0.0000");
  });

  test("a cloud route reports the provider and no local binding", () => {
    const cells = buildInstrumentCells(
      {
        ...readings,
        engineIsLocal: false,
        engineLabel: "Deepgram Nova 3",
        /* A provider actually transcribed the last run, so the backend never
         * set a factor for it. */
        realtimeFactor: null,
      },
      labels,
    );
    expect(texts(cells, "engine")).toEqual(["Deepgram Nova 3"]);
  });

  /* The one case where "cloud route" and "no local decode" come apart, and the
   * case that matters most: the provider failed, local picked up, and the figure
   * is a real local decode correctly attributable to the local engine. Gating
   * the throughput on the configured route instead of on the receipt's own
   * provenance would hide a measurement exactly when someone wants it. */
  test("a cloud run that fell back to local still reports its decode speed", () => {
    const cells = buildInstrumentCells(
      {
        ...readings,
        engineIsLocal: false,
        engineLabel: "Deepgram Nova 3",
        realtimeFactor: 12.5,
      },
      labels,
    );
    expect(texts(cells, "engine")).toEqual(["Deepgram Nova 3", "decode 12.5x"]);
  });

  /* Two conditions, two treatments. A local route with no timed decode yet can
   * supply the figure and has not, so it is named. A provider route has no
   * local decode to time at all, so implying one was due would be the lie. */
  test("an absent factor is named on a local route and omitted on a cloud one", () => {
    expect(
      texts(
        buildInstrumentCells({ ...readings, realtimeFactor: null }, labels),
        "engine",
      ),
    ).toEqual(["Parakeet TDT 0.6b", "MTL0", "loaded", "not measured"]);
    expect(
      texts(
        buildInstrumentCells(
          {
            ...readings,
            engineIsLocal: false,
            engineLabel: "Deepgram Nova 3",
            realtimeFactor: null,
          },
          labels,
        ),
        "engine",
      ),
    ).toEqual(["Deepgram Nova 3"]);
  });

  test("omits the load state until the status has been read once", () => {
    const cells = buildInstrumentCells(
      { ...readings, modelLoaded: null, backend: null },
      labels,
    );
    expect(texts(cells, "engine")).toEqual([
      "Parakeet TDT 0.6b",
      "decode 13.8x",
    ]);
  });

  test("an unloaded engine says so rather than omitting the cell", () => {
    const cells = buildInstrumentCells(
      { ...readings, modelLoaded: false, backend: null },
      labels,
    );
    expect(texts(cells, "engine")).toEqual([
      "Parakeet TDT 0.6b",
      "unloaded",
      "decode 13.8x",
    ]);
  });

  /* The figure times the batch decode only and excludes model load, so on a
   * cold start it runs about 4x the end-to-end rate. Unqualified, beside a load
   * state, it reads as end-to-end — the one misreading this cell must not
   * invite. Library labels the same field "Decode"; both surfaces have to make
   * the same claim about the same number. */
  test("qualifies the throughput figure as decode speed, never as bare xN", () => {
    const rtf = buildInstrumentCells(readings, labels)
      .find((cell) => cell.key === "engine")
      ?.data.find((datum) => datum.key === "rtf");
    expect(rtf?.text).toBe("decode 13.8x");
    expect(rtf?.text.startsWith("13.8")).toBe(false);
    expect(rtf?.absent).toBe(undefined);
  });

  test("push-to-talk off stops the strip claiming a hold gesture", () => {
    const cells = buildInstrumentCells(
      { ...readings, pushToTalk: false },
      labels,
    );
    expect(texts(cells, "shortcut")).toEqual(["tap"]);
  });

  test("an unbound chord reports itself unset and draws no keycaps", () => {
    const cells = buildInstrumentCells({ ...readings, keys: [] }, labels);
    expect(texts(cells, "shortcut")).toEqual(["not set"]);
    expect(cells.find((cell) => cell.key === "shortcut")?.keys).toEqual([]);
  });

  test("a selected channel is reported beside the channel count", () => {
    const cells = buildInstrumentCells(
      { ...readings, deviceChannels: 2, selectedChannel: 2 },
      labels,
    );
    expect(texts(cells, "input")).toEqual([
      "MacBook Pro Microphone",
      "16 kHz",
      "2 ch",
      "ch 2",
      "0.1456 / 0.0110",
    ]);
  });

  test("the device identity is the only truncating token in its cell", () => {
    const input = buildInstrumentCells(readings, labels).find(
      (cell) => cell.key === "input",
    );
    expect(input?.data.filter((datum) => datum.identity === true)).toHaveLength(
      1,
    );
    expect(input?.data[0].key).toBe("device");
  });

  test("model ids reduce to their own name, without the repository path", () => {
    expect(
      shortenModelId(
        "handy-computer/parakeet-tdt-0.6b-v2-gguf/parakeet-tdt-0.6b-v2-Q8_0.gguf",
      ),
    ).toBe("parakeet-tdt-0.6b-v2-Q8_0");
    expect(shortenModelId("whisper-small")).toBe("whisper-small");
  });

  test("names an unmeasured throughput instead of printing a zero", () => {
    const rtf = buildInstrumentCells(
      { ...readings, realtimeFactor: null },
      labels,
    )
      .find((cell) => cell.key === "engine")
      ?.data.find((datum) => datum.key === "rtf");
    expect(rtf?.text).toBe("not measured");
    expect(rtf?.absent).toBe(true);
  });
});

/* ------------------------------------------------------- recent activity */

const receipt = (
  overrides: Partial<HistoryRunReceipt> = {},
): HistoryRunReceipt => {
  const fixture = {
    id: 1,
    history_id: 7,
    run_id: 11,
    retry_of_run_id: null,
    started_at_ms: 1_000,
    completed_at_ms: 2_000,
    duration_ms: 15_000,
    word_count: 42,
    source_kind: "microphone",
    has_audio: true,
    capture_status: "complete",
    delivery_attempts: [],
    /* SAFETY: no assertion in this file reads the context receipt, so an empty
       object is the honest fixture for a field the row mapping never touches. */
    context: {} as HistoryRunReceipt["context"],
    /* SAFETY: only the receipt fields the row mapping reads are set; every one
       of them is named by an assertion below. */
    mode: {
      mode_id: "mode_message",
      engine_used: "local",
      engine_requested: "local",
      input_peak: 0.1456,
      input_rms: 0.011,
      realtime_factor: 13.82,
    } as HistoryRunReceipt["mode"],
    ...overrides,
  };
  /* SAFETY: a row fixture, not a backend payload. Only the fields the row
     mapping reads are filled; the assertions here and above name every one of
     them, so a field they paper over is a field no test depends on. */
  return fixture as HistoryRunReceipt;
};

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => {
  const fixture = {
    id: 7,
    file_name: "sona-1.wav",
    timestamp: 1_700_000_000,
    saved: false,
    title: "Test.",
    transcription_text: "Test.",
    post_processed_text: null,
    post_process_requested: false,
    parent_id: null,
    ...overrides,
  };
  /* SAFETY: a row fixture. The row mapping reads the id, the timestamp and the
     two text fields, and every one of them is set here. */
  return fixture as HistoryEntry;
};

const rowLabels: RecentActivityLabels = {
  meeting: "Meeting",
  words: (count) => `${count} words`,
  engine: (engine) => (engine === "local" ? "Local" : engine),
  phase: (phase) => phase,
};

const NOW_MS = 1_700_000_600_000;

describe("recent activity rows", () => {
  test("one time, then every measurement the receipt carries", () => {
    const rows = buildRecentActivity(
      [entry()],
      new Map([[7, [receipt()]]]),
      [],
      [{ id: "mode_message", name: "Message" }],
      rowLabels,
      NOW_MS,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].facts).toEqual([
      "10 minutes ago",
      "15s",
      "42 words",
      "Message",
      "Local",
    ]);
    expect(rows[0].snippet).toBe("Test.");
    expect(rows[0].section).toBe("history");
  });

  test("a row with no receipt still reports its one time and its text", () => {
    const rows = buildRecentActivity(
      [entry()],
      new Map([[7, null]]),
      [],
      [],
      rowLabels,
      NOW_MS,
    );
    expect(rows[0].facts).toEqual(["10 minutes ago"]);
    expect(rows[0].snippet).toBe("Test.");
  });

  test("the post-processed text is the snippet when there is one", () => {
    const rows = buildRecentActivity(
      [entry({ post_processed_text: "Polished." })],
      new Map([[7, [receipt()]]]),
      [],
      [],
      rowLabels,
      NOW_MS,
    );
    expect(rows[0].snippet).toBe("Polished.");
  });

  test("a deleted mode is reported by the id the run froze", () => {
    const rows = buildRecentActivity(
      [entry()],
      new Map([[7, [receipt()]]]),
      [],
      [{ id: "mode_other", name: "Other" }],
      rowLabels,
      NOW_MS,
    );
    expect(rows[0].facts[3]).toBe("mode_message");
  });

  test("absent measurements drop their column rather than showing zero", () => {
    const rows = buildRecentActivity(
      [entry()],
      new Map([[7, [receipt({ duration_ms: null, word_count: null })]]]),
      [],
      [{ id: "mode_message", name: "Message" }],
      rowLabels,
      NOW_MS,
    );
    expect(rows[0].facts).toEqual(["10 minutes ago", "Message", "Local"]);
  });

  test("the newest run describes the entry, because retries append", () => {
    const receipts = [
      receipt({ run_id: 11, completed_at_ms: 2_000, word_count: 1 }),
      receipt({ run_id: 12, completed_at_ms: 9_000, word_count: 9 }),
    ];
    expect(newestReceipt(receipts)?.run_id).toBe(12);
    expect(newestReceipt([])).toBe(null);
    expect(newestReceipt(null)).toBe(null);
  });

  test("meetings and dictations interleave newest first", () => {
    const meeting: MeetingHistorySummary = {
      kind: "meeting",
      session_id: "s1",
      title: "Standup",
      phase: "review_ready",
      created_at_utc_ms: NOW_MS - 60_000,
      capture_completeness: "complete",
      processing_status: { kind: "succeeded" },
    };
    const rows = buildRecentActivity(
      [entry()],
      new Map([[7, [receipt()]]]),
      [meeting],
      [{ id: "mode_message", name: "Message" }],
      rowLabels,
      NOW_MS,
    );
    expect(rows.map((row) => row.key)).toEqual(["meeting-s1", "history-7"]);
    expect(rows[0].facts).toEqual(["1 minute ago", "Meeting", "review_ready"]);
    expect(rows[0].snippet).toBe("Standup");
  });
});

/* --------------------------------------------------- empty-state truth table */

describe("read failure truth table", () => {
  test("a successful read is never a failure, empty or not", () => {
    expect(
      readFailure("get_history_entries", {
        status: "fulfilled",
        value: { status: "ok" },
      }),
    ).toBe(null);
  });

  test("a command error is reported verbatim, under the command's name", () => {
    expect(
      readFailure("meeting_list", {
        status: "fulfilled",
        value: { status: "error", error: "storage_unavailable" },
      }),
    ).toEqual({ command: "meeting_list", detail: "storage_unavailable" });
  });

  test("a rejected call keeps the message it threw", () => {
    expect(
      readFailure("get_history_entries", {
        status: "rejected",
        reason: new Error("ipc channel closed"),
      }),
    ).toEqual({
      command: "get_history_entries",
      detail: "ipc channel closed",
    });
  });

  test("a failure with nothing to say still names the command", () => {
    expect(
      readFailure("get_history_entries", {
        status: "fulfilled",
        value: { status: "error", error: null },
      }),
    ).toEqual({ command: "get_history_entries", detail: null });
    expect(
      readFailure("meeting_list", { status: "rejected", reason: {} }),
    ).toEqual({ command: "meeting_list", detail: null });
  });
});
