import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { HistoryUpdatePayload } from "@/bindings";
import {
  Overview,
  readOverviewData,
  subscribeToHistoryWrites,
  type OverviewData,
} from "./Overview";
import { InstrumentStrip } from "./InstrumentStrip";
import {
  buildInstrumentCells,
  type InstrumentLabels,
  type RecentActivityLabels,
} from "./instrument";

/* First paint of the page, before any effect has run: what someone sees in the
 * moment between opening Capture and the history reads landing. The names
 * asserted here are the ones the shell, the command palette and the
 * end-to-end suite look up.
 *
 * Inline resources initialise synchronously, so no beforeAll hook is needed
 * (the repo's bun:test shim declares no hooks). */

const localeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

/* @tauri-apps/plugin-os reads its platform off a window global that the Tauri
 * runtime injects. Static rendering has no window, so the hero's keycap
 * formatting would throw before it could be inspected. The event globals beside
 * it are the ones `@tauri-apps/api` calls through when this page subscribes:
 * `transformCallback` hands the page's own handler straight back, so the
 * `listen` invoke carries it and the test can deliver a write the way the
 * webview does.
 *
 * `answer` is the backend. It is swappable rather than a fixed table because
 * the behaviour under test is a capture landing between two read waves: the
 * same commands answer differently before and after, which is exactly what a
 * dictation does to the database. Nothing is registered by default, so the
 * first-paint render below reaches no command. */
const listens: {
  event: string;
  handler: (message: { payload: HistoryUpdatePayload }) => void;
}[] = [];
const unlistens: string[] = [];
/**
 * The JSON a Tauri command answers with. Named because standing in for the wire
 * is this mock's whole job: the generated commands parse whatever comes back,
 * so a value this type cannot express is a value no real command could send.
 * Mirrors `JsonValue` in `tests/support/tauri-mock.ts`, which does the same job
 * for the browser suite.
 */
type CommandPayload =
  | null
  | boolean
  | number
  | string
  | CommandPayload[]
  | { [field: string]: CommandPayload };

let answer: (command: string) => CommandPayload = () => null;

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    __TAURI_OS_PLUGIN_INTERNALS__: { os_type: "macos" },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    __TAURI_INTERNALS__: {
      transformCallback: (
        handler: (message: { payload: HistoryUpdatePayload }) => void,
      ) => handler,
      invoke: async (
        command: string,
        args: {
          event: string;
          handler: (message: { payload: HistoryUpdatePayload }) => void;
        },
      ) => {
        if (command === "plugin:event|listen") {
          listens.push({ event: args.event, handler: args.handler });
          return listens.length;
        }
        if (command === "plugin:event|unlisten") {
          unlistens.push(args.event);
          return null;
        }
        return answer(command);
      },
    },
  },
});

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeRoot, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const markup = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <Overview />
  </I18nextProvider>,
);

