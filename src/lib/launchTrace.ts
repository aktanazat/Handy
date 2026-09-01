import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const FIRST_DOM_PAINT_EVENT = "launch:first-dom-paint";
const FIRST_VISIBLE_FRAME_EVENT = "launch:first-visible-frame";
const SHELL_VISIBLE_EVENT = "launch:shell-visible";
const BACKEND_READY_EVENT = "launch:backend-ready";

let domPaintReported = false;
let visibleFrameScheduled = false;
let resolveVisibleFrame!: () => void;
const visibleFrame = new Promise<void>((resolve) => {
  resolveVisibleFrame = resolve;
});
let resolveBackendReady!: () => void;
const backendReady = new Promise<void>((resolve) => {
  resolveBackendReady = resolve;
});
let stopBackendListener: (() => void) | undefined;
let backendListenerReady: Promise<void> | undefined;

const ensureBackendListener = () => {
  backendListenerReady ??= listen(BACKEND_READY_EVENT, () => {
    stopBackendListener?.();
    resolveBackendReady();
  }).then((unlisten) => {
    stopBackendListener = unlisten;
  });
  return backendListenerReady;
};

const scheduleVisibleFrame = () => {
  if (visibleFrameScheduled) return;
  visibleFrameScheduled = true;
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    window.clearTimeout(fallback);
    performance.mark("sona:first-visible-frame");
    void emit(
      FIRST_VISIBLE_FRAME_EVENT,
      performance.timeOrigin + performance.now(),
    ).then(resolveVisibleFrame, resolveVisibleFrame);
  };
  const fallback = window.setTimeout(report, 100);
  requestAnimationFrame(() => requestAnimationFrame(report));
};

const scheduleWhenWindowIsVisible = async () => {
  let stopListening: (() => void) | undefined;
  const listenerReady = listen(SHELL_VISIBLE_EVENT, () => {
    stopListening?.();
    scheduleVisibleFrame();
  });
  stopListening = await listenerReady;
  if (await getCurrentWindow().isVisible()) {
    stopListening();
    scheduleVisibleFrame();
  }
};

export const reportFirstDomPaint = () => {
  if (domPaintReported) return;
  domPaintReported = true;
  performance.mark("sona:first-dom-paint");
  const paintEpochMs = performance.timeOrigin + performance.now();
  void ensureBackendListener()
    .then(async () => {
      await scheduleWhenWindowIsVisible();
      return emit(FIRST_DOM_PAINT_EVENT, paintEpochMs);
    })
    .catch(() => undefined);
};

export const waitForBackendReady = () => {
  void ensureBackendListener();
  return backendReady;
};

export const waitForFirstVisibleFrame = () => visibleFrame;
