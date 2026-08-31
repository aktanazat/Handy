import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/vg/tooltip";
import type {
  MeetingHistorySummary,
  MeetingLedger,
  MeetingLoopRow,
  MeetingPhase,
  MeetingReviewSnapshot,
  MeetingStatusFilter,
  MeetingSuggestion,
  ProcessingStatus,
} from "@/bindings";
import { meetingCardStatus } from "./home/MeetingStatusChip";
import { MeetingLive } from "./MeetingLive";
import { MeetingStartGate } from "./MeetingStartGate";
import { InsightsTab } from "./review/InsightsTab";
import { QuestionsTab } from "./review/QuestionsTab";
import { MeetingReview } from "./MeetingReview";
import { MeetingsHome } from "./MeetingsHome";
import { MeetingLedgerSection } from "./MeetingLedgerSection";
import { currentLedger } from "./meetingLedger";
import { MeetingsSettings } from "./MeetingsSettings";
import { NO_MEETING_FILTER } from "./meetingUtils";
import type { MeetingStartOptions } from "./meetingTypes";

/* First paint of every meetings surface, and the shape of the start flow.
 *
 * Recording is one press. The strings pinned here are the ones that make that
 * true and safe: "Start recording", and the assurance sentence, which has to
 * be on screen next to the button because pressing the button is what the
 * backend records as the operator's acknowledgment. There is no setup screen
 * and no consent checkbox to tick before it; a test that reintroduced either
 * would be describing a flow the product deliberately removed.
 *
 * Static rendering runs no effects, so these are pure prop-to-markup checks:
 * no Tauri command is reachable from here. */

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

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeRoot, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

/* Every window root mounts one `TooltipProvider` and the row primitives assume
 * it, so this stands in for the root. Context only: no markup of its own. */
const render = (node: React.ReactElement) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  );

const occurrences = (markup: string, needle: string) =>
  markup.split(needle).length - 1;

/** Opening tag of the button containing the visible label. */
const buttonTag = (markup: string, label: string) => {
  const labelIndex = markup.indexOf(`>${label}<`);
  if (labelIndex === -1) return "";
  return markup.slice(markup.lastIndexOf("<button", labelIndex), labelIndex);
};

const START_OPTIONS: MeetingStartOptions = {
  title: "Weekly planning",
  origin: "manual",
  suggestionId: null,
  calendarEventKey: null,
  sources: ["microphone", "system_audio"],
  degradedStartPolicy: "abort_if_required_source_fails",
  destination: { kind: "local" },
  preview: null,
};

const SUGGESTION: MeetingSuggestion = {
  offer_id: "offer-1",
  provider: "zoom",
  app_bundle_id: "us.zoom.xos",
  evidence_flags: {
    appOnly: true,
    axTitle: false,
    axHost: false,
    axUnavailable: false,
  },
  observed_at_ns: 1,
  expires_at_ns: 2,
};

const SUMMARY: MeetingHistorySummary = {
  kind: "meeting",
  session_id: "meeting-1",
  title: "Weekly planning",
  phase: "review_ready",
  created_at_utc_ms: 1_760_000_000_000,
  capture_completeness: "complete",
  processing_status: { kind: "succeeded" },
};

const cited = (text: string, segmentId: string | null) => ({
  text,
  citations:
    segmentId === null
      ? []
      : [
          {
            segment_id: segmentId,
            start_offset_ns: 12_000_000_000,
            end_offset_ns: 14_000_000_000,
          },
        ],
});

const SNAPSHOT: MeetingReviewSnapshot = {
  session: {
    session_id: "meeting-1",
    phase: "review_ready",
    revision: 4,
    title: "Weekly planning",
    started_at_utc_ms: 1_760_000_000_000,
    elapsed_offset_ns: 1_845_000_000_000,
    sources: [
      {
        track_id: "track-mic",
        source_kind: "microphone",
        required: true,
        availability: "available",
        health: "stopped",
        format: { sample_rate_hz: 16_000, channels: 1 },
        last_durable_offset_ns: 1_845_000_000_000,
        gap_count: 0,
      },
      {
        track_id: "track-system",
        source_kind: "system_audio",
        required: true,
        availability: "permission_required",
        health: "failed",
        format: null,
        last_durable_offset_ns: null,
        gap_count: 2,
      },
    ],
    open_capture_window_started_at_ns: null,
    capture_completeness: "partial",
    storage: "available",
    processing_status: { kind: "succeeded" },
    retention_deadline_utc_ms: null,
    allowed_actions: ["edit", "regenerate", "ask_question", "export", "delete"],
  },
  tracks: [],
  gaps: [
    {
      track_id: "track-system",
      epoch: 1,
      start_offset_ns: 60_000_000_000,
      end_offset_ns: 90_000_000_000,
      reason: "permission_lost",
      dropped_frames: 128,
    },
  ],
  speakers: [
    {
      speaker_id: "speaker-1",
      session_id: "meeting-1",
      source_kind: "microphone",
      display_name: "Aktan",
      revision: 1,
    },
    {
      speaker_id: "speaker-2",
      session_id: "meeting-1",
      source_kind: "system_audio",
      display_name: "Guest",
      revision: 1,
    },
  ],
  transcript: [
    {
      base: {
        segment_id: "segment-1",
        transcript_revision_id: "revision-1",
        track_id: "track-mic",
        ordinal: 0,
        start_offset_ns: 12_000_000_000,
        end_offset_ns: 14_000_000_000,
        speaker_id: "speaker-1",
        text: "We ship the meetings redesign this week.",
        confidence_milli: 940,
      },
      replacement_text: null,
      removed: false,
      edit_revision: null,
      assigned_speaker_id: "speaker-1",
      speaker_assignment: "local_speaker",
    },
  ],
  notes: [
    {
      note_id: "note-1",
      session_id: "meeting-1",
      start_offset_ns: 30_000_000_000,
      end_offset_ns: null,
      body: "Ask about the export format.",
      revision: 1,
      created_at_utc_ms: 1_760_000_100_000,
      updated_at_utc_ms: 1_760_000_100_000,
    },
  ],
  artifacts: [
    {
      artifact_id: "artifact-1",
      session_id: "meeting-1",
      transcript_revision_id: "revision-1",
      input_revision: 4,
      template_id: "standard",
      template_version: 1,
      generation_key: "key-1",
      state: "current",
      generated_at_utc_ms: 1_760_000_200_000,
      content: {
        summary: cited("The team agreed to ship this week.", "segment-1"),
        outline: [
          {
            title: cited("Release plan", "segment-1"),
            detail: cited("Cut on Thursday.", null),
          },
        ],
        decisions: [cited("Ship on Thursday.", "segment-1")],
        action_items: [
          {
            text: cited("Write the release notes.", "segment-1"),
            owner_text: "Aktan",
            due_text: null,
          },
        ],
        key_questions: [cited("Who signs off?", null)],
        risks: [cited("System audio permission is missing.", "segment-1")],
        follow_up_draft: cited("Thanks all, notes below.", null),
      },
    },
  ],
  questions: [
    {
      question_id: "question-1",
      session_id: "meeting-1",
      scope: { kind: "this_meeting" },
      question: "What did we decide about the release?",
      state: "supported",
      answer: "You agreed to ship on Thursday.",
      citations: [
        {
          kind: "transcript",
          session_id: "meeting-1",
          entity_id: "segment-1",
          start_offset_ns: 12_000_000_000,
          end_offset_ns: 14_000_000_000,
        },
      ],
      input_revision: 4,
      revision: 1,
      created_at_utc_ms: 1_760_000_300_000,
    },
  ],
  diarization: {
    status: "succeeded",
    model_id: "diarizer",
    model_version: "1",
    generation_id: "generation-1",
    assigned_segment_count: 1,
  },
  can_export: true,
  remote_cancellation_pending: false,
};

