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
  },
  error: null,
});

const commitment: PersonOpenLoop = {
  meeting_id: "meeting-commitment",
  title: "Weekly planning",
  at_utc_ms: nowMs - 60_000,
  text: "Send the revised launch notes",
  owner_person_id: null,
  carried_since_at_utc_ms: null,
};

const render = (
  receipts: readonly WorkflowRunReceipt[],
  commitments: readonly PersonOpenLoop[],
  receiptStatus: "loading" | "loaded" | "error" = "loaded",
  commitmentStatus: "loading" | "loaded" | "error" = "loaded",
): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <OverviewWorkflowCardsView
        receipts={
          receiptStatus === "loaded"
            ? { status: "loaded", entries: receipts }
            : { status: receiptStatus }
        }
        commitments={
          commitmentStatus === "loaded"
            ? { status: "loaded", entries: commitments }
            : { status: commitmentStatus }
        }
        onOpenMeeting={() => {}}
        onRetryReceipts={() => {}}
        onRetryCommitments={() => {}}
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

    expect(markup).toContain("What Sona did");
    expect(markup).toContain("Updated 1 person link");
    expect(markup).toContain("Updated 2 person links");
    expect(markup).toContain("Updated 3 person links");
    expect(markup.includes("Linked Morgan to the meeting")).toBe(false);
    expect(markup.includes("Older receipt")).toBe(false);
    expect(
      markup.split('data-testid="overview-workflow-receipt"').length - 1,
    ).toBe(3);
    expect(markup).toContain('data-meeting-id="meeting-one"');
  });

  test("shows open commitments with an exact meeting target", () => {
    const markup = render([], [commitment]);

    expect(markup).toContain("Commitments");
    expect(markup).toContain("Send the revised launch notes");
    expect(markup).toContain("Weekly planning");
    expect(markup).toContain('data-meeting-id="meeting-commitment"');
    expect(markup).toContain('aria-label="Open meeting Weekly planning"');
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
    expect(markup).toContain("Commitments");
    expect(markup.split("Loading…").length - 1).toBe(2);
  });
});
