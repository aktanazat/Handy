import type { CSSProperties, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import type { StreamTextEvent } from "@/bindings";
import { SonaMark } from "@/components/icons/SonaMark";
import type { LanguageDirection } from "@/lib/utils/rtl";
import type { OverlayPosition } from "@/lib/powerPackApi";
import type { RecordingErrorEvent } from "@/lib/types/events";
import type { HudFrame, HudPhase } from "./hudMachine";
import { HudPill } from "./HudPill";

interface RecordingOverlayContentProps {
  isVisible: boolean;
  hud: HudPhase;
  /**
   * The window the HUD is being drawn into. `pill` is 184x36 and holds the idle
   * mode switcher; `compact` and `stream` hold the instrument row — the mark on
   * the leading edge and the meter on the trailing one, nothing else.
   */
  frame: HudFrame;
  /** The mic-level buckets exactly as the recorder reported them. */
  levels: number[];
  streamText: StreamTextEvent;
  modeName: string | null;
  error: RecordingErrorEvent | null;
  session: number;
  position: OverlayPosition;
  direction: LanguageDirection;
  /* React 19: `useRef<HTMLDivElement>(null)` yields `RefObject<T | null>`, so
   * the null is part of the type rather than something the caller asserts away. */
  capRef: RefObject<HTMLDivElement | null>;
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
 * An unlisted cause deliberately renders the plain "Failed" summary rather than
 * its token.
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

/**
 * The reported bucket level at which the meter stops being ink and becomes the
 * accent — the one colour event on this surface, and the whole answer to "is it
 * hearing me".
 *
 * Derived from the visualiser's own calibration
 * (`audio_toolkit/audio/visualizer.rs`: a bucket is
 * `((db + 68) / 38 * 1.3) ^ 0.7`, calibrated against measured mic audio at
 * dictation ~-32 and room tone ~-48 on that scale). Dictation saturates the
 * window and clamps to 1.0; room tone lands near 0.77. 0.9 sits between them,
 * so the tint means "a bucket is at the top of the calibrated speech range" and
 * a humming room cannot claim it.
 */
const SPEECH_PEAK = 0.9;

/**
 * Whether the reported frame carries speech. A loop rather than
 * `Math.max(...levels)`: this runs on every `mic-level` event, and the spread
 * allocates an argument list per frame to answer a question one comparison
 * settles.
 */
const hearingSpeech = (levels: number[]): boolean => {
  for (const level of levels) {
    if (level >= SPEECH_PEAK) return true;
  }
  return false;
};

/**
 * React's `CSSProperties` has no slot for a custom property, and the working
 * state's traveling highlight needs every bar to know its own position in the
 * row. Declaring the property rather than casting keeps the style object typed.
 */
interface BarStyle extends CSSProperties {
  "--bar-index"?: number;
}

export const RecordingOverlayContent = ({
  isVisible,
  hud,
  frame,
  levels,
  streamText,
  modeName,
  error,
  session,
  position,
  direction,
  capRef,
  onStreamScroll,
}: RecordingOverlayContentProps) => {
  const { t } = useTranslation();

  if (!isVisible) return null;

  /* The HUD says nothing out loud. Every state is carried by the meter — dim
   * and pulsing while the stream opens, live accent bars once buckets arrive,
   * dim and travelling while the transcriber works — so the state word exists
   * only for a screen reader, which cannot see any of that. */
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
   * falls back to "Failed": an honest summary, where the token is not. */
  const errorLabelKey = error && errorTitleKey(error.error_type);
  const failureText = (errorLabelKey && t(errorLabelKey)) || stateLabel;

  /* The resting window holds 176x28. A failure that lands after the backend has
   * already rested the overlay to its pill therefore renders as the pill: the
   * same shell and the same mark, with the cause in place of the mode name. */
  if (frame === "pill") {
    if (hud === "error") {
      return (
        <div dir={direction} className={`ov-stage ${position} ov-fade show`}>
          <div
            className="scard compact hud-pill hud-error"
            data-testid="hud-error-pill"
          >
            <SonaMark className="smark" width={16} height={16} />
            <span className="serror" role="alert">
              {failureText}
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
  const failed = hud === "error";

  /* Three meters, one geometry. `ready` is the only one carrying reported
   * values, so it is the only one marked measured — the other two are display
   * states and are allowed to move. `hearing` rides on `ready` alone: it is a
   * statement about the buckets in hand, and neither an opening stream nor a
   * running transcriber has any. */
  const waveMode = working
    ? "working"
    : hud === "listening"
      ? `ready snap-measured${hearingSpeech(levels) ? " hearing" : ""}`
      : "arming";

  /* The meter is the content. Reported buckets are drawn as transforms with no
   * transition, so a bar can only ever sit at a value the recorder actually
   * published. While the transcriber works there is no reported value at all,
   * so no transform is emitted and CSS holds every bar at one fixed low scale —
   * the row is visibly running without inventing a level. */
  const meter = (
    <div
      className={`swave ${waveMode}`}
      /* While the transcriber works the row is no longer a meter — nothing is
       * being reported through it — so it stops claiming to be one and the
       * status span carries the state instead. */
      role={working ? undefined : "img"}
      aria-hidden={working || undefined}
      aria-label={working ? undefined : t("overlay.inputLevel", "Input level")}
    >
      {(levels.length > 0 ? levels : RESTING_METER_BARS).map((level, index) => {
        const style: BarStyle = working
          ? { "--bar-index": index }
          : { transform: `scaleY(${barScale(level)})` };
        return <i key={index} style={style} />;
      })}
    </div>
  );

  const instrumentRow = (
    <div className="sbase">
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {stateLabel}
      </span>
      <SonaMark className="smark" width={16} height={16} />
      {failed ? (
        <span className="serror" role="alert">
          {failureText}
        </span>
      ) : (
        meter
      )}
      {/* Nothing to cancel once the run has failed. The button is the one thing
          the pill hides until it is asked for: it rides the meter's trailing end
          on hover, so at rest the row is only the mark and the wave.

          Hover is the only way to reach it. The overlay is a nonactivating
          panel that never takes keyboard focus (overlay.rs: focusable(false),
          can_become_key_window false), which is what keeps the app being
          dictated into in front, so the :focus-visible rule beside the hover
          one in RecordingOverlay.css cannot fire here. Cancelling by keyboard
          is the shortcut's job. */}
      {!failed && (
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
              <div className="stext-cap" ref={capRef} onScroll={onStreamScroll}>
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