const LIVE_SNAPSHOT: MeetingReviewSnapshot = {
  ...SNAPSHOT,
  session: {
    ...SNAPSHOT.session,
    phase: "capturing_recording",
    allowed_actions: ["pause", "stop", "discard"],
  },
  artifacts: [],
  questions: [],
};

const noop = () => {};

/* The promise that has to be on screen wherever the consent flags can be
 * sent, in the form the renderer emits it. */
const ASSURANCE =
  "Records your Mac&#x27;s audio locally. Nothing joins the call.";

const homeMarkup = (
  overrides: Partial<React.ComponentProps<typeof MeetingsHome>>,
) =>
  render(
    <MeetingsHome
      suggestions={[]}
      recovery={[]}
      meetings={[]}
      loading={false}
      paging={false}
      hasMore={false}
      page={1}
      filter={NO_MEETING_FILTER}
      retention={null}
      error={null}
      sources={["microphone", "system_audio"]}
      starting={false}
      focusStart={false}
      onSourcesChange={noop}
      onStart={noop}
      onStartSuggestion={noop}
      onStartEvent={noop}
      onOpenMeeting={noop}
      onFinalizeRecovery={noop}
      onDiscardRecovery={noop}
      onFilterChange={noop}
      onNextPage={noop}
      onPreviousPage={noop}
      onExportMeeting={noop}
      onExportLedger={noop}
      onDeleteMeeting={noop}
      onRetry={noop}
      onOpenSettings={noop}
      {...overrides}
    />,
  );

describe("meetings section", () => {
  test("mounts on first paint and waits on the list skeleton", () => {
    const markup = render(<MeetingsSettings />);
    expect(markup).toContain('aria-label="Loading meeting history…"');
    expect(markup).toContain(">Meetings</h1>");
    expect(markup).toContain(">Start recording<");
  });
});

describe("starting a meeting", () => {
  test("one press starts capture, with the assurance beside the button", () => {
    const markup = homeMarkup({});
    // Exactly one Start control on an empty page: the block at the top.
    expect(occurrences(markup, ">Start recording</button>")).toBe(1);
    expect(markup).toContain(ASSURANCE);
    // The wizard is gone: no setup screen and no acknowledgement to tick
    // before the press that is itself the acknowledgement.
    expect(occurrences(markup, "Check recording setup")).toBe(0);
    expect(
      occurrences(markup, "I have permission to capture this meeting."),
    ).toBe(0);
  });

  test("both default sources are on and selectable in place", () => {
    const markup = homeMarkup({});
    expect(occurrences(markup, 'aria-pressed="true"')).toBe(2);
    expect(markup).toContain("Microphone");
    expect(markup).toContain("System audio");
  });

  test("Start is unavailable, and says why, with no source chosen", () => {
    const markup = homeMarkup({ sources: [] });
    expect(buttonTag(markup, "Start recording")).toContain("disabled");
    expect(markup).toContain("Choose at least one source.");
  });
});

