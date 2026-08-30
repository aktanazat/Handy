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
import {
  useDetectionStore,
  type DetectionPromptEvent,
  type DetectionPromptKind,
  type DetectionStatus,
} from "./detectionStore";

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
    expect(
      paint(
        <PreMeetingCountdownCard
          sources={["microphone"]}
          starting={false}
          onSourcesChange={() => {}}
          onStartEvent={() => {}}
        />,
      ),
    ).toBe("");
  });

  test("the app-level listener renders nothing", () => {
    expect(paint(<DetectionListeners />)).toBe("");
  });

  test("the settings section says it is still reading state, and nothing else", () => {
    const markup = paint(<MeetingDetectionSettings />);

    expect(markup).toContain("Detect meetings");
    expect(markup).toContain("Reading detection state");
    /* The section heading is the whole header now: the sentence that used to
     * sit under it said what the switches below say. */
    expect(markup).not.toContain("It never records on its own");
    /* "What detection can see" exists only when there is a degraded path to
     * name, and first paint has read no state at all. */
    expect(markup).not.toContain("What detection can see");
    expect(markup.includes("__MISSING__")).toBe(false);
  });
});

describe("english catalogue", () => {
  /* Every key the three components reference, so a rename breaks here rather
   * than silently degrading to the inline default at runtime. */
  const KEYS = [
    "meetings.detection.title",
    "meetings.detection.loading",
    "meetings.detection.prompt.calendar",
    "meetings.detection.prompt.app",
    "meetings.detection.prompt.huddle",
    "meetings.detection.prompt.browser",
    "meetings.detection.prompt.unknown",
    "meetings.detection.prompt.calendarUntitled",
    "meetings.detection.prompt.generic",
    "meetings.detection.prompt.body",
    "meetings.detection.actions.start",
    "meetings.detection.actions.dismiss",
    "meetings.detection.pane.title",
    "meetings.detection.pane.countdown",
    "meetings.detection.calendar.label",
    "meetings.detection.calendar.description",
    "meetings.detection.anyMic.label",
    "meetings.detection.autoStart.label",
    "meetings.detection.apps.label",
    "meetings.detection.apps.description",
    "meetings.detection.apps.running",
    "meetings.detection.apps.noneRunning",
    "meetings.detection.state.title",
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

/* Payloads copied verbatim from the Rust serialization test
 * `the_prompt_wire_shape_names_variants_and_camelcases_fields` in
 * src-tauri/src/meeting/detection/machine.rs. `DetectionPromptKind` is no
 * longer a hand mirror — the prompt event is registered with the specta
 * builder, so bindings.ts generates the union from the Rust enum — but a
 * generated type only pins the shape the compiler sees, and these tests run on
 * bytes. When the two drifted, the pane rendered cards whose only content was
 * an app icon and two buttons; what failed then was the runtime titling, not
 * the declaration. So these strings stay: they prove `promptTitle` reads the
 * bytes Rust actually emits, which no type-check can reach. */
const WIRE_PAYLOADS: [string, string][] = [
  [
    '{"kind":"CalendarEvent","eventKey":"event-1","eventTitle":"Quarterly planning"}',
    "Quarterly planning starting",
  ],
  [
    '{"kind":"AppMeeting","bundleId":"us.zoom.xos","appName":"Zoom"}',
    "Zoom meeting detected",
  ],
  [
    '{"kind":"AppHuddle","bundleId":"com.tinyspeck.slackmacgap","appName":"Slack"}',
    "Slack huddle detected",
  ],
  [
    '{"kind":"BrowserCall","bundleId":"com.google.chrome","appName":"Chrome"}',
    "Call detected in Chrome",
  ],
  ['{"kind":"UnknownMicSource"}', "Microphone activity detected"],
];

describe("wire shape", () => {
  for (const [payload, expected] of WIRE_PAYLOADS) {
    const kind = String(JSON.parse(payload).kind);
    test(`${kind} arrives as the union declares it`, () => {
      /* SAFETY: the payload bytes are pinned by the Rust wire-shape test
       * (the_prompt_wire_shape_names_variants_and_camelcases_fields), so this
       * cast states the contract under test rather than assuming one. */
      const prompt = JSON.parse(payload) as DetectionPromptKind;

      expect(promptTitle(i18n.t.bind(i18n), prompt)).toBe(expected);
    });
  }

  test("a kind this build cannot read still titles its card", () => {
    /* The shape that shipped: serde's container `rename_all` renamed the
     * variants instead of their fields. Nothing should title itself off a
     * payload like this, but a card offering to record something is worse than
     * useless with no sentence on it. */
    /* SAFETY: deliberately NOT a valid DetectionPromptKind - this is the
     * pre-fix wire shape, cast to prove the fallback path titles it. */
    const drifted = JSON.parse(
      '{"kind":"appMeeting","bundle_id":"us.zoom.xos","app_name":"Zoom"}',
    ) as DetectionPromptKind;

    expect(promptTitle(i18n.t.bind(i18n), drifted)).toBe("Meeting detected");
  });
});

describe("prompts the platform would not name", () => {
  /* An empty name interpolates to nothing, which is how a title goes missing
   * without anything failing. Every arm owes a sentence regardless. */
  const UNNAMEABLE: [DetectionPromptKind, string][] = [
    [
      { kind: "CalendarEvent", eventKey: "e1", eventTitle: "" },
      "Calendar event starting",
    ],
    [
      { kind: "CalendarEvent", eventKey: "e1", eventTitle: "   " },
      "Calendar event starting",
    ],
    [
      { kind: "AppMeeting", bundleId: "us.zoom.xos", appName: "" },
      "Meeting detected",
    ],
    [
      { kind: "AppHuddle", bundleId: "com.tinyspeck.slackmacgap", appName: "" },
      "Meeting detected",
    ],
    [
      { kind: "BrowserCall", bundleId: "com.google.chrome", appName: "" },
      "Meeting detected",
    ],
  ];

  for (const [prompt, expected] of UNNAMEABLE) {
    test(`${prompt.kind} with no name reads "${expected}"`, () => {
      expect(promptTitle(i18n.t.bind(i18n), prompt)).toBe(expected);
    });
  }

  test("every prompt kind titles itself, named or not", () => {
    for (const [prompt] of [...PROMPT_COPY, ...UNNAMEABLE]) {
      expect(promptTitle(i18n.t.bind(i18n), prompt).trim()).not.toBe("");
    }
  });
});

/* The prompt list, driven the way the event listeners drive it. No React here:
 * zustand hands the server renderer its initial snapshot, so markup cannot
 * observe a seeded store — the list's own rules are what these check. */
const promptEvent = (
  promptId: string,
  prompt: DetectionPromptKind,
): DetectionPromptEvent => ({
  eventSchemaVersion: 1,
  promptId,
  prompt,
  notificationTitle: "unused by the in-app card",
  notified: true,
});

const status = (inputDeviceActive: boolean): DetectionStatus => ({
  eventSchemaVersion: 1,
  settings: {
    enabled: true,
    calendarEnabled: true,
    anyMicActivity: false,
    autoStartOnOpenPane: false,
    silenceStopMinutes: 0,
    meetingApps: [],
  },
  calendarAccess: "authorized",
  notificationAccess: "authorized",
  inputDeviceActive,
  sonaHoldsInputDevice: false,
  suppressReason: null,
  countdown: null,
  runningMeetingApps: [],
  availableStopTriggers: [],
  inputDeviceReportingSuspect: false,
});

const zoom: DetectionPromptKind = {
  kind: "AppMeeting",
  bundleId: "us.zoom.xos",
  appName: "Zoom",
};

describe("the prompt list", () => {
  const seed = (...entries: DetectionPromptEvent[]) => {
    useDetectionStore.setState({ status: null, prompts: [] });
    for (const entry of entries) useDetectionStore.getState().addPrompt(entry);
    return useDetectionStore.getState();
  };

  test("one app across three microphone episodes is one offer", () => {
    /* What the operator actually saw. The backend mints a fresh prompt id per
     * raise and re-arms an app's claim every time the input device goes idle,
     * so three episodes in Zoom legitimately produce three ids for one
     * subject. Keyed by id alone they stacked into three identical cards. */
    const state = seed(
      promptEvent("uuid-1", zoom),
      promptEvent("uuid-2", zoom),
      promptEvent("uuid-3", zoom),
    );

    expect(state.prompts.map((entry) => entry.promptId)).toEqual(["uuid-3"]);
  });

  test("the newest raise is the one left standing", () => {
    const state = seed(
      promptEvent("uuid-1", { ...zoom, appName: "Zoom" }),
      promptEvent("uuid-2", { ...zoom, appName: "Zoom Workplace" }),
    );

    expect(promptTitle(i18n.t.bind(i18n), state.prompts[0].prompt)).toBe(
      "Zoom Workplace meeting detected",
    );
  });

  test("different subjects are different offers", () => {
    const state = seed(
      promptEvent("uuid-1", zoom),
      promptEvent("uuid-2", {
        kind: "AppHuddle",
        bundleId: "com.tinyspeck.slackmacgap",
        appName: "Slack",
      }),
      promptEvent("uuid-3", {
        kind: "CalendarEvent",
        eventKey: "event-1",
        eventTitle: "Quarterly planning",
      }),
      promptEvent("uuid-4", { kind: "UnknownMicSource" }),
    );

    expect(state.prompts.map((entry) => entry.promptId)).toEqual([
      "uuid-1",
      "uuid-2",
      "uuid-3",
      "uuid-4",
    ]);
  });

  test("two calendar events are two offers, one event twice is one", () => {
    const event = (
      eventKey: string,
      eventTitle: string,
    ): DetectionPromptKind => ({
      kind: "CalendarEvent",
      eventKey,
      eventTitle,
    });
    const state = seed(
      promptEvent("uuid-1", event("event-1", "Quarterly planning")),
      promptEvent("uuid-2", event("event-2", "Design review")),
      promptEvent("uuid-3", event("event-1", "Quarterly planning")),
    );

    expect(state.prompts.map((entry) => entry.promptId)).toEqual([
      "uuid-2",
      "uuid-3",
    ]);
  });

  test("the microphone going idle retires the offers that depended on it", () => {
    seed(
      promptEvent("uuid-1", zoom),
      promptEvent("uuid-2", { kind: "UnknownMicSource" }),
      promptEvent("uuid-3", {
        kind: "CalendarEvent",
        eventKey: "event-1",
        eventTitle: "Quarterly planning",
      }),
    );

    useDetectionStore.getState().setStatus(status(false));

    /* The calendar prompt outlives the device deliberately: it is raised at
     * T-60s, before anyone has opened a microphone. */
    expect(
      useDetectionStore.getState().prompts.map((entry) => entry.promptId),
    ).toEqual(["uuid-3"]);
  });

  test("a status with the microphone still held changes nothing", () => {
    const before = seed(promptEvent("uuid-1", zoom)).prompts;

    useDetectionStore.getState().setStatus(status(true));

    /* Identity, not just contents: the prompt subscription in
     * DetectionListeners compares this array by reference to decide what is
     * new, so a fresh array on every status would re-toast a live prompt. */
    expect(useDetectionStore.getState().prompts).toBe(before);
  });

  test("answering an offer clears only that one", () => {
    seed(
      promptEvent("uuid-1", zoom),
      promptEvent("uuid-2", { kind: "UnknownMicSource" }),
    );

    useDetectionStore.getState().clearPrompt("uuid-1");

    expect(
      useDetectionStore.getState().prompts.map((entry) => entry.promptId),
    ).toEqual(["uuid-2"]);
  });

  test("three live subjects render three titled cards", () => {
    /* The shape the pane maps over. Each entry has to arrive with a sentence
     * on it, because the card it titles carries a Start recording button. */
    const state = seed(
      promptEvent("uuid-1", zoom),
      promptEvent("uuid-2", {
        kind: "BrowserCall",
        bundleId: "com.google.chrome",
        appName: "Chrome",
      }),
      promptEvent("uuid-3", {
        kind: "CalendarEvent",
        eventKey: "event-1",
        eventTitle: "Quarterly planning",
      }),
    );

    expect(
      state.prompts.map((entry) =>
        promptTitle(i18n.t.bind(i18n), entry.prompt),
      ),
    ).toEqual([
      "Zoom meeting detected",
      "Call detected in Chrome",
      "Quarterly planning starting",
    ]);
  });
});
