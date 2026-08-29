import type {
  HistoryEntry,
  HistoryRunReceipt,
  MeetingHistorySummary,
} from "@/bindings";
import { z } from "zod";
import { formatDurationShort, formatRelativeTime } from "@/lib/utils/format";

/* Live readouts for the Capture page: the instrument strip and the recent
 * activity rows.
 *
 * Everything here is a projection of a value the backend actually reported.
 * Nothing is invented, nothing is rounded to a friendlier number, and a value
 * that has not arrived yet is left out rather than filled with a placeholder —
 * an omitted datum is honest, a fabricated one is not. The one word this file
 * is allowed to print in place of a number is "not measured", and only where
 * the backend positively told us it never measured. */

/** Sample rate every dictation capture is resampled to before the VAD, the
 * model, and the saved WAV see it. Mirrors `WHISPER_SAMPLE_RATE` in
 * `src-tauri/src/audio_toolkit/constants.rs`; the two change together. */
export const CAPTURE_SAMPLE_RATE_HZ = 16_000;

/** Which of the four cells a datum belongs to. */
export type InstrumentCellKey = "engine" | "input" | "shortcut" | "mode";

/**
 * One token on a cell's data line.
 *
 * `identity` marks the cell's variable-length name — a model id, a device name
 * — which is the only token allowed to truncate, because every other token on
 * the line is a measurement and half a measurement is a wrong measurement.
 *
 * `absent` marks a value the backend can supply but has not yet. It is named
 * rather than omitted, because a blank slot is the opacity this app refuses;
 * the renderer dims it so a glance across the strip separates the slots holding
 * a real reading from the slots still waiting. Colour tracks whether a value
 * exists, never whether it is a problem.
 */
export interface InstrumentDatum {
  key: string;
  text: string;
  identity?: true;
  absent?: true;
}

export interface InstrumentCell {
  key: InstrumentCellKey;
  label: string;
  data: InstrumentDatum[];
  /** One entry per physical key, for the shortcut cell only. */
  keys?: string[];
  /** The whole cell as one string, for the cell's `title`. */
  reading: string;
}

/** Everything the strip reads, already resolved from its own source. */
export interface InstrumentReadings {
  /** Active mode name; null until the settings document has loaded. */
  modeName: string | null;
  /** Product name of the model this run would use; null when none is chosen. */
  modelName: string | null;
  /** Translated route label: the local runtime, or the named cloud provider. */
  engineLabel: string | null;
  /** True when the run routes to the local engine, so the local engine's
   * binding is what will actually transcribe. */
  engineIsLocal: boolean;
  /** Compute backend the loaded engine bound to ("MTL0", "onnx", a CPU
   * string). Null when no model is loaded, or before the status is read. */
  backend: string | null;
  /** Whether the engine holds a loaded model. Null before the first read. */
  modelLoaded: boolean | null;
  /** Input device name; null before the device list is read. */
  deviceName: string | null;
  /** Channel count the device reports; null when it has not been read. */
  deviceChannels: number | null;
  /** Which channel is taken, or null for "average every channel". */
  selectedChannel: number | null;
  /** Amplitudes from the newest run receipt. Null = not measured. */
  inputPeak: number | null;
  inputRms: number | null;
  /** Realtime factor of the newest run's local batch decode — the engine's
   * measured throughput on this machine. Null = that run had no timed local
   * decode, so nothing measured it. */
  realtimeFactor: number | null;
  /** One entry per physical key of the transcribe chord; empty = unbound. */
  keys: string[];
  /** Whether hold-to-talk is armed alongside tap-to-toggle. Null before the
   * settings document has loaded. */
  pushToTalk: boolean | null;
}

/** The translated strings the strip needs. Kept as data so the derivation
 * stays pure and testable without an i18n instance. */
export interface InstrumentLabels {
  engine: string;
  input: string;
  shortcut: string;
  mode: string;
  loaded: string;
  unloaded: string;
  notMeasured: string;
  unbound: string;
  /** "tap · hold" — tap latches, hold talks. */
  gestureTapHold: string;
  /** "tap" — push-to-talk off, so the chord only toggles. */
  gestureTap: string;
  /** Suffix naming the one channel taken off a multi-channel device. */
  channel: (channel: number) => string;
  channels: (count: number) => string;
  sampleRate: (kilohertz: number) => string;
}

/**
 * Peak and RMS as one reading, or null when the receipt did not measure them.
 * Both or neither: a peak without its RMS cannot answer the question these
 * numbers exist to answer.
 *
 * Four decimals, the precision the backend logs, is not decoration: a dead
 * input reads 0.0119 and a quiet real utterance reads 0.1456, and two decimals
 * would collapse the first to a lying 0.01.
 */
export const formatInputLevel = (
  peak: number | null,
  rms: number | null,
): string | null => {
  if (peak === null || rms === null) return null;
  if (!Number.isFinite(peak) || !Number.isFinite(rms)) return null;
  return `${peak.toFixed(4)} / ${rms.toFixed(4)}`;
};

