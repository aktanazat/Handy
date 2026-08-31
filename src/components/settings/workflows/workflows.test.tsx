import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { WorkflowRunReceipt, WorkflowsListResult } from "@/bindings";
import { TooltipProvider } from "@/components/vg/tooltip";
import { WorkflowList } from "./WorkflowList";
import { WorkflowRunLog } from "./WorkflowRunLog";
import { runsForLastSevenDays } from "./workflowRuns";
import { formatWorkflowOutcome } from "./formatWorkflowOutcome";

const localePath = path.join(
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
    en: { translation: JSON.parse(fs.readFileSync(localePath, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const render = (node: React.ReactElement): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  );

const nowMs = new Date(2026, 7, 30, 12, 0, 0).getTime();

const receipt = (
  id: string,
  status: WorkflowRunReceipt["status"],
  outcome: string,
  daysAgo: number,
): WorkflowRunReceipt => ({
  id,
  workflow_id:
    status === "failed"
      ? "continuity"
      : status === "skipped"
        ? "document_linking"
        : "person_linking",
  event_kind: "meeting_finalized",
  jump_target: null,
  status,
  started_at_utc_ms: nowMs - daysAgo * 86_400_000,
  finished_at_utc_ms: nowMs - daysAgo * 86_400_000 + 100,
  outcome_summary: outcome,
  outcome_code:
    status === "failed"
      ? "failed"
      : status === "skipped"
        ? "skipped"
        : "person_links",
  outcome_counts: {
    changes: status === "ok" ? 2 : 0,
    persons: 0,
    series: 0,
    carried: 0,
    candidates: 0,
  },
  error: status === "failed" ? "failed for test" : null,
});

describe("Workflows settings", () => {
  const data: WorkflowsListResult = {
    schema_version: 1,
    revision: 7,
    entries: [
      {
        id: "person_linking",
        enabled: true,
        last_run: receipt("latest", "ok", "Linked two people", 0),
      },
      { id: "vocabulary_mining", enabled: false, last_run: null },
    ],
  };

  test("renders each built-in with its description, switch and last receipt", () => {
    const markup = render(
      <WorkflowList
        data={data}
        loading={false}
        error={false}
        pendingWorkflowId={null}
        onRetry={() => {}}
        onToggle={() => {}}
        nowMs={nowMs}
      />,
    );

    expect(markup).toContain("Built-in workflows");
    expect(markup).toContain("Person linking");
    expect(markup).toContain(
      "Connects meetings to people using confirmed attendee and speaker evidence.",
    );
    expect(markup).toContain("Updated 2 person links");
    expect(markup.includes("Linked two people")).toBe(false);
    expect(markup).toContain("Completed");
    expect(markup).toContain("Not run yet");
    expect(markup).toContain('aria-label="Enable Person linking"');
    expect(markup).toContain('data-state="checked"');
    expect(markup).toContain('data-state="unchecked"');
  });

  test("renders the paged run log newest first with statuses and a seven-day chart", () => {
    const receipts = [
      receipt("newest", "ok", "Newest outcome", 0),
      receipt("failed", "failed", "Failed outcome", 1),
      receipt("skipped", "skipped", "Skipped outcome", 2),
    ];
    const markup = render(
      <WorkflowRunLog
        receipts={receipts}
        loading={false}
        loadingMore={false}
        error={false}
        hasMore={true}
        onRetry={() => {}}
        onLoadMore={() => {}}
        nowMs={nowMs}
      />,
    );

    expect(markup.indexOf('data-workflow-run-id="newest"')).toBeLessThan(
      markup.indexOf('data-workflow-run-id="failed"'),
    );
    expect(markup.indexOf('data-workflow-run-id="failed"')).toBeLessThan(
      markup.indexOf('data-workflow-run-id="skipped"'),
    );
    expect(markup).toContain("Updated 2 person links");
    expect(markup.includes("Newest outcome")).toBe(false);
    expect(markup).toContain("Completed");
    expect(markup).toContain("Failed");
    expect(markup).toContain("Skipped");
    expect(markup).toContain(
      'aria-label="Workflow runs per day, 3 in the last 7 days"',
    );
    expect(markup).toContain("Load more");
    expect(markup.split("<rect").length - 1).toBe(7);
  });

  test("uses one quiet glyph and no chart before the first run", () => {
    const markup = render(
      <WorkflowRunLog
        receipts={[]}
        loading={false}
        loadingMore={false}
        error={false}
        hasMore={false}
        onRetry={() => {}}
        onLoadMore={() => {}}
        nowMs={nowMs}
      />,
    );

    expect(markup).toContain("No workflow runs yet.");
    expect(markup.split("<svg").length - 1).toBe(1);
    expect(markup.includes("Workflow runs per day")).toBe(false);
  });
});

describe("formatWorkflowOutcome", () => {
  const format = (
    code: WorkflowRunReceipt["outcome_code"],
    counts: Partial<WorkflowRunReceipt["outcome_counts"]> = {},
  ) => {
    const base = receipt("formatter", "ok", "machine-only", 0);
    return formatWorkflowOutcome(
      {
        ...base,
        outcome_code: code,
        outcome_counts: { ...base.outcome_counts, ...counts },
      },
      i18n.t,
    );
  };

  test("maps every structured count family without using the stored summary", () => {
    expect(format("person_links", { changes: 1 })).toBe(
      "Updated 1 person link",
    );
    expect(format("briefing", { persons: 2 })).toBe(
      "Prepared a briefing for 2 people",
    );
    expect(format("continuity", { series: 3, carried: 1 })).toBe(
      "Updated 3 meeting series · carried 1 open loop",
    );
    expect(format("vocabulary_candidates", { candidates: 4 })).toBe(
      "Found 4 vocabulary suggestions",
    );
    expect(format("document_links", { changes: 2 })).toBe(
      "Updated 2 document links",
    );
    expect(format("already_processed")).toBe("Already processed");
    expect(format("failed")).toBe("Run failed");
    expect(format("skipped")).toBe("Skipped");
  });
});

describe("runsForLastSevenDays", () => {
  test("uses local calendar-day buckets and ignores older receipts", () => {
    expect(
      runsForLastSevenDays(
        [
          receipt("today", "ok", "", 0),
          receipt("yesterday", "ok", "", 1),
          receipt("also-yesterday", "ok", "", 1),
          receipt("too-old", "ok", "", 7),
        ],
        nowMs,
      ),
    ).toEqual([0, 0, 0, 0, 0, 2, 1]);
  });
});
