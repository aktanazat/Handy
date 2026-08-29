import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import type { StreamEngine, StreamTextEvent } from "@/bindings";
import { Kbd } from "@/components/ui/Kbd";
import { formatDurationShort } from "@/lib/utils/format";
import type { LanguageDirection } from "@/lib/utils/rtl";
import type { OverlayPosition } from "@/lib/powerPackApi";
import type { RecordingErrorEvent } from "@/lib/types/events";
import type { HudFrame, HudPhase } from "./hudMachine";
import { HudPill } from "./HudPill";

interface RecordingOverlayContentProps {
  isVisible: boolean;
  hud: HudPhase;
  /**
   * The window the HUD is being drawn into. `pill` is 184x36 and holds one line;
   * `compact` and `stream` hold the two-line instrument row.
   */
  frame: HudFrame;
  /** The mic-level buckets exactly as the recorder reported them. */
  levels: number[];
  streamText: StreamTextEvent;
  engine: StreamEngine;
  /** Null until the input stream has delivered its first buffer. */
  elapsedSeconds: number | null;
  modeName: string | null;
  /** One entry per physical key of the stop chord; empty when unknown. */
  stopKeys: string[];
  error: RecordingErrorEvent | null;
  session: number;
  position: OverlayPosition;
  direction: LanguageDirection;
  capRef: RefObject<HTMLDivElement>;
  onStreamScroll: () => void;
}

/**
 * Bar count held before the first `mic-level` event, so the meter's geometry is
 * the same in `starting` as it is in `listening` and the row never reflows when
 * real values start arriving. The recorder's visualiser publishes 16 buckets
 * (`audio_toolkit/audio/recorder.rs`, `const BUCKETS`).
 */
const RESTING_METER_BARS: number[] = Array(16).fill(0);

/**
 * Every `error_type` `actions.rs` and `command_mode.rs` emit, mapped to the
 * short `errors.*Title` string for that condition. The three that already had a
 * title are reused as-is — App.tsx toasts the same keys — and the rest follow
 * the file's existing `<condition>Title` + `<condition>` sentence convention, so
 * a toast can adopt them later without a second string appearing.
 *
 * An unlisted cause deliberately renders no cause line rather than its token.
 */
const ERROR_TITLE_KEYS = {
  no_speech_detected: "errors.noSpeechDetectedTitle",
  microphone_permission_denied: "errors.micPermissionDeniedTitle",
  no_input_device: "errors.noInputDeviceTitle",
  no_model_selected: "errors.noModelSelectedTitle",
  no_speech_save_failed: "errors.noSpeechSaveFailedTitle",
  capture_overrun: "errors.captureOverrunTitle",
  cloud_unavailable: "errors.cloudUnavailableTitle",
  cloud_transcription_held: "errors.cloudTranscriptionHeldTitle",
  command_no_selection: "errors.commandNoSelectionTitle",
  command_rewrite_unavailable: "errors.commandRewriteUnavailableTitle",
} satisfies Record<string, string>;

/** The short title for one emitted `error_type`, or undefined when the app has
 * no words for that cause yet. */
const errorTitleKey = (token: string): string | undefined => {
  if (!(token in ERROR_TITLE_KEYS)) return undefined;
  /* SAFETY: the `in` check just established that the token is one of this
     object's own keys, which is exactly what the index needs. */
  return ERROR_TITLE_KEYS[token as keyof typeof ERROR_TITLE_KEYS];
};

/**
 * Display gamma for one reported bucket. Level meters are read logarithmically;
 * without it everything below half scale collapses onto the baseline. The map is
 * monotonic, so bar order and bar ranking still carry the reported values. The
 * 0.06 floor is the baseline tick a silent channel draws — a zero bucket shows
 * as a hairline, never as nothing.
 */
const barScale = (level: number): number =>
  Math.max(0.06, Math.min(1, Math.pow(Math.max(0, level), 0.7)));