describe("Overview first paint", () => {
  test("keeps the hero status heading and both primary actions", () => {
    expect(markup).toContain('id="overview-status"');
    expect(markup).toContain("Ready");
    expect(markup).toContain("New meeting");
    expect(markup).toContain("Import audio");
  });

  test("says the shortcut is missing instead of showing empty keycaps", () => {
    expect(markup).toContain("Shortcut unavailable");
  });

  /* The meeting promise is a product commitment the wave was asked to make
   * self-evident, so it is asserted as copy rather than as markup. */
  test("states what a meeting recording does, beside the button that does it", () => {
    expect(markup).toContain("ov-hero-action");
    expect(markup).toContain(
      "Records your Mac&#x27;s audio locally. Nothing joins the call.",
    );
  });

  /* The gesture sentence describes the chord. With no chord bound there is no
   * gesture to describe, and printing one would claim a capability the install
   * does not have — the same class of lie as the old unconditional hint line. */
  test("claims no gesture while no shortcut is bound", () => {
    expect(markup.includes("Tap to toggle")).toBe(false);
    expect(markup).toContain("Set a shortcut");
    expect(markup).toContain('data-testid="overview-shortcut"');
  });

  test("renders the instrument strip with all four labelled cells", () => {
    expect(markup).toContain('aria-label="Capture instrument"');
    for (const cell of ["engine", "input", "shortcut", "mode"]) {
      expect(markup).toContain(`data-cell="${cell}"`);
    }
    expect(markup).toContain(">Engine</dt>");
    expect(markup).toContain(">Input</dt>");
    expect(markup).toContain(">Shortcut</dt>");
    expect(markup).toContain(">Mode</dt>");
  });

  /* Every value in the strip is a measurement, and a measurement snaps: a
   * transition on one of these would paint numbers the backend never sent. */
  test("marks every strip value as never-animated", () => {
    expect(markup).toContain("ov-strip-datum type-data snap-measured");
  });

  test("names an unmeasured input level rather than printing a zero", () => {
    expect(markup).toContain("not measured");
    expect(markup).toContain('data-absent="true"');
    expect(markup).toContain("16 kHz");
  });

  test("reports an unbound chord as unset, in the strip and not as a blank", () => {
    expect(markup).toContain(">not set<");
  });

  /* The hero is one raised card that carries the strip as its footer: no
   * decorative shader layer may come back around it. */
  test("draws the hero and the strip as one card, with no shader layer", () => {
    expect(markup).toContain('class="ov-capture"');
    expect(markup.includes("shader-hero")).toBe(false);
  });

  test("loads behind placeholders, with no update banner and no numbers", () => {
    expect(markup).toContain("ui-skeleton");
    expect(markup.includes("is available. This install is on")).toBe(false);
    expect(markup.includes("Could not check for updates")).toBe(false);
    expect(markup.includes("ov-stat-value")).toBe(false);
  });

  /* The banned copy: an empty region used to apologise for a query that had
   * actually succeeded. Neither the apology nor the old separate hint line may
   * come back. */
  test("carries no apology copy and no orphaned hint line", () => {
    expect(markup.includes("could not be loaded just now")).toBe(false);
    expect(markup.includes("Nothing recent")).toBe(false);
    expect(markup.includes("ov-hero-facts")).toBe(false);
  });
});

/* The page's measured cells — decode throughput, input amplitudes, dictation
 * counters — all come from one read wave per mount, so before this subscription
 * a dictation that landed while Capture was open kept reporting the capture
 * before it until someone left the page and came back. The `listen` call goes
 * through the real `@tauri-apps/api` path here, so the event name asserted is
 * the generated one the Rust emit publishes and not a string this test made up.
 */
const entry = {
  id: 7,
  file_name: "sona-1.wav",
  timestamp: 1,
  saved: false,
  title: "Recording 1",
  transcription_text: "hello",
  post_processed_text: null,
  post_process_requested: false,
  parent_id: null,
};

describe("Capture stays live while it is open", () => {
  test("re-reads on a saved capture and on a removal, never on a star", async () => {
    let reads = 0;
    const unlisten = await subscribeToHistoryWrites(() => {
      reads += 1;
    });
    expect(listens.map((listener) => listener.event)).toEqual([
      "history-update-payload",
    ]);

    const deliver = (payload: HistoryUpdatePayload) =>
      listens[0].handler({ payload });

    deliver({ action: "added", entry });
    expect(reads).toBe(1);
    deliver({ action: "updated", entry });
    expect(reads).toBe(2);
    deliver({ action: "deleted", id: entry.id });
    expect(reads).toBe(3);

    /* Capture never draws the saved star and its counters do not distinguish a
     * starred row, so a toggle must not cost a read wave. */
    deliver({ action: "toggled", id: entry.id });
    expect(reads).toBe(3);

    await unlisten();
    expect(unlistens).toEqual(["history-update-payload"]);
  });
});

/* The defect this closes: the measured cells reported the capture before the
 * one that just landed, and only corrected themselves when someone left Capture
 * and came back. The proof has to be end to end over the seam — the event goes
 * in through the real `@tauri-apps/api` listen path, the wave goes out through
 * the real generated commands, and the assertion is on the strip's own rendered
 * markup — because every one of those three is a place the datum can be lost.
 *
 * `readOverviewData` is the function the mount effect runs. The test calls that
 * same function, so a live capture is proven to arrive at the state a fresh
 * mount would: there is no second code path to keep in step. */

/* Only what the strip reads; the label mapping itself is instrument.test.ts's
 * subject. English literals so an assertion reads as the rendered line. */