describe("meetings list", () => {
  test("shows a loading skeleton before the first page lands", () => {
    const markup = homeMarkup({ loading: true });
    expect(markup).toContain('aria-label="Loading meeting history…"');
    expect(markup).toContain('data-slot="skeleton"');
    expect(occurrences(markup, "No meetings yet")).toBe(0);
  });

  test("an empty history is absence, not a second call to action", () => {
    const markup = homeMarkup({});
    expect(markup).toContain("No meetings yet");
    /* Absence is the whole message. The state used to add "Start local notes
     * when you are ready to capture a meeting." under a heading that already
     * says it, three rows below a Start button that already offers it. */
    expect(markup).not.toContain("Start local notes when you are ready");
    expect(occurrences(markup, ">Start recording</button>")).toBe(1);
  });

  test("a detected meeting starts from its own row, without repeating the promise", () => {
    const markup = homeMarkup({ suggestions: [SUGGESTION] });
    expect(markup).toContain("A meeting may be active in Zoom.");
    expect(occurrences(markup, ">Start recording</button>")).toBe(2);
    /* The assurance sentence lives beside the page's own Start and nowhere
     * else: one sentence never appears twice on one screen. */
    expect(occurrences(markup, ASSURANCE)).toBe(1);
    /* And the evidence is shown as the measurement it is — an APP fact naming
     * the app — rather than as "Sona noticed a meeting app in use.", which was
     * the section heading written out a second time as prose. */
    expect(markup).not.toContain("Sona noticed");
    expect(markup).toContain(">App<");
    expect(markup).toContain(">Zoom<");
  });

  /* The row render matrix. A row in the day log says three things — what the
   * meeting was called, how long it ran, and the time of day it started — and
   * `data-headline` is the row stating its own provenance, which keeps these
   * assertions about behaviour rather than about prose. */
  const row = (overrides: Partial<MeetingHistorySummary>) =>
    homeMarkup({ meetings: [{ ...SUMMARY, ...overrides }] });

  test("a finished row is its title, its length and its time, and no chip", () => {
    const markup = row({
      headline: { kind: "ledger", text: "Pricing is open again." },
      speaker_labels: ["Ada", "Grace"],
      sources: ["microphone", "system_audio"],
      recorded_duration_ms: 192_000,
    });
    expect(markup).toContain("Weekly planning");
    expect(markup).toContain('data-headline="ledger"');
    expect(markup).toContain("3m 12s");
    // The heading over the group carries the date, so the row carries a clock.
    expect(occurrences(markup, 'data-slot="meeting-day"')).toBe(1);
    /* Nothing a finished meeting does not need: no status chip, no speaker
     * bubbles, no source glyphs and no second line. The summary it used to
     * print is the row's hover title, and the meeting is one click away. */
    expect(occurrences(markup, 'data-slot="meeting-status"')).toBe(0);
    expect(occurrences(markup, 'data-slot="meeting-person"')).toBe(0);
    expect(markup).not.toContain(">Ada, Grace<");
    expect(markup).not.toContain("Pricing is open again.</span>");
    expect(markup).toContain(
      'title="Weekly planning — Pricing is open again."',
    );
  });

  test("only an unfinished meeting wears a chip, and it names the state", () => {
    const chip = (overrides: Partial<MeetingHistorySummary>) => {
      const markup = row(overrides);
      const at = markup.indexOf('data-slot="meeting-status"');
      return at === -1 ? "" : markup.slice(at, markup.indexOf("</span>", at));
    };
    expect(
      chip({
        phase: "capturing_recording",
        processing_status: { kind: "pending" },
      }),
    ).toContain('data-status="live"');
    expect(
      chip({
        phase: "starting",
        processing_status: { kind: "pending" },
      }),
    ).toContain('data-status="live"');
    expect(
      chip({ phase: "processing", processing_status: { kind: "running" } }),
    ).toContain('data-status="processing"');
    expect(
      chip({
        processing_status: { kind: "failed", reason: "engine_failure" },
      }),
    ).toContain('data-status="needs_attention"');
    // Recovery needs action even before processing reports a failure.
    expect(
      chip({
        phase: "recovery_required",
        processing_status: { kind: "pending" },
      }),
    ).toContain('data-status="needs_attention"');
    // A meeting that is ready to read says nothing about being ready.
    expect(chip({})).toBe("");
  });

  test("the log is grouped by the day each meeting was recorded", () => {
    const markup = homeMarkup({
      meetings: [
        SUMMARY,
        { ...SUMMARY, session_id: "meeting-2", title: "Standup" },
        {
          ...SUMMARY,
          session_id: "meeting-3",
          title: "Retro",
          created_at_utc_ms: SUMMARY.created_at_utc_ms - 172_800_000,
        },
      ],
    });
    // Two days, three rows: same-day meetings share one heading.
    expect(occurrences(markup, 'data-slot="meeting-day"')).toBe(2);
    expect(occurrences(markup, 'data-slot="meeting-entry"')).toBe(3);
    expect(markup.indexOf("Standup")).toBeLessThan(markup.indexOf("Retro"));
  });

  test("the row keeps its provenance without printing a word count", () => {
    expect(
      row({ headline: { kind: "summary", text: "We picked Postgres." } }),
    ).toContain('data-headline="summary"');
    const words = row({ headline: { kind: "words", words: 1_284 } });
    expect(words).toContain('data-headline="words"');
    expect(occurrences(words, "words transcribed")).toBe(0);
    expect(row({ headline: { kind: "none" } })).toContain(
      'data-headline="none"',
    );
  });

  test("a capture with nothing to report reports nothing, never a zero", () => {
    const markup = row({
      recorded_duration_ms: null,
      sources: [],
      speaker_labels: [],
      capture_completeness: "partial",
    });
    expect(occurrences(markup, "0s")).toBe(0);
    expect(occurrences(markup, "MIC")).toBe(0);
    /* Completeness is a fact about the recording, read on the meeting itself.
     * A log row is not where a caveat about audio belongs. */
    expect(occurrences(markup, "Partial")).toBe(0);
  });

  test("keeps row actions behind one shared menu trigger", () => {
    const ledger = row({
      headline: { kind: "ledger", text: "Pricing is open again." },
    });
    const words = row({ headline: { kind: "words", words: 12 } });

    expect(occurrences(ledger, 'data-slot="dropdown-menu-trigger"')).toBe(1);
    expect(occurrences(words, 'data-slot="dropdown-menu-trigger"')).toBe(1);
    expect(ledger).not.toContain("Export ledger page");
    expect(words).not.toContain("Export ledger page");
  });

  test("the filter bar states the whole query in KEY VALUE pairs", () => {
    const markup = homeMarkup({
      meetings: [SUMMARY],
      retention: { kind: "delete_after_days", days: 30 },
      filter: { status: "failed", window: "last_7_days", title_query: "sync" },
    });
    /* Retention is stated once, on the start card, as a quiet line whose one
     * link is the page that can change it. The list repeats neither the fact
     * nor the control: the same datum twice on one screen is what this
     * replaced, and the policy now lives in Settings alone. */
    expect(occurrences(markup, "Kept 30 days")).toBe(1);
    expect(occurrences(markup, ">change in Settings</button>")).toBe(1);
    expect(occurrences(markup, "Delete after 30 days")).toBe(0);
    expect(markup).toContain('aria-label="Search meetings"');
    expect(markup).toContain("Status");
    expect(markup).toContain("Failed");
    expect(markup).toContain("Time");
    expect(markup).toContain("7 days");
    // A narrowed list offers the way back out.
    expect(markup).toContain("Clear filters");
  });

  test("an unfiltered list offers no Clear, and a filtered empty one explains", () => {
    expect(occurrences(homeMarkup({}), "Clear filters")).toBe(0);
    const empty = homeMarkup({
      filter: { ...NO_MEETING_FILTER, status: "failed" },
    });
    expect(empty).toContain("No meetings match");
    expect(empty).toContain("not just the page on screen");
    expect(occurrences(empty, "No meetings yet")).toBe(0);
  });

  /* `disabled=""` and not "disabled": the Button primitive carries
   * `disabled:`-prefixed utility classes, so the loose substring matches every
   * button ever rendered and proves nothing. */
  test("the pager states the page it is on and nothing it cannot know", () => {
    const first = homeMarkup({ meetings: [SUMMARY], hasMore: true });
    expect(first).toContain("Page 1");
    expect(buttonTag(first, "Newer")).toContain('disabled=""');
    expect(buttonTag(first, "Older")).not.toContain('disabled=""');

    const third = homeMarkup({ meetings: [SUMMARY], hasMore: false, page: 3 });
    expect(third).toContain("Page 3");
    expect(buttonTag(third, "Newer")).not.toContain('disabled=""');
    expect(buttonTag(third, "Older")).toContain('disabled=""');
    // No total exists behind a cursor, so no total is claimed.
    expect(occurrences(third, "of 3")).toBe(0);

    // One page and nothing after it needs no pager at all.
    const only = homeMarkup({ meetings: [SUMMARY] });
    expect(occurrences(only, "Page 1")).toBe(0);
  });

  test("a page in flight disables both moves rather than queueing them", () => {
    const markup = homeMarkup({
      meetings: [SUMMARY],
      hasMore: true,
      page: 2,
      paging: true,
    });
    expect(buttonTag(markup, "Newer")).toContain('disabled=""');
    expect(buttonTag(markup, "Older")).toContain('disabled=""');
  });

  /* The filters are the store's, not the view's. A row the current filter text
   * would exclude still renders, because the page on screen is exactly what
   * `meeting_list` answered with — this is the assertion that fails the moment
   * anyone reintroduces client-side filtering over an already-fetched page.
   * That the store honours each filter value is proved in Rust:
   * meeting::store::tests::listed_status_filter_reads_stored_phase_and_processing_status,
   * listed_time_window_counts_local_calendar_days_including_today, and
   * listed_title_query_matches_a_substring_and_treats_wildcards_literally. */
  test("the page on screen is the store's answer, not a view over it", () => {
    const markup = homeMarkup({
      meetings: [SUMMARY],
      filter: {
        status: "failed",
        window: "today",
        title_query: "nothing in this title",
      },
    });
    expect(markup).toContain("Weekly planning");
    expect(occurrences(markup, "No meetings match")).toBe(0);
  });
});

