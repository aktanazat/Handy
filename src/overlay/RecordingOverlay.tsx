import React, { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import "./RecordingOverlay.css";
import { commands } from "@/bindings";
import type {
  StreamEngine,
  StreamPhase,
  StreamPhaseEvent,
  StreamTextEvent,
  StreamWorkKind,
} from "@/bindings";
import { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";
import { subscribeToOverlayEvents, type OverlayState } from "./overlayEvents";
import { RecordingOverlayContent } from "./RecordingOverlayContent";

// Number of reactive bars in the waveform (the simple, smoothed style shared by
// every overlay form). Mic levels arrive as 16 FFT buckets; we take the first N.
const WAVE_BARS = 9;
const INITIAL_SMOOTHED_LEVELS = Array(16).fill(0);

interface OverlayViewState {
  isVisible: boolean;
  state: OverlayState;
  captureReady: boolean;
  levels: number[];
  streamText: StreamTextEvent;
  phase: StreamPhase;
  workKind: StreamWorkKind;
  engine: StreamEngine;
  elapsed: number;
  session: number;
  position: "top" | "bottom";
  overflowing: boolean;
}

type OverlayViewAction = (state: OverlayViewState) => OverlayViewState;

const INITIAL_OVERLAY_VIEW_STATE: OverlayViewState = {
  isVisible: false,
  state: "recording",
  captureReady: false,
  levels: Array(WAVE_BARS).fill(0),
  streamText: { committed: "", tentative: "" },
  phase: "listening",
  workKind: "transcribing",
  engine: "local",
  elapsed: 0,
  session: 0,
  position: "bottom",
  overflowing: false,
};

const overlayViewReducer = (
  state: OverlayViewState,
  action: OverlayViewAction,
) => action(state);

const RecordingOverlay: React.FC = () => {
  const { i18n } = useTranslation();
  const [overlay, dispatchOverlay] = useReducer(
    overlayViewReducer,
    INITIAL_OVERLAY_VIEW_STATE,
  );
  const {
    isVisible,
    state,
    captureReady,
    levels,
    streamText,
    phase,
    workKind,
    engine,
    elapsed,
    session,
    position,
    overflowing,
  } = overlay;

  const smoothedLevelsRef = useRef<number[]>(INITIAL_SMOOTHED_LEVELS);
  const disposedRef = useRef(false);
  // Live-text scroll-back: the text region "sticks" to the newest line while the
  // user is at the bottom; if they scroll up to read history, auto-follow pauses
  // until they scroll back down.
  const capRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const direction = getLanguageDirection(i18n.language);

  useEffect(() => {
    disposedRef.current = false;
    const subscriptions = subscribeToOverlayEvents({
      onShow: async (overlayState) => {
        if (disposedRef.current) return;
        if (overlayState === "recording" || overlayState === "streaming") {
          dispatchOverlay((current) => ({
            ...current,
            captureReady: false,
            levels: Array(WAVE_BARS).fill(0),
            streamText: { committed: "", tentative: "" },
          }));
          smoothedLevelsRef.current = Array(16).fill(0);
        }

        await syncLanguageFromSettings();
        if (disposedRef.current) return;

        try {
          const settings = await commands.getAppSettings();
          if (!disposedRef.current && settings.status === "ok") {
            dispatchOverlay((current) => ({
              ...current,
              position:
                settings.data.overlay_position === "top" ? "top" : "bottom",
            }));
          }
        } catch {
          // Keep the previous/default placement if settings can't be read.
        }

        if (disposedRef.current) return;
        if (overlayState === "streaming") {
          dispatchOverlay((current) => ({
            ...current,
            isVisible: true,
            state: overlayState,
            phase: "listening",
            workKind: "transcribing",
            engine: "local",
            elapsed: 0,
            session: current.session + 1,
          }));
        } else {
          dispatchOverlay((current) => ({
            ...current,
            isVisible: true,
            state: overlayState,
          }));
        }
      },
      onHide: () => {
        if (disposedRef.current) return;
        dispatchOverlay((current) => ({
          ...current,
          isVisible: false,
          captureReady: false,
        }));
      },
      onRecordingReady: () => {
        if (disposedRef.current) return;
        dispatchOverlay((current) => ({
          ...current,
          elapsed: 0,
          captureReady: true,
        }));
      },
      onMicLevel: (level) => {
        if (disposedRef.current) return;
        const smoothed = smoothedLevelsRef.current.map((previous, index) => {
          const target = level[index] || 0;
          return previous * 0.7 + target * 0.3;
        });
        smoothedLevelsRef.current = smoothed;
        dispatchOverlay((current) => ({
          ...current,
          levels: smoothed.slice(0, WAVE_BARS),
        }));
      },
      onStreamText: (text) => {
        if (!disposedRef.current) {
          dispatchOverlay((current) => ({ ...current, streamText: text }));
        }
      },
      onStreamPhase: (streamPhase: StreamPhaseEvent) => {
        if (disposedRef.current) return;
        dispatchOverlay((current) => ({
          ...current,
          phase: streamPhase.phase,
          workKind: streamPhase.kind ?? current.workKind,
        }));
      },
      onStreamEngine: (streamEngine) => {
        if (!disposedRef.current) {
          dispatchOverlay((current) => ({
            ...current,
            engine: streamEngine.engine,
          }));
        }
      },
    });

    return () => {
      disposedRef.current = true;
      for (const subscription of subscriptions) {
        void subscription.then(
          (unlisten) => unlisten(),
          (error) => console.error("Overlay event subscription failed:", error),
        );
      }
    };
  }, []);

  // Elapsed capture timer starts only once microphone samples are flowing.
  useEffect(() => {
    if (state !== "streaming" || !isVisible || !captureReady) return;
    const id = setInterval(
      () =>
        dispatchOverlay((current) => ({
          ...current,
          elapsed: current.elapsed + 1,
        })),
      1000,
    );
    return () => clearInterval(id);
  }, [state, isVisible, captureReady]);

  // Stick to the bottom as text streams in — but only while pinned, so a user who
  // has scrolled up to read history isn't yanked back down by the next chunk.
  useLayoutEffect(() => {
    const el = capRef.current;
    if (!el) return;
    // Fade the top edge only once text actually overflows the cap.
    const nextOverflowing = el.scrollHeight > el.clientHeight + 1;
    dispatchOverlay((current) =>
      current.overflowing === nextOverflowing
        ? current
        : { ...current, overflowing: nextOverflowing },
    );
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [streamText]);

  // Each fresh streaming session starts pinned to the bottom, fade cleared.
  useEffect(() => {
    pinnedRef.current = true;
    dispatchOverlay((current) =>
      current.overflowing ? { ...current, overflowing: false } : current,
    );
  }, [session]);

  // Re-pin when the user is within ~a line of the bottom; unpin otherwise.
  const handleStreamScroll = () => {
    const element = capRef.current;
    if (!element) return;
    pinnedRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <= 16;
  };

  return (
    <RecordingOverlayContent
      isVisible={isVisible}
      state={state}
      captureReady={captureReady}
      levels={levels}
      streamText={streamText}
      phase={phase}
      workKind={workKind}
      engine={engine}
      elapsed={elapsed}
      session={session}
      position={position}
      overflowing={overflowing}
      direction={direction}
      capRef={capRef}
      onStreamScroll={handleStreamScroll}
    />
  );
};

export default RecordingOverlay;
