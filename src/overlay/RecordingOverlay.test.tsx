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

interface HudCase {
  hud: HudPhase;
  elapsedSeconds?: number | null;
  levels?: number[];
  error?: { error_type: string; detail?: string };
  frame?: HudFrame;
}

const render = ({
  hud,
  elapsedSeconds = null,
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
        engine="local"
        elapsedSeconds={elapsedSeconds}
        modeName="Email"
        stopKeys={["⌥", "Space"]}
        error={error ?? null}
        session={1}
        position="bottom"
        direction="ltr"
        capRef={{ current: null }}
        onStreamScroll={() => {}}
      />
    </I18nextProvider>,
  );

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

describe("HUD states are each distinct", () => {
  test("starting says so, dims the meter, and shows no clock", () => {
    const markup = render({ hud: "starting" });
    expect(markup).toContain("hud-starting");
    expect(markup).toContain("Starting");
    expect(markup).toContain("swave arming");
    // No readiness means no measured elapsed time to report.
    expect(markup.includes("stimer")).toBe(false);
  });

  test("listening says so, snaps a live meter, and reports elapsed", () => {
    const markup = render({
      hud: "listening",
      elapsedSeconds: 72,
      levels: LEVELS,
    });
    expect(markup).toContain("hud-listening");
    expect(markup).toContain("Listening");
    expect(markup).toContain("swave ready snap-measured");
    expect(markup).toContain("1m 12s");
    expect(markup).toContain("Email");
  });

  test("transcribing and processing replace the meter with a spinner", () => {
    const transcribing = render({ hud: "transcribing", elapsedSeconds: 3 });
    expect(transcribing).toContain("hud-transcribing");
    expect(transcribing).toContain("Transcribing");
    expect(transcribing).toContain("sspinner");
    expect(transcribing.includes("swave")).toBe(false);

    /* "Processing", not "Delivering": the only signal behind this state is
     * StreamWorkKind::Polishing / the `processing` overlay state, both of which
     * are LLM post-processing. Delivery is never a state — `deliver` and
     * `hide_recording_overlay` run in the same closure. */
    const processing = render({ hud: "processing", elapsedSeconds: 3 });
    expect(processing).toContain("hud-processing");
    expect(processing).toContain("Processing");
    expect(processing).toContain("sspinner");
  });

  test("a failure names the cause in the app's own words, not its token", () => {
    const markup = render({
      hud: "error",
      elapsedSeconds: 1,
      error: { error_type: "no_speech_detected" },
    });
    expect(markup).toContain("hud-error");
    expect(markup).toContain("Failed");
    expect(markup).toContain("No speech detected");
    expect(markup.includes("no_speech_detected")).toBe(false);
    // Nothing to cancel once the run has failed.
    expect(markup.includes('class="sx"')).toBe(false);
    // A failed run is not working: nothing spins, and nothing meters.
    expect(markup.includes("sspinner")).toBe(false);
    expect(markup.includes("swave")).toBe(false);
    // The capture length it did manage still reports.
    expect(markup).toContain("1s");
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
      expect(markup).toContain(cause);
      expect(markup.includes(errorType)).toBe(false);
    }
  });

  test("an unmapped cause summarises instead of leaking the token", () => {
    const markup = render({
      hud: "error",
      error: { error_type: "some_future_error", detail: "raw backend detail" },
    });
    expect(markup).toContain("Failed");
    expect(markup.includes("some_future_error")).toBe(false);
    expect(markup.includes("raw backend detail")).toBe(false);
  });

  test("idle renders the pill instead of an instrument row", () => {
    const markup = render({ hud: "idle", frame: "pill" });
    expect(markup).toContain('data-testid="hud-pill"');
    expect(markup).toContain("Email");
    expect(markup.includes("sbase")).toBe(false);
  });

  /* The resting window is 184x36. A two-line 44px row drawn there would be
   * clipped by the window, so the failure takes the pill's own shape. */
  test("a failure in the resting window renders as a one-line pill", () => {
    const markup = render({
      hud: "error",
      frame: "pill",
      error: { error_type: "no_speech_detected" },
    });
    expect(markup).toContain('data-testid="hud-error-pill"');
    expect(markup).toContain("hud-pill hud-error");
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
  });

  test("elapsed uses the one duration format, never a padded clock", () => {
    expect(render({ hud: "listening", elapsedSeconds: 7 })).toContain("7s");
    expect(render({ hud: "listening", elapsedSeconds: 3780 })).toContain(
      "1h 3m",
    );
    expect(
      render({ hud: "listening", elapsedSeconds: 15 }).includes("0:15"),
    ).toBe(false);
  });
});

describe("the stop hint", () => {
  test("rides the mode name's line as keycaps, one per key", () => {
    const markup = render({ hud: "listening", elapsedSeconds: 1 });
    expect(markup).toContain('<kbd class="kbd');
    expect(markup.split("<kbd ").length - 1).toBe(2);
    expect(markup).toContain("Press ⌥ Space to stop");
  });

  test("is omitted rather than rendered empty when the chord is unknown", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <RecordingOverlayContent
          isVisible
          hud="listening"
          frame="compact"
          levels={LEVELS}
          streamText={{ committed: "", tentative: "" }}
          engine="local"
          elapsedSeconds={4}
          modeName="Email"
          stopKeys={[]}
          error={null}
          session={1}
          position="bottom"
          direction="ltr"
          capRef={{ current: null }}
          onStreamScroll={() => {}}
        />
      </I18nextProvider>,
    );
    expect(markup.includes("<kbd")).toBe(false);
    expect(markup.includes("shint")).toBe(false);
    expect(markup).toContain("Email");
  });
});

describe("the Live panel shares the instrument row", () => {
  test("it keeps the streaming text region and the same state row", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <RecordingOverlayContent
          isVisible
          hud="listening"
          frame="stream"
          levels={LEVELS}
          streamText={{ committed: "Hello", tentative: " world" }}
          engine="cloud"
          elapsedSeconds={9}
          modeName="Email"
          stopKeys={["⌥", "Space"]}
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
    // The engine is a machine identifier: mono microlabel, no status colour.
    expect(markup).toContain('sengine microlabel" data-engine="cloud"');
    expect(markup).toContain("Cloud");
  });
});