describe("the start gate", () => {
  const gateMarkup = (
    overrides: Partial<React.ComponentProps<typeof MeetingStartGate>> = {},
  ) =>
    render(
      <MeetingStartGate
        snapshot={{
          ...SNAPSHOT,
          session: { ...SNAPSHOT.session, phase: "preflight" },
        }}
        options={START_OPTIONS}
        refreshing={false}
        starting={false}
        onRefresh={noop}
        onCancel={noop}
        onStart={noop}
        {...overrides}
      />,
    );

  test("an unavailable required source names itself and blocks the press", () => {
    const markup = gateMarkup();
    expect(markup).toContain(">Recording did not start</h1>");
    // The fixture's system audio needs permission, so it is the blocker.
    expect(markup).toContain("System audio");
    expect(markup).toContain("Permission required");
    // Recording anyway is a partial record, and says so before the press.
    expect(markup).toContain(
      "The record is marked partial and the missing source stays named in it.",
    );
    expect(buttonTag(markup, "Record without it")).toContain("disabled");
  });

  test("the assurance is on screen wherever the consent flags can be sent", () => {
    expect(gateMarkup()).toContain(ASSURANCE);
  });

  test("a session with nothing blocking offers the one press directly", () => {
    const markup = gateMarkup({
      snapshot: {
        ...SNAPSHOT,
        session: {
          ...SNAPSHOT.session,
          phase: "preflight",
          processing_status: { kind: "pending" },
          preflight_local_processing: "available",
          allowed_actions: ["refresh_preflight", "cancel_preflight", "start"],
          sources: SNAPSHOT.session.sources.map((source) => ({
            ...source,
            availability: "available",
          })),
        },
      },
    });
    expect(markup).toContain(">Ready to record</h1>");
    expect(
      occurrences(buttonTag(markup, "Start recording"), 'disabled=""'),
    ).toBe(0);
    expect(occurrences(markup, "Record without it")).toBe(0);
    expect(markup).toContain(">Available<");
    expect(markup).not.toContain("Waiting for processing");
  });

  test("a stale preflight cannot render a press that its snapshot rejects", () => {
    const markup = gateMarkup({
      snapshot: {
        ...SNAPSHOT,
        session: {
          ...SNAPSHOT.session,
          phase: "preflight",
          allowed_actions: ["refresh_preflight", "cancel_preflight"],
          sources: SNAPSHOT.session.sources.map((source) => ({
            ...source,
            availability: "available",
          })),
        },
      },
    });
    expect(buttonTag(markup, "Start recording")).toContain("disabled");
    expect(markup).toContain(
      "This action is not available in the current phase.",
    );
  });
});