/**
 * Decode throughput as audio seconds per decode second, or null when no timed
 * local batch decode produced the run.
 *
 * Precision is chosen so a slow decode can never round to a lying `0.0x`:
 * anything at or above realtime carries one or two decimals (13.8x, 1.94x), and
 * anything below it carries two significant digits (0.043x).
 */
export const formatRealtimeFactor = (factor: number | null): string | null => {
  if (factor === null || !Number.isFinite(factor) || factor <= 0) return null;
  const digits =
    factor < 1 ? factor.toPrecision(2) : factor.toFixed(factor >= 10 ? 1 : 2);
  return `${digits}x`;
};

/** A model id is a repository path. The catalog owns the product name; until it
 * loads, the file's own stem is the most specific honest label a 70-character
 * path reduces to. */
export const shortenModelId = (modelId: string): string =>
  (modelId.split("/").pop() ?? modelId).replace(
    /\.(gguf|bin|safetensors)$/i,
    "",
  );

const push = (
  data: InstrumentDatum[],
  key: string,
  text: string | null,
  flags?: { identity?: true; absent?: true },
): void => {
  if (text === null || text.length === 0) return;
  data.push({ key, text, ...flags });
};

/**
 * The four cells, in the order directive §4 fixes them: what will transcribe,
 * what is being listened to, how it is triggered, and which mode is frozen into
 * the next run.
 */
export const buildInstrumentCells = (
  readings: InstrumentReadings,
  labels: InstrumentLabels,
): InstrumentCell[] => {
  const engine: InstrumentDatum[] = [];
  push(
    engine,
    "identity",
    readings.engineIsLocal ? readings.modelName : readings.engineLabel,
    { identity: true },
  );
  if (readings.engineIsLocal) {
    /* A cloud route has no local binding to report, so these are omitted
     * rather than shown as a state that will not run this capture. The
     * throughput goes with them: it measures a local decode, and attributing
     * one to a provider route would be a misreading of the same number. */
    push(engine, "backend", readings.backend);
    if (readings.modelLoaded !== null) {
      push(
        engine,
        "load",
        readings.modelLoaded ? labels.loaded : labels.unloaded,
      );
    }
    const throughput = formatRealtimeFactor(readings.realtimeFactor);
    push(
      engine,
      "rtf",
      throughput ?? labels.notMeasured,
      throughput === null ? { absent: true } : undefined,
    );
  }

  const input: InstrumentDatum[] = [];
  push(input, "device", readings.deviceName, { identity: true });
  push(
    input,
    "rate",
    labels.sampleRate(Math.round(CAPTURE_SAMPLE_RATE_HZ / 1000)),
  );
  if (readings.deviceChannels !== null) {
    push(input, "channels", labels.channels(readings.deviceChannels));
  }
  if (readings.selectedChannel !== null) {
    push(input, "channel", labels.channel(readings.selectedChannel));
  }
  const level = formatInputLevel(readings.inputPeak, readings.inputRms);
  push(
    input,
    "level",
    level ?? labels.notMeasured,
    level === null ? { absent: true } : undefined,
  );

  const shortcut: InstrumentDatum[] = [];
  if (readings.keys.length === 0) {
    push(shortcut, "unbound", labels.unbound);
  } else if (readings.pushToTalk !== null) {
    push(
      shortcut,
      "gesture",
      readings.pushToTalk ? labels.gestureTapHold : labels.gestureTap,
    );
  }

  const mode: InstrumentDatum[] = [];
  push(mode, "identity", readings.modeName, { identity: true });

  const cells: InstrumentCell[] = [
    { key: "engine", label: labels.engine, data: engine, reading: "" },
    { key: "input", label: labels.input, data: input, reading: "" },
    {
      key: "shortcut",
      label: labels.shortcut,
      data: shortcut,
      keys: readings.keys,
      reading: "",
    },
    { key: "mode", label: labels.mode, data: mode, reading: "" },
  ];

  for (const cell of cells) {
    const parts = [
      ...(cell.keys ?? []),
      ...cell.data.map((datum) => datum.text),
    ];
    cell.reading = `${cell.label} ${parts.join(" \u00b7 ")}`.trim();
  }
  return cells;
};

/* ------------------------------------------------------- recent activity */

export interface RecentActivityRow {
  key: string;
  /** Where opening the row goes. */
  section: "history" | "meetings";
  timestampMs: number;
  /** Mono line 1. Exactly one time value, always first. */
  facts: string[];
  /** Line 2: the text the run actually produced, truncated to one line by
   * CSS rather than by cutting the string. Empty when the run produced none. */
  snippet: string;
  /** The whole row as one string, for its `title`. */
  reading: string;
}

/** The labels the row mapping needs, as data. */
export interface RecentActivityLabels {
  meeting: string;
  words: (count: number) => string;
  /** Translated name of a `RequestedEngine`. */
  engine: (engine: string) => string;
  /** Translated name of a `MeetingPhase`. */
  phase: (phase: string) => string;
}

/**
 * The receipt that describes a history row: its newest run. Retries append
 * receipts rather than replacing them, so the last one is the state the entry
 * is actually in.
 */