const stripLabels: InstrumentLabels = {
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

const rowLabels: RecentActivityLabels = {
  meeting: "Meeting",
  words: (count) => `${count} words`,
  engine: () => "Local",
  phase: (phase) => phase,
};

/** The strip as the page draws it, given one settled read wave. */
const stripMarkup = (data: OverviewData): string =>
  renderToStaticMarkup(
    <InstrumentStrip
      cells={buildInstrumentCells(
        {
          modeName: "Message",
          modelName: "Parakeet TDT 0.6b",
          engineLabel: "Local",
          engineIsLocal: true,
          backend: "MTL0",
          modelLoaded: true,
          deviceName: "MacBook Pro Microphone",
          deviceChannels: 1,
          selectedChannel: null,
          inputPeak: data.inputPeak,
          inputRms: data.inputRms,
          realtimeFactor: data.realtimeFactor,
          keys: [],
          pushToTalk: true,
        },
        stripLabels,
      )}
      label="Capture instrument"
    />,
  );

const NO_MEETINGS = { entries: [], has_more: false };

/** An install with nothing recorded: the measured cells have no datum to show. */
const nothingRecorded = (command: string): CommandPayload => {
  if (command === "get_history_entries")
    return { entries: [], has_more: false, total: 0 };
  if (command === "meeting_list") return NO_MEETINGS;
  return null;
};

/* The same backend one dictation later. The run receipt is written as the plain
 * JSON it is on the wire — the generated command is what parses it — so no
 * fixture cast can hide a shape the frontend would never actually receive. */
const oneMeasuredCapture = (command: string): CommandPayload => {
  if (command === "get_history_entries")
    return { entries: [entry], has_more: false, total: 1 };
  if (command === "meeting_list") return NO_MEETINGS;
  if (command === "get_history_run_receipts")
    return [
      {
        id: 1,
        history_id: entry.id,
        run_id: 11,
        retry_of_run_id: null,
        started_at_ms: 1_000,
        completed_at_ms: 2_000,
        duration_ms: 15_000,
        word_count: 2,
        source_kind: "microphone",
        has_audio: true,
        capture_status: "complete",
        delivery_attempts: [],
        context: {},
        mode: {
          mode_id: "mode_message",
          engine_requested: "local",
          engine_used: "local",
          input_peak: 0.1456,
          input_rms: 0.011,
          realtime_factor: 13.82,
        },
      },
    ];
  return null;
};

/**
 * The wave the mount effect runs, on a fixed clock. Nothing here supersedes a
 * wave, so a null answer is the wave misreporting itself rather than a case
 * this test has to handle.
 */
const settledWave = async (): Promise<OverviewData> => {
  const data = await readOverviewData([], rowLabels, 3_000, () => false);
  if (data === null) throw new Error("read wave reported itself superseded");
  return data;
};

describe("a capture that lands while Capture is open", () => {
  test("moves the measured cells off 'not measured' without a remount", async () => {
    answer = nothingRecorded;

    const before = stripMarkup(await settledWave());
    expect(before).toContain("not measured");
    expect(before.includes("0.1456")).toBe(false);
    expect(before.includes("decode")).toBe(false);

    /* The dictation lands. The backend commits the entry and its receipt in one
     * transaction and emits afterwards, so by the time the event arrives the
     * receipt below is already readable — which is why the handler re-queries
     * rather than needing the measurements in the payload. */
    const waves: Promise<OverviewData>[] = [];
    const unlisten = await subscribeToHistoryWrites(() => {
      waves.push(settledWave());
    });
    const listener = listens[listens.length - 1];
    expect(listener.event).toBe("history-update-payload");

    answer = oneMeasuredCapture;
    listener.handler({ payload: { action: "added", entry } });

    /* One write, one wave: the page re-queries the database rather than reading
     * anything out of the event, and it does so once. */
    expect(waves).toHaveLength(1);
    const settled = await waves[0];
    expect(settled.inputPeak).toBe(0.1456);
    expect(settled.inputRms).toBe(0.011);
    expect(settled.realtimeFactor).toBe(13.82);

    const after = stripMarkup(settled);
    expect(after).toContain("0.1456 / 0.0110");
    expect(after).toContain("decode 13.8x");
    expect(after.includes("not measured")).toBe(false);

    await unlisten();
  });
});