describe("live capture", () => {
  test("names the capture state in words and offers pause, stop and discard", () => {
    const markup = render(
      <MeetingLive
        snapshot={LIVE_SNAPSHOT}
        pendingAction={null}
        onPause={noop}
        onResume={noop}
        onStop={noop}
        onDiscard={noop}
        onCreateNote={noop}
      />,
    );
    /* One state word. The surface used to carry a badge reading "Active
     * capture" beside the phase word, which is the same state said twice. */
    expect(markup).toContain("Recording");
    expect(markup).toContain(">Pause<");
    expect(markup).toContain(">Stop<");
    expect(markup).toContain(">Discard</button>");
    expect(markup).toContain("Add timestamped note");
    // Reduced motion has nothing to switch off: the mark never animates.
    expect(occurrences(markup, "animate-")).toBe(0);
  });
});

describe("meeting review", () => {
  const markup = render(
    <MeetingReview
      snapshot={SNAPSHOT}
      lastReceipt={null}
      pendingAction={null}
      onBack={noop}
      onTitleSet={noop}
      onSpeakerRename={noop}
      onSpeakerMerge={noop}
      onSegmentEdit={noop}
      onNoteCreate={noop}
      onNoteUpdate={noop}
      onNoteDelete={noop}
      onRegenerate={noop}
      onExport={noop}
      onRemoteCancel={noop}
      onDelete={noop}
      onRefresh={async () => {}}
    />,
  );

  test("opens on the transcript tab with all four panels reachable", () => {
    expect(markup).toContain('aria-label="Meeting review sections"');
    /* The strip is Radix now, so the ids that wire a tab to its panel are
     * generated rather than authored — asserting them would pin a detail the
     * kit owns. The contract is the roles and the selected state. */
    expect(occurrences(markup, 'role="tab"')).toBe(4);
    /* Every tab is a word you could say out loud: the questions tab is
     * "Questions", not the "Q&A" abbreviation it used to carry. */
    for (const label of ["Transcript", "Insights", "Ledger", "Questions"]) {
      expect(markup).toContain(`>${label}<`);
    }
    /* All four panels are rendered so the strip is navigable without JS, but
     * exactly one is open: the active trigger and the active panel. */
    expect(occurrences(markup, 'role="tabpanel"')).toBe(4);
    expect(occurrences(markup, 'data-state="active"')).toBe(2);
    expect(markup).toContain("We ship the meetings redesign this week.");
  });

  test("transcript panel carries speakers, segments, coverage and gaps", () => {
    expect(markup).toContain("We ship the meetings redesign this week.");
    expect(markup).toContain('id="meeting-transcript-segment-segment-1"');
    /* The roster says what happened in plain words. "Diarization" is the
     * subsystem's name for separating speakers and reaches no reader. */
    expect(markup).toContain("Speakers are up to date");
    expect(markup).not.toContain("iarization");
    expect(markup).toContain(">Merge speakers<");
    expect(markup).toContain(">Remove segment<");
    expect(markup).toContain("Permission lost");
    expect(markup).toContain("Dropped frames: 128");
    expect(markup).toContain("Gaps: 2");
    expect(markup).toContain('aria-label="Exact search"');
    expect(markup).toContain('placeholder="Search this meeting"');
  });

  test("keeps the export and delete actions on the record", () => {
    expect(markup).toContain(">Export Markdown<");
    expect(markup).toContain(">Export JSON<");
    expect(markup).toContain(">Delete meeting<");
    /* The capture length is presented as one measurement: an ELAPSED label and
     * its value, not the sentence "Captured 30:45". */
    expect(markup).toContain(">Elapsed<");
    expect(markup).toContain(">30:45<");
  });
});

describe("insights panel", () => {
  const insightsMarkup = (
    overrides: Partial<React.ComponentProps<typeof InsightsTab>>,
  ) =>
    render(
      <InsightsTab
        snapshot={SNAPSHOT}
        busy={false}
        editable
        canRegenerate
        newNote=""
        analytics={null}
        speakerNames={{}}
        doneActionItems={new Set()}
        onNewNoteChange={noop}
        onCreateNote={noop}
        onNoteUpdate={noop}
        onNoteDelete={noop}
        onRegenerate={noop}
        onJumpToSegment={noop}
        onActionItemToggle={noop}
        onRefresh={async () => {}}
        onAnalyticsRefresh={async () => {}}
        {...overrides}
      />,
    );

  test("renders every generated section with citations as jump controls", () => {
    const markup = insightsMarkup({});
    for (const heading of [
      "Summary",
      "Topics",
      "Decisions",
      "Action items",
      "Key questions",
      "Risks",
      "Follow-up",
    ]) {
      expect(markup).toContain(`>${heading}<`);
    }
    expect(markup).toContain("The team agreed to ship this week.");
    expect(markup).toContain("Owner: Aktan · Due: No due date");
    expect(markup).toContain(">Transcript 0:12</button>");
    expect(markup).toContain(">Regenerate<");
    // Manual notes stay separate from what was generated.
    expect(markup).toContain("Ask about the export format.");
    expect(markup).toContain("Timestamp 0:30");
  });

  test("processing in flight replaces generated notes with an honest wait", () => {
    const markup = insightsMarkup({
      snapshot: {
        ...SNAPSHOT,
        artifacts: [],
        session: {
          ...SNAPSHOT.session,
          phase: "processing",
          processing_status: { kind: "running" },
        },
      },
    });
    expect(markup).toContain("Sona is still processing this meeting");
    expect(markup).toContain(">Refresh<");
  });

  test("a remote destination that never arrived says so instead of spinning", () => {
    const markup = insightsMarkup({
      snapshot: {
        ...SNAPSHOT,
        artifacts: [],
        session: {
          ...SNAPSHOT.session,
          processing_status: { kind: "failed", reason: "remote_unavailable" },
        },
      },
    });
    expect(markup).toContain(
      "The remote destination never became available, so nothing was generated. Regenerating runs on this Mac.",
    );
    expect(markup).toContain("No generated notes are available yet.");
  });
});