export const RecordingOverlayContent = ({
  isVisible,
  hud,
  frame,
  levels,
  streamText,
  engine,
  elapsedSeconds,
  modeName,
  stopKeys,
  error,
  session,
  position,
  direction,
  capRef,
  onStreamScroll,
}: RecordingOverlayContentProps) => {
  const { t } = useTranslation();

  if (!isVisible) return null;

  const stateLabel = {
    idle: t("overlay.hud.idle", "Ready"),
    starting: t("overlay.state.starting", "Starting"),
    listening: t("overlay.state.listening", "Listening"),
    transcribing: t("overlay.state.transcribing", "Transcribing"),
    processing: t("overlay.state.processing", "Processing"),
    error: t("overlay.state.failed", "Failed"),
  }[hud];

  /* A failure states the cause, in the app's own words for that cause. The
   * `error_type` values are semantic (`no_model_selected`, `capture_overrun`),
   * so the cause is known — but a snake_case token on screen is the opacity the
   * "no apology copy, say exactly what failed" rule exists to ban. These are the
   * same conditions App.tsx toasts, keyed to the short `errors.*Title` form of
   * each, so the HUD and the toast cannot drift. A cause with no short form
   * shows no second line: "Failed" is an honest summary, the token is not. */
  const errorLabelKey = error && errorTitleKey(error.error_type);
  const errorText = errorLabelKey ? t(errorLabelKey) : "";

  /* The resting window holds 176x28. A failure that lands after the backend has
   * already rested the overlay to its pill therefore renders as a one-line pill
   * — the same shell, the semaphore in red, and the error id in place of the
   * mode name. Drawing the two-line row here would be clipped by the window. */
  if (frame === "pill") {
    if (hud === "error") {
      return (
        <div dir={direction} className={`ov-stage ${position} ov-fade show`}>
          <div
            className="scard compact hud-pill hud-error"
            data-testid="hud-error-pill"
          >
            <span className="sring" aria-hidden="true" />
            <span className="serror type-data" role="alert">
              {errorText}
            </span>
          </div>
        </div>
      );
    }
    return (
      <HudPill position={position} direction={direction} modeName={modeName} />
    );
  }

  const working = hud === "transcribing" || hud === "processing";
  const metering = hud === "starting" || hud === "listening";
  const stopTitle = t("overlay.stopHint", {
    defaultValue: "Press {{keys}} to stop",
    keys: stopKeys.join(" "),
  });

  /* The meter is the content while audio is flowing: reported buckets, drawn as
   * transforms with no transition, so a bar can only ever sit at a value the
   * recorder actually published. While the stream is still opening the same
   * geometry is dimmed and pulses instead — an acknowledgement of the keypress
   * that cannot be mistaken for a level. */
  const meter = (
    <div
      className={`swave ${hud === "listening" ? "ready snap-measured" : "arming"}`}
      role="img"
      aria-label={t("overlay.inputLevel", "Input level")}
    >
      {(levels.length > 0 ? levels : RESTING_METER_BARS).map((level, index) => (
        <i key={index} style={{ transform: `scaleY(${barScale(level)})` }} />
      ))}
    </div>
  );

  const engineLabel =
    engine === "cloud"
      ? t("overlay.cloud", "Cloud")
      : engine === "local_fallback"
        ? t("overlay.engineFallbackShort", "Local fallback")
        : null;

  const detailLine = errorText ? (
    <span className="serror type-data" role="alert">
      {errorText}
    </span>
  ) : null;

  const instrumentRow = (
    <div className="sbase">
      <div
        className="sline"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="sring" aria-hidden="true" />
        <span className="sstate microlabel">{stateLabel}</span>
        {/* A failed run is not working, so it spins nothing; the slot collapses
            and the elapsed capture length keeps its place on the right. */}
        {metering && meter}
        {working && <span className="sspinner" aria-hidden="true" />}
        {elapsedSeconds !== null && (
          <span className="stimer type-data snap-measured">
            {formatDurationShort(elapsedSeconds)}
          </span>
        )}
      </div>
      <div className="sline sline-meta">
        {detailLine ?? (
          <>
            {modeName && (
              <span className="smode type-secondary">{modeName}</span>
            )}
            {engineLabel && (
              <span className="sengine microlabel" data-engine={engine}>
                {engineLabel}
              </span>
            )}
            {stopKeys.length > 0 && (
              <span className="shint" title={stopTitle} aria-label={stopTitle}>
                {stopKeys.map((key, index) => (
                  <Kbd key={`${key}-${index}`}>{key}</Kbd>
                ))}
              </span>
            )}
          </>
        )}
      </div>
      {hud !== "error" && (
        <button
          className="sx"
          aria-label={t("common.cancel")}
          onClick={() => commands.cancelOperation()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4 L12 12 M12 4 L4 12"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );

  /* Solid in both materials, by ruling: the level meter's legibility is the
   * instrument's whole job, and a tint that lets unblurred wallpaper through
   * contests exactly the thing the recording HUD exists to show. Glass lives on
   * the idle pill only, where nothing measured is drawn. */
  if (frame === "stream") {
    const hasText =
      streamText.committed.length > 0 || streamText.tentative.length > 0;

    return (
      <div dir={direction} className={`ov-stage ${position}`}>
        <div
          key={session}
          className={["scard", `hud-${hud}`, hasText && "open"]
            .filter(Boolean)
            .join(" ")}
          data-testid="hud-card"
        >
          <div className="stext">
            <div className="stext-clip">
              <div
                className="stext-cap type-body"
                ref={capRef}
                onScroll={onStreamScroll}
              >
                <p>
                  <span className="committed">
                    {streamText.committed ? `${streamText.committed} ` : ""}
                  </span>
                  <span className="tentative">{streamText.tentative}</span>
                  {!working && <span className="scaret" />}
                </p>
              </div>
            </div>
          </div>
          {instrumentRow}
        </div>
      </div>
    );
  }

  return (
    <div dir={direction} className={`ov-stage ${position} ov-fade show`}>
      <div className={`scard compact hud-${hud}`} data-testid="hud-card">
        {instrumentRow}
      </div>
    </div>
  );
};