export const newestReceipt = (
  receipts: HistoryRunReceipt[] | null | undefined,
): HistoryRunReceipt | null => {
  if (receipts === null || receipts === undefined || receipts.length === 0) {
    return null;
  }
  let newest = receipts[0];
  for (const receipt of receipts) {
    if (receipt.completed_at_ms >= newest.completed_at_ms) newest = receipt;
  }
  return newest;
};

/**
 * Merge dictations and meetings into one dense list, newest first.
 *
 * A dictation row reports the measurements its receipt carries; a meeting row
 * reports its phase, because a meeting has no transcript-level word count until
 * it finishes processing. Any datum the payload does not carry is dropped from
 * the line instead of being drawn as an empty column.
 */
export const buildRecentActivity = (
  history: HistoryEntry[],
  receiptsByHistoryId: ReadonlyMap<number, HistoryRunReceipt[] | null>,
  meetings: MeetingHistorySummary[],
  /* Structural rather than `ModeView`: the settings document holds
   * `ModeDefinition`s and the modes command hands back `ModeView`s, and the row
   * only ever needs the two fields both of them share. */
  modes: readonly { id: string; name: string }[],
  labels: RecentActivityLabels,
  nowMs: number,
): RecentActivityRow[] => {
  const rows: RecentActivityRow[] = [];

  for (const entry of history) {
    const timestampMs = entry.timestamp * 1000;
    const receipt = newestReceipt(receiptsByHistoryId.get(entry.id));
    const facts = [formatRelativeTime(timestampMs, nowMs)];
    if (receipt !== null) {
      if (receipt.duration_ms !== null) {
        facts.push(formatDurationShort(receipt.duration_ms / 1000));
      }
      if (receipt.word_count !== null) {
        facts.push(labels.words(receipt.word_count));
      }
      /* A deleted mode leaves only its id on the receipt, and the id is what
       * was frozen into the run, so the id is what the row reports. */
      facts.push(
        modes.find((mode) => mode.id === receipt.mode.mode_id)?.name ??
          receipt.mode.mode_id,
      );
      facts.push(
        labels.engine(
          receipt.mode.engine_used ?? receipt.mode.engine_requested ?? "local",
        ),
      );
    }
    const snippet = (
      entry.post_processed_text ??
      entry.transcription_text ??
      ""
    ).trim();
    rows.push({
      key: `history-${entry.id}`,
      section: "history",
      timestampMs,
      facts,
      snippet,
      reading: [facts.join(" \u00b7 "), snippet].filter(Boolean).join(" — "),
    });
  }

  for (const meeting of meetings) {
    const facts = [
      formatRelativeTime(meeting.created_at_utc_ms, nowMs),
      labels.meeting,
      labels.phase(meeting.phase),
    ];
    rows.push({
      key: `meeting-${meeting.session_id}`,
      section: "meetings",
      timestampMs: meeting.created_at_utc_ms,
      facts,
      snippet: meeting.title.trim(),
      reading: [facts.join(" \u00b7 "), meeting.title.trim()]
        .filter(Boolean)
        .join(" — "),
    });
  }

  rows.sort((left, right) => right.timestampMs - left.timestampMs);
  return rows;
};

/* ---------------------------------------------------------- empty states */

/**
 * One command that did not answer. `detail` is the error the backend gave, kept
 * verbatim; null when the command reports failure without a message, in which
 * case naming the command is the whole of what is known.
 */
export interface ReadFailure {
  command: string;
  detail: string | null;
}

/**
 * What a failed command's payload may be. Named rather than `unknown` because
 * the boundary is known: Tauri rejects with an `Error`, a command's own error
 * type is either a string union or `null`, and nothing else reaches here.
 */
export type FailureReason = Error | string | null | undefined;

/**
 * The shapes a failed command can hand back. A rejected Tauri invoke rejects
 * with an `Error`; a command whose own error type is a string union resolves
 * with that string; a command whose error type is `null` carries nothing. Any
 * other value has no message to show, and inventing one would be worse than
 * naming only the command.
 */
const REJECTION_MESSAGE = z.union([
  z.string().min(1),
  z.instanceof(Error).transform((error) => error.message),
]);

/** The message a failed command actually carried, kept verbatim, or null. */
export const rejectionDetail = (reason: FailureReason): string | null => {
  const parsed = REJECTION_MESSAGE.safeParse(reason);
  if (!parsed.success) return null;
  return parsed.data.length === 0 ? null : parsed.data;
};

/**
 * What a settled command means for the region it fills. A command that answered
 * successfully with nothing is not a failure, and must never be reported as
 * one: the backend now succeeds on a healthy install, so "could not be loaded"
 * on an empty range was a false alarm.
 */
export const readFailure = (
  command: string,
  settled: PromiseSettledResult<
    { status: "ok" } | { status: "error"; error: FailureReason }
  >,
): ReadFailure | null => {
  if (settled.status === "rejected") {
    return { command, detail: rejectionDetail(settled.reason) };
  }
  if (settled.value.status === "error") {
    return { command, detail: rejectionDetail(settled.value.error) };
  }
  return null;
};