describe("question panel", () => {
  const questionsMarkup = (
    overrides: Partial<React.ComponentProps<typeof QuestionsTab>>,
  ) =>
    render(
      <QuestionsTab
        snapshot={SNAPSHOT}
        canAskQuestion
        question=""
        askingQuestion={false}
        onQuestionChange={noop}
        onAskQuestion={noop}
        onForgetQuestion={noop}
        onJumpToSegment={noop}
        {...overrides}
      />,
    );

  test("separates the question from the answer and cites the transcript", () => {
    const markup = questionsMarkup({});
    expect(markup).toContain(">You asked<");
    expect(markup).toContain(">Sona answered<");
    expect(markup).toContain("What did we decide about the release?");
    expect(markup).toContain("You agreed to ship on Thursday.");
    expect(markup).toContain(">Transcript 0:12</button>");
    expect(markup).toContain(">Forget this answer<");
    expect(markup).toContain(">Ask locally<");
  });

  test("says why asking is unavailable and offers no dead control", () => {
    const markup = questionsMarkup({
      snapshot: { ...SNAPSHOT, questions: [] },
      canAskQuestion: false,
    });
    expect(markup).toContain("Asking needs a finished local transcript.");
    expect(markup).toContain("No saved local answers.");
    expect(buttonTag(markup, "Ask locally")).toContain("disabled");
  });
});

/* The ledger is the one surface where an inferred claim and the quote it was
 * read from have to stay side by side. These pin that: a state never renders
 * without its receipt, the receipt jumps to the transcript, and a failed
 * receipt check is named with counts rather than softened. */

const RECEIPT_CITATIONS = [
  {
    segment_id: "segment-1",
    start_offset_ns: 12_000_000_000,
    end_offset_ns: 14_000_000_000,
  },
];

const LEDGER: MeetingLedger = {
  headline: "Pricing came back at the end and nobody closed it.",
  threads: [
    {
      topic: "Pricing tiers",
      state: "unanswered",
      substantive: true,
      receipt: {
        quote: "We never actually said which tier the trial converts into.",
        speaker: "Dana",
        t_ms: 12_000,
        citations: RECEIPT_CITATIONS,
      },
      owner: null,
    },
    {
      topic: "Sign-off",
      state: "closed",
      substantive: false,
      receipt: {
        quote: "Right, that is everyone, thanks all.",
        speaker: "Amir",
        t_ms: 12_000,
        citations: RECEIPT_CITATIONS,
      },
      owner: "Amir",
    },
  ],
  open_loops: [
    {
      question: "Which tier does the trial convert into?",
      instead: "Amir answered the discount question instead.",
      at_ms: 12_000,
      citations: RECEIPT_CITATIONS,
    },
  ],
  commitments: [
    {
      who: "Amir",
      what: "Draft the tier comparison",
      firmness: "firm",
      receipt: {
        quote: "I will draft the tier comparison by Friday.",
        speaker: "Amir",
        t_ms: 12_000,
        citations: RECEIPT_CITATIONS,
      },
    },
  ],
  stances: [
    {
      from: "Amir",
      to: "Dana",
      what: "Ship the annual plan first",
      note: "Dana agreed without pushback.",
      at_ms: 12_000,
      citations: RECEIPT_CITATIONS,
    },
  ],
  caveats: [
    "Speaker labels came from diarization, not from names anyone said.",
  ],
  receipts: { status: "verified" },
};

/* The actionable half of the same ledger: the words come from the artifact
 * above, the state comes from the store. The question arrives carried forward,
 * which is the one row shape only a series produces. */
const LOOPS: MeetingLoopRow[] = [
  {
    loop_id: "session-1:loop:0f1e2d3c4b5a6978",
    session_id: "session-1",
    kind: "loop",
    text: "Which tier does the trial convert into?",
    owner_text: null,
    owner_person_id: null,
    owner_display_name: null,
    status: "open",
    resolved_at_utc_ms: null,
    resolving_operation_id: null,
    carried_into_loop_id: null,
    carried_since_at_utc_ms: 1_700_000_000_000,
    at_ms: 12_000,
    revision: 0,
    instead: "Amir answered the discount question instead.",
    firmness: null,
    quote: null,
    speaker: null,
    citations: RECEIPT_CITATIONS,
  },
  {
    loop_id: "session-1:commitment:8796a5b4c3d2e1f0",
    session_id: "session-1",
    kind: "commitment",
    text: "Draft the tier comparison",
    owner_text: "Amir",
    owner_person_id: null,
    owner_display_name: null,
    status: "open",
    resolved_at_utc_ms: null,
    resolving_operation_id: null,
    carried_into_loop_id: null,
    carried_since_at_utc_ms: null,
    at_ms: 12_000,
    revision: 0,
    instead: null,
    firmness: "firm",
    quote: "I will draft the tier comparison by Friday.",
    speaker: "Amir",
    citations: RECEIPT_CITATIONS,
  },
];

/* bindings.ts is regenerated at integration, so a fixture attaches the ledger
 * the same way the app reads it: through one cast at the seam. */
const ledgerSnapshot = (ledger: MeetingLedger): MeetingReviewSnapshot => {
  const [artifact] = SNAPSHOT.artifacts;
  return {
    ...SNAPSHOT,
    artifacts: [
      {
        ...artifact,
        content: artifact.content && { ...artifact.content, ledger },
      },
    ],
  };
};

