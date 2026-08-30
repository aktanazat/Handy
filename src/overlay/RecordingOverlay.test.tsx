import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import {
  deriveElapsedSeconds,
  deriveHudFrame,
  deriveHudPhase,
  hudCaptureReady,
  hudFailed,
  hudHidden,
  hudRested,
  hudShown,
  hudStreamPhaseChanged,
  INITIAL_HUD_STATE,
  type HudFrame,
  type HudPhase,
} from "./hudMachine";
import { RecordingOverlayContent } from "./RecordingOverlayContent";

/* The HUD is the surface a user watches while they are speaking, so the thing
 * under test is that its five states are each unmistakable — and specifically
 * that `starting` can never be read as `listening`. The microphone stream takes
 * 140-215 ms to open (unbounded on Bluetooth) and the overlay is on screen for
 * all of it; a user who talks into that window loses the head of the utterance.
 *
 * Theme and material are root attributes resolved in CSS, so what is asserted
 * here is that every colour arrives through a `hud-<phase>` token hook and no
 * state hardcodes one. The rendered appearance in dark/light x solid/glass is
 * screenshot work for the parent. */

const localeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
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
    en: { translation: JSON.parse(fs.readFileSync(localeRoot, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

/* One reported frame: 16 buckets, the count `recorder.rs` publishes. */
const LEVELS = [
  0, 0.25, 1, 0.5, 0, 0.81, 0.09, 0.64, 0.12, 0.33, 0.71, 0.02, 0.9, 0.44, 0.18,
  0.55,
];

/* A quiet room, one frame: real reported buckets, every one of them below the
 * top of the visualiser's calibrated speech window (~0.77 there against ~1.0
 * clamped for dictation). This is the frame that must NOT read as speech. */
const ROOM_TONE = [
  0.31, 0.42, 0.58, 0.55, 0.49, 0.61, 0.44, 0.52, 0.38, 0.47, 0.5, 0.36, 0.29,
  0.33, 0.27, 0.24,
];

interface HudCase {
  hud: HudPhase;
  levels?: number[];
  error?: { error_type: string; detail?: string };
  frame?: HudFrame;
}

const render = ({
  hud,
  levels = [],
  error = undefined,
  frame = "compact",
}: HudCase): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <RecordingOverlayContent
        isVisible
        hud={hud}
        frame={frame}
        levels={levels}
        streamText={{ committed: "", tentative: "" }}
        modeName="Email"
        error={error ?? null}
        session={1}
        position="bottom"
        direction="ltr"
        capRef={{ current: null }}
        onStreamScroll={() => {}}
      />
    </I18nextProvider>,
  );

/* Text a user can actually see. The state word is rendered into a
 * visually-hidden span for screen readers, so a plain `toContain` cannot tell
 * "the HUD shows the word Listening" from "the HUD announces it". */
const visibleText = (markup: string): string =>
  markup.replace(/<span class="sr-only"[^>]*>.*?<\/span>/g, "");

describe("the HUD state machine", () => {
  test("withholds listening until the recorder reports its first buffer", () => {
    const shown = hudShown(INITIAL_HUD_STATE, "recording");
    expect(deriveHudPhase(shown)).toBe("starting");
    expect(deriveElapsedSeconds(shown)).toBe(null);

    const live = hudCaptureReady(shown, 1_000);
    expect(deriveHudPhase(live)).toBe("listening");
    expect(deriveElapsedSeconds({ ...live, nowMs: 8_000 })).toBe(7);
  });

  test("a fresh show re-arms readiness, so a second run cannot inherit it", () => {
    const live = hudCaptureReady(hudShown(INITIAL_HUD_STATE, "recording"), 1);
    const again = hudShown(live, "recording");
    expect(again.captureReady).toBe(false);
    expect(again.readyAt).toBe(null);
    expect(deriveHudPhase(again)).toBe("starting");
  });

  test("splits the streaming card's working phase by its work kind", () => {
    const live = hudCaptureReady(hudShown(INITIAL_HUD_STATE, "streaming"), 1);
    expect(deriveHudPhase(live)).toBe("listening");
    expect(
      deriveHudPhase(hudStreamPhaseChanged(live, { phase: "working" })),
    ).toBe("transcribing");
    expect(
      deriveHudPhase(
        hudStreamPhaseChanged(live, { phase: "working", kind: "polishing" }),
      ),
    ).toBe("processing");
  });

  test("maps the compact backend states onto transcribing and processing", () => {
    expect(deriveHudPhase(hudShown(INITIAL_HUD_STATE, "transcribing"))).toBe(
      "transcribing",
    );
    expect(deriveHudPhase(hudShown(INITIAL_HUD_STATE, "processing"))).toBe(
      "processing",
    );
  });

  test("the elapsed readout freezes at the capture's real end", () => {
    const live = hudCaptureReady(hudShown(INITIAL_HUD_STATE, "recording"), 1);
    const stopped = hudShown(live, "transcribing");
    expect(stopped.nowMs >= live.nowMs).toBe(true);
    // Frozen: the clock's origin survives, so the number stops moving.
    expect(stopped.readyAt).toBe(1);
  });

  /* actions.rs emits `recording-error` and calls `hide_recording_overlay` back
   * to back, so both land in the same tick. A hide must therefore record where
   * to rest rather than tear an unread failure off the screen. */
  test("the hide that follows a failure does not tear the failure down", () => {
    const failed = hudFailed(
      hudCaptureReady(hudShown(INITIAL_HUD_STATE, "recording"), 1),
      { error_type: "no_speech_detected" },
    );
    expect(deriveHudPhase(failed)).toBe("error");

    const hidden = hudHidden(failed);
    expect(hidden.isVisible).toBe(true);
    expect(hidden.restAfterError).toBe("hide");
    expect(deriveHudPhase(hidden)).toBe("error");

    const rested = hudRested(hidden);
    expect(rested.isVisible).toBe(false);
    expect(rested.error).toBe(null);
  });

  test("resting into the pill holds the failure, then reveals the pill", () => {
    const failed = hudFailed(hudShown(INITIAL_HUD_STATE, "recording"), {
      error_type: "capture_overrun",
    });
    const resting = hudShown(failed, "idle");
    expect(deriveHudPhase(resting)).toBe("error");
    expect(deriveHudFrame(resting)).toBe("pill");

    const rested = hudRested(resting);
    expect(rested.isVisible).toBe(true);
    expect(deriveHudPhase(rested)).toBe("idle");
  });

  test("a new dictation retires a failure the user never read", () => {
    const failed = hudFailed(hudShown(INITIAL_HUD_STATE, "recording"), {
      error_type: "capture_overrun",
    });
    expect(deriveHudPhase(hudShown(failed, "recording"))).toBe("starting");
  });

  test("an ordinary hide clears the capture without leaving a clock behind", () => {
    const hidden = hudHidden(
      hudCaptureReady(hudShown(INITIAL_HUD_STATE, "recording"), 1),
    );
    expect(hidden.isVisible).toBe(false);
    expect(deriveElapsedSeconds(hidden)).toBe(null);
  });

  test("each backend state names the window it is drawn into", () => {
    expect(deriveHudFrame(hudShown(INITIAL_HUD_STATE, "recording"))).toBe(
      "compact",
    );
    expect(deriveHudFrame(hudShown(INITIAL_HUD_STATE, "streaming"))).toBe(
      "stream",
    );
    expect(deriveHudFrame(hudShown(INITIAL_HUD_STATE, "idle"))).toBe("pill");
  });
});

describe("the compact HUD is a mark and a meter, and nothing else", () => {
  test("at rest it draws the mark and the meter and no words", () => {
    const markup = render({ hud: "listening", levels: LEVELS });
    const seen = visibleText(markup);
    expect(markup).toContain('class="smark"');
    expect(markup).toContain("swave ready snap-measured");
    /* Everything the row used to say out loud. The mode is the user's own
     * choice, the chord is the key they just pressed, and the clock, the engine
     * and the state word are the clutter the redesign exists to remove. */
    for (const gone of [
      "Listening",
      "Email",
      "Cloud",
      "1m 12s",
      "<kbd",
      "stimer",
      "smode",
      "sengine",
      "shint",
      "sring",
      "sstate",
      "sspinner",
    ]) {
      expect(seen.includes(gone)).toBe(false);
    }
  });

  test("the state a sighted user reads off the meter is announced in words", () => {
    const announcements: [HudPhase, string][] = [
      ["starting", "Starting"],
      ["listening", "Listening"],
      ["transcribing", "Transcribing"],
      ["processing", "Processing"],
    ];
    for (const [hud, word] of announcements) {
      const markup = render({ hud, levels: LEVELS });
      expect(/<span class="sr-only"[^>]*>(.*?)<\/span>/.exec(markup)?.[1]).toBe(
        word,
      );
      expect(markup).toContain('aria-live="polite"');
    }
  });

  test("the meter names itself while it meters, and only while it meters", () => {
    for (const hud of ["starting", "listening"] as const) {
      expect(render({ hud, levels: LEVELS })).toContain(
        'aria-label="Input level"',
      );
    }
    /* Working bars report nothing, so they stop claiming to be a level and
     * leave the state to the status span rather than announcing a lie. */
    const working = render({ hud: "transcribing", levels: LEVELS });
    expect(working.includes("Input level")).toBe(false);
    expect(working).toContain('class="swave working" aria-hidden="true"');
  });

  test("starting dims and pulses the same geometry it will meter with", () => {
    const markup = render({ hud: "starting" });
    expect(markup).toContain("hud-starting");
    expect(markup).toContain("swave arming");
    // Dimmed and pulsing is a display state, not a reported one.
    expect(markup.includes("snap-measured")).toBe(false);
  });

  test("listening snaps the reported buckets and marks them measured", () => {
    const markup = render({ hud: "listening", levels: LEVELS });
    expect(markup).toContain("hud-listening");
    expect(markup).toContain("swave ready snap-measured");
  });

  /* One colour event on this whole surface. The bars are ink until a reported
   * bucket reaches the top of the visualiser's calibrated speech range, and
   * then they are the accent — which is the entire "is it hearing me" answer
   * the HUD exists to give, and why nothing else here is allowed an accent. */
  test("the accent means speech, and only a reported bucket can claim it", () => {
    expect(render({ hud: "listening", levels: LEVELS })).toContain(
      'class="swave ready snap-measured hearing"',
    );

    // A humming room reports real buckets the whole time and stays ink.
    const quiet = render({ hud: "listening", levels: ROOM_TONE });
    expect(quiet).toContain('class="swave ready snap-measured"');
    expect(quiet.includes("hearing")).toBe(false);

    // An opening stream has no buckets yet and a running transcriber reports
    // none at all, so neither can tint the row on a stale frame.
    for (const hud of ["starting", "transcribing", "processing"] as const) {
      expect(render({ hud, levels: LEVELS }).includes("hearing")).toBe(false);
    }
  });

  /* The one state that could lie. Working has no reported bucket behind it, so
   * the renderer must emit no transform at all and let CSS hold every bar at
   * one fixed scale — a bar that moved here would read as input that is not
   * being captured. */
  test("working keeps the bars but reports no level through them", () => {
    for (const hud of ["transcribing", "processing"] as const) {
      const markup = render({ hud, levels: LEVELS });
      expect(markup).toContain(`hud-${hud}`);
      expect(markup).toContain("swave working");
      expect(markup.includes("scaleY")).toBe(false);
      expect(markup.includes("snap-measured")).toBe(false);
      // Each bar knows its place in the row, so the highlight can travel.
      expect(markup).toContain("--bar-index:0");
      expect(markup).toContain("--bar-index:15");
    }
  });

  test("a failure names the cause in the app's own words, not its token", () => {
    const markup = render({
      hud: "error",
      error: { error_type: "no_speech_detected" },
    });
    expect(markup).toContain("hud-error");
    expect(visibleText(markup)).toContain("No speech detected");
    expect(markup.includes("no_speech_detected")).toBe(false);
    // Nothing to cancel once the run has failed, and nothing left to meter.
    expect(markup.includes('class="sx"')).toBe(false);
    expect(markup.includes("swave")).toBe(false);
  });

  test("every emitted error_type has a short cause of its own", () => {
    const causes = [
      ["microphone_permission_denied", "Microphone access denied"],
      ["no_input_device", "No microphone found"],
      ["no_model_selected", "No model selected"],
      ["no_speech_save_failed", "Sample not saved"],
      ["capture_overrun", "Capture overrun"],
      ["cloud_unavailable", "Cloud unavailable"],
      ["cloud_transcription_held", "Cloud run held"],
      ["command_no_selection", "Nothing selected"],
      ["command_rewrite_unavailable", "Rewrite unavailable"],
    ] as const;
    for (const [errorType, cause] of causes) {
      const markup = render({ hud: "error", error: { error_type: errorType } });
      expect(visibleText(markup)).toContain(cause);
      expect(markup.includes(errorType)).toBe(false);
    }
  });

  test("an unmapped cause summarises instead of leaking the token", () => {
    const markup = render({
      hud: "error",
      error: { error_type: "some_future_error", detail: "raw backend detail" },
    });
    expect(visibleText(markup)).toContain("Failed");
    expect(markup.includes("some_future_error")).toBe(false);
    expect(markup.includes("raw backend detail")).toBe(false);
  });

  /* Cancel is the only control left on the row. It is absolutely positioned and
   * transparent until the row is hovered or it takes focus, so the resting pill
   * is the mark and the wave and nothing else — but it is a real, labelled
   * button in the markup the whole time, not something conjured on hover.
   *
   * The reveal itself is CSS, and the click path runs through the Tauri command
   * bridge, so both are verified by driving the overlay in a browser rather than
   * here: this repo renders every test to static markup and has no DOM. */
  test("cancel is a real labelled button for as long as the run is alive", () => {
    for (const hud of [
      "starting",
      "listening",
      "transcribing",
      "processing",
    ] as const) {
      const markup = render({ hud, levels: LEVELS });
      expect(markup).toContain('<button class="sx"');
      expect(markup).toContain('aria-label="Cancel"');
    }
  });

  test("idle renders the pill instead of an instrument row", () => {
    const markup = render({ hud: "idle", frame: "pill" });
    expect(markup).toContain('data-testid="hud-pill"');
    // The pill is the one surface that still names the mode: it is a switcher.
    expect(markup).toContain("Email");
    expect(markup).toContain('class="smark"');
    expect(markup.includes("sbase")).toBe(false);
    expect(markup.includes("sring")).toBe(false);
  });

  /* The resting window is 184x36. The 40px instrument row drawn there would be
   * clipped by the window, so the failure takes the pill's own shape. */
  test("a failure in the resting window renders as a one-line pill", () => {
    const markup = render({
      hud: "error",
      frame: "pill",
      error: { error_type: "no_speech_detected" },
    });
    expect(markup).toContain('data-testid="hud-error-pill"');
    expect(markup).toContain("hud-pill hud-error");
    expect(markup).toContain('class="smark"');
    expect(markup).toContain("No speech detected");
    expect(markup.includes("sbase")).toBe(false);
  });

  test("every transient state hooks its colour on a phase class, none inline", () => {
    for (const hud of [
      "starting",
      "listening",
      "transcribing",
      "processing",
      "error",
    ] as const) {
      const markup = render({
        hud,
        error: { error_type: "capture_overrun" },
      });
      expect(markup).toContain(`hud-${hud}`);
      expect(markup.includes("color:")).toBe(false);
    }
  });
});

describe("the HUD reports measurements and never tweens them", () => {
  test("each bar sits exactly where its reported bucket puts it", () => {
    const markup = render({ hud: "listening", levels: LEVELS });
    for (const level of LEVELS) {
      const scale = Math.max(0.06, Math.min(1, Math.pow(level, 0.7)));
      expect(markup).toContain(`scaleY(${scale})`);
    }
    // A silent bucket is a baseline hairline, not an absent bar.
    expect(markup).toContain("scaleY(0.06)");
    // Height was the old, tweened channel; transforms are the only one now.
    expect(markup.includes("height:")).toBe(false);
  });

  test("the meter keeps its geometry before the first level event", () => {
    const countBars = (markup: string) => markup.split("<i ").length - 1;
    expect(countBars(render({ hud: "starting" }))).toBe(16);
    expect(countBars(render({ hud: "listening", levels: LEVELS }))).toBe(16);
    expect(countBars(render({ hud: "transcribing", levels: LEVELS }))).toBe(16);
  });
});

describe("the Live panel shares the instrument row", () => {
  test("it keeps the streaming text region and the same mark-and-meter row", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <RecordingOverlayContent
          isVisible
          hud="listening"
          frame="stream"
          levels={LEVELS}
          streamText={{ committed: "Hello", tentative: " world" }}
          modeName="Email"
          error={null}
          session={1}
          position="bottom"
          direction="ltr"
          capRef={{ current: null }}
          onStreamScroll={() => {}}
        />
      </I18nextProvider>,
    );
    expect(markup).toContain("stext-cap");
    expect(markup).toContain("Hello");
    expect(markup).toContain("scard hud-listening open");
    expect(markup).toContain("sbase");
    expect(markup).toContain('class="smark"');
    expect(markup).toContain("swave ready snap-measured");
    // The row carries the same two things it carries in the compact window.
    const seen = visibleText(markup);
    expect(seen.includes("Email")).toBe(false);
    expect(seen.includes("Cloud")).toBe(false);
    expect(seen.includes("<kbd")).toBe(false);
  });
});
