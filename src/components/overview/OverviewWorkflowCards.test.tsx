import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { PersonOpenLoop, WorkflowRunReceipt } from "@/bindings";
import { OverviewWorkflowCardsView } from "./OverviewWorkflowCards";

const localePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
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
    en: { translation: JSON.parse(fs.readFileSync(localePath, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const nowMs = new Date(2026, 7, 30, 12, 0, 0).getTime();

const run = (
  id: string,
  outcome: string,
  minutesAgo: number,
): WorkflowRunReceipt => ({
  id,
  workflow_id: "person_linking",
  event_kind: "meeting_finalized",
  jump_target: { kind: "meeting", session_id: `meeting-${id}` },
  status: "ok",
  started_at_utc_ms: nowMs - minutesAgo * 60_000,
  finished_at_utc_ms: nowMs - minutesAgo * 60_000 + 100,
  outcome_summary: outcome,
  outcome_code: "person_links",
  outcome_counts: {
    changes: minutesAgo,
    persons: 0,
    series: 0,
    carried: 0,
    candidates: 0,
    suggestions: 0,
    terms: 0,
    meetings: 0,
    loops_closed: 0,
    suggestions_waiting: 0,
    waiting_on_stale: 0,
  },
  error: null,
});

/* A meeting-recording run with nothing to open: skipping a detected meeting
 * leaves no session, and the line still has to reach the reader. */
const skippedRecording: WorkflowRunReceipt = {
  ...run("skipped", "consent receipt", 1),
  workflow_id: "meeting_activity",
  jump_target: null,
  outcome_code: "prompt_ignored",
};

/* A learning pass that found nothing still writes a receipt. The shipped
 * Capture page turned those into "Noticed 0 things" rows. */
const learningRun = (id: string, suggestions: number): WorkflowRunReceipt => ({
  ...run(id, "learning pass", 5),
  workflow_id: "spoken_punctuation",
  outcome_code: "learning_suggestions",
  outcome_counts: {
    changes: 0,
    persons: 0,
    series: 0,
    carried: 0,
    candidates: 0,
    suggestions,
    terms: 0,
    meetings: 0,
    loops_closed: 0,
    suggestions_waiting: 0,
    waiting_on_stale: 0,
  },
});

const openLoop: PersonOpenLoop = {
  loop_id: "loop-open",
  meeting_id: "meeting-open-loop",
  title: "Weekly planning",
  at_utc_ms: nowMs - 60_000,
  text: "Send the revised launch notes",
  owner_person_id: null,
  status: "open",
  direction: "waiting_on",
  waiting_on_stale: false,
  carried_since_at_utc_ms: null,
  carried_into_meeting_id: null,
};

const render = (
  receipts: readonly WorkflowRunReceipt[],
  openLoops: readonly PersonOpenLoop[],
  receiptStatus: "loading" | "loaded" | "error" = "loaded",
  openLoopStatus: "loading" | "loaded" | "error" = "loaded",
): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <OverviewWorkflowCardsView
        receipts={
          receiptStatus === "loaded"
            ? { status: "loaded", entries: receipts }
            : { status: receiptStatus }
        }
        openLoops={
          openLoopStatus === "loaded"
            ? { status: "loaded", entries: openLoops }
            : { status: openLoopStatus }
        }
        onOpenMeeting={() => {}}
        onRetryReceipts={() => {}}
        onRetryOpenLoops={() => {}}
        nowMs={nowMs}
      />
    </I18nextProvider>,
  );

describe("Overview workflow cards", () => {
  test("shows the newest three successful receipts as meeting jumps", () => {
    const markup = render(
      [
        run("one", "Linked Morgan to the meeting", 1),
        run("two", "Carried one commitment", 2),
        run("three", "Updated the meeting brief", 3),
        run("four", "Older receipt", 4),
      ],
      [],
    );

    /* The feed speaks human and counts from the receipt: the subsystem's own
     * name for itself never reaches a sentence, and neither does the summary
     * string the run stored. */
    expect(markup).toContain("What Sona did");
    expect(markup).toContain("Remembered 1 person");
    expect(markup).toContain("Remembered 2 people");
    expect(markup).toContain("Remembered 3 people");
    expect(markup.includes("Linked Morgan to the meeting")).toBe(false);
    expect(markup.includes("Older receipt")).toBe(false);
    expect(
      markup.split('data-testid="overview-workflow-receipt"').length - 1,
    ).toBe(3);
    expect(markup).toContain('data-meeting-id="meeting-one"');
  });

  test("shows a recording line that has no meeting to open", () => {
    const markup = render([skippedRecording], []);

    expect(markup).toContain("Skipped recording a detected meeting");
    expect(markup).toContain("Meeting recording");
    expect(markup).toContain('data-testid="overview-workflow-receipt"');
    /* No target, so no button and no dead click — and the stored summary
     * ("consent receipt") never reaches the reader either. */
    expect(markup).not.toContain("data-meeting-id");
    expect(markup).not.toContain("consent receipt");
  });

  test("counts a learning pass only when it noticed something", () => {
    expect(render([learningRun("found", 2)], [])).toContain("Noticed 2 things");

    const quiet = render([learningRun("quiet", 0)], []);

    /* "Noticed 0 things" is a row about nothing. The run log under Settings
     * keeps it; this card is a list of what changed. */
    expect(quiet).not.toContain("Noticed 0 things");
    expect(quiet).not.toContain('data-testid="overview-workflow-receipt"');
  });

  test("hides the card when every receipt it was handed did nothing", () => {
    expect(render([learningRun("quiet", 0)], [])).toBe("");
  });

  test("shows what is still open with an exact meeting target", () => {
    const markup = render([], [openLoop]);

    /* The card is named after what it lists. It reads the open-loop inbox, so
     * "Commitments" was the wrong word for it in two directions at once. */
    expect(markup).toContain("Open loops");
    expect(markup).toContain("Send the revised launch notes");
    expect(markup).toContain("Weekly planning");
    expect(markup).toContain('data-meeting-id="meeting-open-loop"');
    expect(markup).toContain('aria-label="Open meeting Weekly planning"');
  });

  test("still reads out a promise whose meeting is gone, without a button", () => {
    const markup = render([], [{ ...openLoop, meeting_id: "" }]);

    /* A row with nothing to open is a row, not a dead button — the same rule
     * the receipt list already follows for a skipped recording. */
    expect(markup).toContain("Send the revised launch notes");
    expect(markup).toContain('data-testid="overview-open-loop"');
    expect(markup).not.toContain("<button");
  });

  test("renders no wrapper or card chrome when both commands are empty", () => {
    expect(render([], [])).toBe("");
  });

  test("keeps failed cards visible with a translated retry row", () => {
    const markup = render([], [], "error", "error");

    expect(markup.split("load this card.").length - 1).toBe(2);
    expect(markup.split(">Retry</button>").length - 1).toBe(2);
    expect(markup).toContain('role="alert"');
  });

  test("keeps loading cards distinct from a successful empty result", () => {
    const markup = render([], [], "loading", "loading");

    expect(markup).toContain("What Sona did");
    expect(markup).toContain("Open loops");
    expect(markup.split("Loading…").length - 1).toBe(2);
  });

  test("gives a solo card the whole content measure", () => {
    /* Both cards present: two columns from the md breakpoint up. */
    expect(render([run("one", "Linked Morgan", 1)], [openLoop])).toContain(
      "md:grid-cols-2",
    );

    /* Only one card has anything to say, so it spans the row instead of
     * sitting at half width beside an empty column. */
    expect(render([run("one", "Linked Morgan", 1)], [])).not.toContain(
      "md:grid-cols-2",
    );
    expect(render([], [openLoop])).not.toContain("md:grid-cols-2");
  });
});