describe("meeting ledger", () => {
  const ledgerMarkup = (
    overrides: Partial<React.ComponentProps<typeof MeetingLedgerSection>>,
  ) =>
    render(
      <MeetingLedgerSection
        snapshot={ledgerSnapshot(LEDGER)}
        busy={false}
        canExport
        loops={LOOPS}
        people={[]}
        onJumpToSegment={noop}
        onExportLedger={noop}
        onLoopChange={noop}
        {...overrides}
      />,
    );

  test("states each thread beside the quote it was read from, and jumps to it", () => {
    const markup = ledgerMarkup({});
    expect(markup).toContain("Pricing tiers");
    expect(markup).toContain("No reply");
    expect(markup).toContain(
      "We never actually said which tier the trial converts into.",
    );
    // The receipt is a citation, and a citation is a jump.
    expect(markup).toContain(">Transcript 0:12</button>");
    // Small talk stays on the record and out of the score: the sign-off is
    // `closed`, which is a landed state, and the score is still 0 of 1 — one
    // substantive thread, unanswered — rather than 1 of 2.
    expect(markup).toContain("Sign-off");
    expect(markup).toContain(">aside<");
    expect(markup).toContain(">0/1<");
  });

  test("carries the four registers and the receipt verdict", () => {
    const markup = ledgerMarkup({});
    expect(markup).toContain("Which tier does the trial convert into?");
    expect(markup).toContain("Amir answered the discount question instead.");
    expect(markup).toContain("Draft the tier comparison");
    expect(markup).toContain(">Firm<");
    expect(markup).toContain("Amir → Dana");
    expect(markup).toContain("Ship the annual plan first");
    expect(markup).toContain(
      "Speaker labels came from diarization, not from names anyone said.",
    );
    expect(markup).toContain(">verified<");
  });

  test("names what a failed receipt check removed, with counts", () => {
    const markup = ledgerMarkup({
      snapshot: ledgerSnapshot({
        ...LEDGER,
        receipts: {
          status: "degraded",
          dropped_threads: 2,
          dropped_commitments: 1,
        },
      }),
    });
    expect(markup).toContain("2 threads, 1 commitments removed");
  });

  test("offers the export, and no dead control when there is nothing to export", () => {
    expect(ledgerMarkup({})).toContain(">Export ledger page<");
    expect(
      buttonTag(ledgerMarkup({ canExport: false }), "Export ledger page"),
    ).toContain("disabled");

    const withoutLedger = ledgerMarkup({
      snapshot: { ...SNAPSHOT, artifacts: [] },
    });
    expect(withoutLedger).toContain(
      "No ledger has been read from this meeting yet",
    );
    expect(withoutLedger).not.toContain("Export ledger page");
  });

  test("reads the ledger off the newest current revision that carries one", () => {
    const [artifact] = ledgerSnapshot(LEDGER).artifacts;
    const stale = { ...artifact, state: "out_of_date" as const };
    const ledgerless = { ...SNAPSHOT.artifacts[0], artifact_id: "artifact-0" };
    expect(currentLedger([stale])).toBeNull();
    expect(currentLedger([ledgerless])).toBeNull();
    expect(currentLedger([ledgerless, artifact])?.ledger.headline).toBe(
      LEDGER.headline,
    );
  });

  /* D18: the two actionable registers are rows you act on, so each states
   * where it stands, who it belongs to, and offers only the controls its own
   * state can reach. A carried row says so — that line is the only thing on
   * the review screen that names the series. */
  test("states each loop, its owner, and only the controls its state allows", () => {
    const markup = ledgerMarkup({});

    expect(occurrences(markup, 'data-slot="loop-row"')).toBe(2);
    expect(occurrences(markup, ">Open<")).toBe(2);
    expect(markup).toContain("Owner: Nobody yet");
    expect(markup).toContain("Owner: Amir");
    expect(markup).toContain("Carried forward from an earlier meeting");
    // Open rows can be dropped; nothing here has been dropped or carried, so
    // there is no Reopen to press.
    expect(occurrences(markup, ">Drop</button>")).toBe(2);
    expect(markup).not.toContain(">Reopen</button>");
  });

  test("a settled loop offers the way back, and a done one is struck through", () => {
    const markup = ledgerMarkup({
      loops: [
        { ...LOOPS[0], status: "carried" },
        { ...LOOPS[1], status: "done" },
      ],
    });

    expect(markup).toContain(">Carried forward<");
    expect(markup).toContain(">Done<");
    expect(occurrences(markup, ">Reopen</button>")).toBe(1);
    expect(markup).not.toContain(">Drop</button>");
    expect(markup).toContain("line-through");
  });

  /* Until the first read lands there is nothing to act on: the registers read
   * as empty and every control is out, rather than a spinner over four rows. */
  test("reads as empty and inert before the first loop read lands", () => {
    const markup = ledgerMarkup({ loops: null });

    expect(markup).not.toContain('data-slot="loop-row"');
    expect(markup).toContain("No question was left without an answer.");
    expect(markup).toContain("Nobody committed to anything out loud.");
  });
});

/* What a row says about itself, and the one action that can change it.
 *
 * A meeting left behind by a launch that ended used to read "Processing"
 * forever: its phase was parked for a human but its recorded status still said
 * `pending`, and a chip that trusted the status could not tell the difference
 * between work in flight and work abandoned. The store now resolves that at
 * startup, and these tests hold the reading end of the same contract: no
 * status value on its own may produce the Processing chip, a row that ended
 * badly says why, and Retry appears only where it can run. */

const PHASES: MeetingPhase[] = [
  "preflight",
  "starting",
  "capturing_recording",
  "capturing_pausing",
  "capturing_paused",
  "capturing_resuming",
  "stopping",
  "processing",
  "review_ready",
  "recovery_required",
  "deleting",
];

const STATUSES: ProcessingStatus[] = [
  { kind: "pending" },
  { kind: "running" },
  { kind: "succeeded" },
  { kind: "cancelled" },
  { kind: "failed", reason: "interrupted" },
  { kind: "failed", reason: "engine_failure" },
  { kind: "failed", reason: "local_model_unavailable" },
];

