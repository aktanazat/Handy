import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { MeetingDetectionSettings } from "./MeetingDetectionSettings";
import { DetectionListeners, promptTitle } from "./DetectionListeners";
import { PreMeetingCountdownCard } from "./PreMeetingCountdownCard";
import type { DetectionPromptKind } from "./detectionStore";

/* Two things this file defends, both of which a type-check cannot reach.
 *
 * 1. Every detection surface mounts. Static rendering runs no effects and no
 *    Tauri command is reachable from here, so this is first paint only — and,
 *    because zustand v5 hands React's server renderer its *initial* snapshot,
 *    first paint is the only state a static render can observe. The
 *    state-dependent copy is therefore checked through the pure mapping below
 *    rather than through markup.
 * 2. Every string these surfaces ask for exists in the shipped English
 *    catalogue. A renamed or missing key is the realistic failure here: i18next
 *    silently falls back to the inline default, so a typo would ship as copy
 *    that quietly stops being translatable. */

const localeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

interface DetectionCatalogue {
  meetings: { detection: { why: Record<string, string> } };
}

const catalogue: DetectionCatalogue = JSON.parse(
  fs.readFileSync(localeRoot, "utf8"),
);

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: catalogue } },
  interpolation: { escapeValue: false },
  /* Without this a missing key returns the key itself, which is exactly what
   * the catalogue assertions below need to be able to see. */
  parseMissingKeyHandler: () => "__MISSING__",
});

const paint = (node: React.ReactElement) =>
  renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

const PROMPT_COPY: [DetectionPromptKind, string][] = [
  [
    { kind: "CalendarEvent", eventKey: "e1", eventTitle: "Quarterly planning" },
    "Quarterly planning starting",
  ],
  [
    { kind: "AppMeeting", bundleId: "us.zoom.xos", appName: "Zoom" },
    "Zoom meeting detected",
  ],
  [
    {
      kind: "AppHuddle",
      bundleId: "com.tinyspeck.slackmacgap",
      appName: "Slack",
    },
    "Slack huddle detected",
  ],
  [
    { kind: "BrowserCall", bundleId: "com.google.chrome", appName: "Chrome" },
    "Call detected in Chrome",
  ],
  [{ kind: "UnknownMicSource" }, "Microphone activity detected"],
];

describe("prompt copy", () => {
  for (const [prompt, expected] of PROMPT_COPY) {
    test(`${prompt.kind} reads as the brief's copy pattern`, () => {
      expect(promptTitle(i18n.t.bind(i18n), prompt)).toBe(expected);
    });
  }
});

describe("first paint", () => {
  test("the pre-meeting card costs the page nothing when idle", () => {
    expect(paint(<PreMeetingCountdownCard />)).toBe("");
  });

  test("the app-level listener renders nothing", () => {
    expect(paint(<DetectionListeners />)).toBe("");
  });

  test("the settings section says it is still reading state", () => {
    const markup = paint(<MeetingDetectionSettings />);

    expect(markup).toContain("Detect meetings");
    expect(markup).toContain("Reading detection state");
    expect(markup.includes("__MISSING__")).toBe(false);
  });
});

describe("english catalogue", () => {
  /* Every key the three components reference, so a rename breaks here rather
   * than silently degrading to the inline default at runtime. */
  const KEYS = [
    "meetings.detection.title",
    "meetings.detection.description",
    "meetings.detection.loading",
    "meetings.detection.prompt.calendar",
    "meetings.detection.prompt.app",
    "meetings.detection.prompt.huddle",
    "meetings.detection.prompt.browser",
    "meetings.detection.prompt.unknown",
    "meetings.detection.prompt.body",
    "meetings.detection.actions.start",
    "meetings.detection.actions.dismiss",
    "meetings.detection.pane.title",
    "meetings.detection.pane.description",
    "meetings.detection.pane.countdown",
    "meetings.detection.pane.notYetRecording",
    "meetings.detection.calendar.label",
    "meetings.detection.calendar.description",
    "meetings.detection.anyMic.label",
    "meetings.detection.anyMic.description",
    "meetings.detection.autoStart.label",
    "meetings.detection.autoStart.description",
    "meetings.detection.apps.label",
    "meetings.detection.apps.description",
    "meetings.detection.apps.running",
    "meetings.detection.apps.noneRunning",
    "meetings.detection.state.title",
    "meetings.detection.state.description",
    "meetings.detection.state.calendarDenied",
    "meetings.detection.state.notificationsDenied",
    "meetings.detection.state.bluetoothCaveat",
    "meetings.detection.state.noSilenceStop",
    "meetings.detection.why.disabled",
    "meetings.detection.why.sonaHoldsMic",
    "meetings.detection.why.captureActive",
    "meetings.detection.why.noSignal",
    "meetings.detection.why.soloEvent",
    "meetings.detection.why.unknownApp",
    "meetings.detection.why.browserUnreadable",
    "meetings.detection.why.browserNotMeeting",
  ];

  for (const key of KEYS) {
    test(`${key} exists`, () => {
      expect(String(i18n.t(key)) === "__MISSING__").toBe(false);
    });
  }

  test("every suppression reason the backend can send has copy", () => {
    /* Mirrors detection::machine::SuppressReason. A new variant with no entry
     * here would render blank rather than explaining the silence. */
    const reasons = [
      "disabled",
      "sonaHoldsMic",
      "captureActive",
      "noSignal",
      "soloEvent",
      "unknownApp",
      "browserUnreadable",
      "browserNotMeeting",
    ];

    expect(Object.keys(catalogue.meetings.detection.why).sort()).toEqual(
      reasons.sort(),
    );
  });
});
