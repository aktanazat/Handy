import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { events } from "@/bindings";
import type {
  StreamEngineEvent,
  StreamPhaseEvent,
  StreamTextEvent,
} from "@/bindings";

/**
 * `idle` is the always-visible HUD pill: unlike the four transient states it is
 * not driven by a dictation, and the backend returns the overlay to it instead
 * of hiding when the pill is enabled.
 */
export type OverlayState =
  | "idle"
  | "recording"
  | "streaming"
  | "transcribing"
  | "processing";

interface OverlayEventHandlers {
  onShow: (state: OverlayState) => void | Promise<void>;
  onHide: () => void;
  onRecordingReady: () => void;
  onMicLevel: (levels: number[]) => void;
  onStreamText: (text: StreamTextEvent) => void;
  onStreamPhase: (phase: StreamPhaseEvent) => void;
  onStreamEngine: (engine: StreamEngineEvent) => void;
}

/**
 * Translate Tauri events into the overlay's explicit handlers. This module owns
 * registration only; RecordingOverlay owns state transitions and the caller
 * owns the returned cleanup functions.
 */
export const subscribeToOverlayEvents = ({
  onShow,
  onHide,
  onRecordingReady,
  onMicLevel,
  onStreamText,
  onStreamPhase,
  onStreamEngine,
}: OverlayEventHandlers): Array<Promise<UnlistenFn>> => [
  listen<OverlayState>("show-overlay", (event) => onShow(event.payload)),
  listen("hide-overlay", onHide),
  listen("recording-ready", onRecordingReady),
  listen<number[]>("mic-level", (event) => onMicLevel(event.payload)),
  events.streamTextEvent.listen((event) => onStreamText(event.payload)),
  events.streamPhaseEvent.listen((event) => onStreamPhase(event.payload)),
  events.streamEngineEvent.listen((event) => onStreamEngine(event.payload)),
];