/** The store's own list filters, as SQL-free predicates. Mirrors
 *  `status_predicate` in src-tauri/src/meeting/store.rs — the chip and the
 *  filter that returns a row have to agree, and this is where drift shows. */
const matchingFilters = (phase: MeetingPhase, status: ProcessingStatus) => {
  const arms: MeetingStatusFilter[] = ["any"];
  if (phase === "review_ready" && status.kind === "succeeded") {
    arms.push("ready");
  }
  if (
    phase === "processing" ||
    phase === "stopping" ||
    status.kind === "pending" ||
    status.kind === "running"
  ) {
    arms.push("processing");
  }
  if (
    phase === "recovery_required" ||
    status.kind === "failed" ||
    status.kind === "cancelled"
  ) {
    arms.push("failed");
  }
  return arms;
};

const STRANDED: MeetingHistorySummary = {
  ...SUMMARY,
  session_id: "meeting-stranded",
  title: "Yesterday's standup",
  phase: "recovery_required",
  processing_status: { kind: "failed", reason: "interrupted" },
};

describe("what a meeting row says about itself", () => {
  /** The phases a live job can belong to: the only ones the Processing chip is
   *  allowed to come from, whatever a row's status says. */
  const IN_FLIGHT: MeetingPhase[] = [
    "preflight",
    "stopping",
    "processing",
    "deleting",
  ];

  test("no processing status on its own can claim a meeting is processing", () => {
    for (const phase of PHASES) {
      for (const status of STATUSES) {
        if (meetingCardStatus(phase, status) !== "processing") continue;
        expect({
          phase,
          status: status.kind,
          inFlight: IN_FLIGHT.includes(phase),
        }).toEqual({ phase, status: status.kind, inFlight: true });
      }
    }
  });

  test("every shape the store can hold agrees with the filter that returns it", () => {
    /* The shapes a launch can leave on disk. A meeting is born `pending` in
     * preflight and stays `pending` while it captures; only a finished job
     * writes a terminal status, and startup reconciliation writes one for the
     * job nobody finished. That is why `review_ready` with an unresolved
     * status is not here — it would mean a meeting arrived at review without
     * its run ending — and why `deleting` is not either: the store's list
     * excludes that phase outright. */
    const reachable: [MeetingPhase, ProcessingStatus][] = [
      ["preflight", { kind: "pending" }],
      ["starting", { kind: "pending" }],
      ["capturing_recording", { kind: "pending" }],
      ["capturing_pausing", { kind: "pending" }],
      ["capturing_paused", { kind: "pending" }],
      ["capturing_resuming", { kind: "pending" }],
      ["stopping", { kind: "pending" }],
      ["processing", { kind: "pending" }],
      ["processing", { kind: "succeeded" }],
      ["processing", { kind: "cancelled" }],
      ["processing", { kind: "failed", reason: "engine_failure" }],
      ["review_ready", { kind: "succeeded" }],
      ["review_ready", { kind: "cancelled" }],
      ["review_ready", { kind: "failed", reason: "local_model_unavailable" }],
      // Before the sweep runs, and after it.
      ["recovery_required", { kind: "pending" }],
      ["recovery_required", { kind: "failed", reason: "interrupted" }],
      ["recovery_required", { kind: "failed", reason: "engine_failure" }],
    ];

    for (const [phase, status] of reachable) {
      const arms = matchingFilters(phase, status);
      const chip = meetingCardStatus(phase, status);
      expect({ phase, status, failed: chip === "needs_attention" }).toEqual({
        phase,
        status,
        failed: arms.includes("failed"),
      });
      expect({ phase, status, ready: chip === "ready" }).toEqual({
        phase,
        status,
        ready: arms.includes("ready"),
      });
      if (chip === "processing") {
        expect({
          phase,
          status,
          processingArm: arms.includes("processing"),
        }).toEqual({ phase, status, processingArm: true });
      }
    }
  });

  test("a meeting an interrupted launch left behind reads as needing attention", () => {
    expect(meetingCardStatus("recovery_required", { kind: "pending" })).toBe(
      "needs_attention",
    );
    expect(
      meetingCardStatus("recovery_required", {
        kind: "failed",
        reason: "interrupted",
      }),
    ).toBe("needs_attention");
    // The shape the sweep produces has left the Processing filter for good.
    expect(
      matchingFilters("recovery_required", {
        kind: "failed",
        reason: "interrupted",
      }),
    ).not.toContain("processing");
  });
});

describe("recovering a meeting from the list", () => {
  test("the row says what happened and offers to run it again", () => {
    const markup = homeMarkup({ meetings: [STRANDED] });
    expect(markup).toContain(">Needs attention</span>");
    expect(markup).toContain(">Interrupted before it finished</span>");
    // "Needs attention" is a state, not an explanation, so the reason has to
    // be on the row beside it.
    expect(occurrences(markup, ">Try again</button>")).toBe(1);
    expect(markup).not.toContain(">Processing</span>");
  });

  test("a finished meeting gets no chip, no reason line and no retry", () => {
    const markup = homeMarkup({ meetings: [SUMMARY] });
    expect(markup).toContain(">Weekly planning</span>");
    expect(markup).not.toContain(">Needs attention</span>");
    expect(markup).not.toContain(">Ready</span>");
    expect(occurrences(markup, ">Try again</button>")).toBe(0);
  });

  test("a meeting that failed after review keeps its reason and is offered no retry", () => {
    const markup = homeMarkup({
      meetings: [
        {
          ...SUMMARY,
          phase: "review_ready",
          processing_status: {
            kind: "failed",
            reason: "local_model_unavailable",
          },
        },
      ],
    });
    expect(markup).toContain(">Local model unavailable</span>");
    expect(occurrences(markup, ">Try again</button>")).toBe(
      0,
      // There is no command that reprocesses a meeting from review, so an
      // enabled Retry here would be a button that cannot do its job.
    );
  });
});
