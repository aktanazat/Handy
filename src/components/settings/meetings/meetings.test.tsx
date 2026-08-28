import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type {
  MeetingHistorySummary,
  MeetingReviewSnapshot,
  MeetingSuggestion,
} from "@/bindings";
import { MeetingLive } from "./MeetingLive";
import { MeetingDraftComposer, MeetingPreflight } from "./MeetingPreflight";
import { InsightsTab, QuestionsTab } from "./MeetingReviewPanels";
import { MeetingReview } from "./MeetingReview";
import { MeetingsHome } from "./MeetingsHome";
import { MeetingsSettings } from "./MeetingsSettings";
import type { MeetingPreflightDraft } from "./meetingTypes";

/* First paint of every meetings surface. The strings asserted here are the
 * ones the Playwright suite, the command palette and the design spec pin:
 * "New meeting", "Start local notes", "Check recording setup", "Active
 * capture" and the consent sentence, which has to stay byte-identical because
 * the end-to-end test checks the box by its label.
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

const render = (node: React.ReactElement) =>
  renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

const occurrences = (markup: string, needle: string) =>
  markup.split(needle).length - 1;

/** Opening tag of the button whose whole label is `label`. */
const buttonTag = (markup: string, label: string) => {
  const labelIndex = markup.indexOf(`>${label}</button>`);
  if (labelIndex === -1) return "";
  return markup.slice(markup.lastIndexOf("<button", labelIndex), labelIndex);
};

const DRAFT: MeetingPreflightDraft = {
  title: "Weekly planning",
  origin: "manual",
  suggestionId: null,
  requestedSources: ["microphone", "system_audio"],
  requiredSources: ["microphone", "system_audio"],
  acceptedKnownMissingSources: [],
  degradedStartPolicy: "abort_if_required_source_fails",
  destination: { kind: "local" },
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

const homeMarkup = (
  overrides: Partial<React.ComponentProps<typeof MeetingsHome>>,
) =>
  render(
    <MeetingsHome
      suggestions={[]}
      recovery={[]}
      meetings={[]}
      loading={false}
      loadingMore={false}
      hasMore={false}
      retention={null}
      error={null}
      onStartManual={noop}
      onStartSuggestion={noop}
      onOpenMeeting={noop}
      onFinalizeRecovery={noop}
      onDiscardRecovery={noop}
      onLoadMore={noop}
      onRetry={noop}
      {...overrides}
    />,
  );

describe("meetings section", () => {
  test("mounts on first paint and waits on the list skeleton", () => {
    const markup = render(<MeetingsSettings />);
    expect(markup).toContain('aria-label="Loading meeting history…"');
    expect(markup).toContain(">Meetings</h1>");
    expect(markup).toContain(">New meeting<");
  });
});

describe("meetings list", () => {
  test("shows a loading skeleton before the first page lands", () => {
    const markup = homeMarkup({ loading: true });
    expect(markup).toContain('aria-label="Loading meeting history…"');
    expect(markup).toContain("ui-skeleton");
    expect(occurrences(markup, "No meetings yet")).toBe(0);
  });

  test("empty history offers the New meeting action", () => {
    const markup = homeMarkup({});
    expect(markup).toContain("No meetings yet");
    expect(markup).toContain(
      "Start local notes when you are ready to capture a meeting.",
    );
    // Header action plus the empty-state call to action.
    expect(occurrences(markup, ">New meeting<")).toBe(2);
  });

  test("a detected meeting exposes exactly one Start local notes control", () => {
    const markup = homeMarkup({ suggestions: [SUGGESTION] });
    expect(markup).toContain("A meeting may be active in Zoom.");
    expect(occurrences(markup, ">Start local notes<")).toBe(1);
  });

  test("rows read title, date and state as text, with the retention hint", () => {
    const markup = homeMarkup({
      meetings: [SUMMARY],
      retention: { kind: "delete_after_days", days: 30 },
      hasMore: true,
    });
    expect(markup).toContain("Weekly planning");
    expect(markup).toContain("Ready for review");
    expect(markup).toContain("Complete");
    expect(markup).toContain("Retention: Delete after 30 days.");
    expect(markup).toContain("Load older meetings");
    expect(markup).toContain('aria-label="Search meetings"');
  });
});

describe("meeting setup", () => {
  test("the draft composer keeps its heading and the readiness check", () => {
    const markup = render(
      <MeetingDraftComposer
        draft={DRAFT}
        suggestion={null}
        submitting={false}
        onChange={noop}
        onCheck={noop}
        onCancel={noop}
      />,
    );
    expect(markup).toContain(">Start local notes</h1>");
    expect(markup).toContain(">Check recording setup</button>");
    // The button lives on the next screen, so the flow cannot be skipped.
    expect(occurrences(markup, ">Start local notes</button>")).toBe(0);
    expect(markup).toContain(
      "Remote processing is unavailable in this build, so every meeting is transcribed and summarised on this Mac.",
    );
  });

  test("preflight gates capture behind the unchanged consent sentence", () => {
    const markup = render(
      <MeetingPreflight
        snapshot={{
          ...SNAPSHOT,
          session: { ...SNAPSHOT.session, phase: "preflight" },
        }}
        draft={DRAFT}
        refreshing={false}
        starting={false}
        onRefresh={noop}
        onReconfigure={noop}
        onCancel={noop}
        onStart={noop}
      />,
    );
    expect(markup).toContain(">Check recording setup</h1>");
    expect(markup).toContain("I have permission to capture this meeting.");
    expect(buttonTag(markup, "Start local notes")).toContain("disabled");
    // System audio needs permission here, so the partial path is offered too.
    expect(markup).toContain(
      "I want to continue with a partial meeting record.",
    );
    expect(markup).toContain(
      "I understand System audio is Permission required and this meeting will be partial.",
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
    expect(markup).toContain("Active capture");
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

  test("opens on the transcript tab with all three panels reachable", () => {
    expect(markup).toContain('aria-label="Meeting review sections"');
    expect(markup).toContain('id="tab-transcript"');
    expect(markup).toContain('id="tab-insights"');
    expect(markup).toContain('id="tab-questions"');
    expect(markup).toContain('aria-labelledby="tab-transcript"');
  });

  test("transcript panel carries speakers, segments, coverage and gaps", () => {
    expect(markup).toContain("We ship the meetings redesign this week.");
    expect(markup).toContain('id="meeting-transcript-segment-segment-1"');
    expect(markup).toContain("Speaker assignments current");
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
    expect(markup).toContain("Captured 30:45");
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
        onNewNoteChange={noop}
        onCreateNote={noop}
        onNoteUpdate={noop}
        onNoteDelete={noop}
        onRegenerate={noop}
        onJumpToSegment={noop}
        onRefresh={async () => {}}
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
      expect(markup).toContain(`>${heading}</h4>`);
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
    expect(markup).toContain(">You asked</p>");
    expect(markup).toContain(">Sona answered</p>");
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
