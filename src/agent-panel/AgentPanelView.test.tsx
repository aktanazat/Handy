import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type {
  AgentPanelProposalPreviewV1,
  SonaAgentChatTurnV1,
} from "@/bindings";
import { AgentPanelView, type PanelPhase } from "./AgentPanelView";

/* The panel's one hard rule is that a datum appears once per screen. It used to
 * break it in three places at once — the phase sentence in the header AND in the
 * body, "Working…" in the header AND in the running row, "Proposed changes" as
 * both the section's accessible name and its visible heading — which is what the
 * rebuild was asked to remove. Those are counting assertions, so they are the
 * ones worth pinning: a future edit that re-adds an echo cannot pass them.
 *
 * Colour and layout are Tailwind classes resolved against the Geist theme at
 * build time; how they look in dark/light is screenshot work for the parent. */

const localeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

/* SAFETY: the en bundle is checked in beside this test; agentPanel.status
 * carries one sentence per phase, and scripts/check-translations.ts holds
 * every locale to that key set. A missing key would fail the render
 * assertions below with the raw key in the markup. */
const en = JSON.parse(fs.readFileSync(localeRoot, "utf8")) as {
  agentPanel: Record<"cancel" | "proposalTitle" | "retry" | "empty", string> & {
    status: Record<PanelPhase, string>;
  };
};

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

const PHASES: PanelPhase[] = [
  "loading",
  "disabled",
  "unpaired",
  "offline",
  "idle",
  "running",
  "proposal",
  "error",
];

const CONVERSATION: readonly SonaAgentChatTurnV1[] = [
  { role: "user", message: "Turn off filler removal" },
  { role: "assistant", message: "Here is what that changes." },
];

const PROPOSAL: AgentPanelProposalPreviewV1 = {
  proposal_id: "p1",
  summary: "Disable filler-word removal for Email mode.",
  rationale: "You asked for verbatim transcripts in that mode.",
  actions: [{ key: "audio_feedback", value: false }],
  follow_up_question: null,
  source_settings_revision: 4,
  confirmation: "review",
  state: "pending",
  receipt_id: null,
  applied_revision: null,
};

interface ViewCase {
  phase: PanelPhase;
  conversation?: readonly SonaAgentChatTurnV1[];
  hasTurn?: boolean;
  proposal?: AgentPanelProposalPreviewV1 | null;
  error?: string | null;
  lastIdentity?: string | null;
  draft?: string;
}

const render = ({
  phase,
  conversation = [],
  hasTurn = false,
  proposal = null,
  error = null,
  lastIdentity = null,
  draft = "",
}: ViewCase): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <AgentPanelView
        phase={phase}
        lastIdentity={lastIdentity}
        conversation={conversation}
        hasTurn={hasTurn}
        proposal={proposal}
        error={error}
        draft={draft}
        sending={false}
        onToggle={() => {}}
        onRefresh={() => {}}
        onCancel={() => {}}
        onApply={() => {}}
        onUndo={() => {}}
        onSend={() => {}}
        onDraftChange={() => {}}
      />
    </I18nextProvider>,
  );

/** How many times a string is rendered into the markup, overlapping matches
 * included — the question is "does the user read this twice", not "how many
 * distinct nodes". */
const occurrences = (markup: string, needle: string): number => {
  let count = 0;
  for (let at = markup.indexOf(needle); at !== -1; ) {
    count += 1;
    at = markup.indexOf(needle, at + 1);
  }
  return count;
};

describe("the panel says each thing exactly once", () => {
  test("every phase renders its sentence in one place and one place only", () => {
    for (const phase of PHASES) {
      const sentence = en.agentPanel.status[phase];
      const markup = render({
        phase,
        conversation: CONVERSATION,
        hasTurn: phase === "running",
        error: phase === "error" ? "relay handshake timed out" : null,
      });
      expect(occurrences(markup, sentence)).toBe(1);
    }
  });

  test("a running turn adds a spinner and a cancel, not a second 'Working…'", () => {
    const markup = render({
      phase: "running",
      conversation: CONVERSATION,
      hasTurn: true,
    });
    expect(occurrences(markup, en.agentPanel.status.running)).toBe(1);
    expect(markup).toContain(en.agentPanel.cancel);
    expect(markup).toContain("animate-spin");
  });

  test("the proposal heading is also the section's accessible name", () => {
    const markup = render({
      phase: "proposal",
      conversation: CONVERSATION,
      proposal: PROPOSAL,
    });
    // One rendering of the title, reached by aria-labelledby rather than by a
    // second copy of the same string in an aria-label.
    expect(occurrences(markup, en.agentPanel.proposalTitle)).toBe(1);
    expect(markup).toContain('aria-labelledby="agent-panel-proposal-title"');
    expect(markup.includes('aria-label="Proposed changes"')).toBe(false);
    expect(markup).toContain(PROPOSAL.summary);
    expect(markup).toContain("audio_feedback");
  });
});

describe("which regions a phase is allowed to draw", () => {
  test("an empty panel centres the sentence and shows no composer", () => {
    for (const phase of ["loading", "disabled", "unpaired", "error"] as const) {
      const markup = render({ phase, conversation: CONVERSATION });
      // No conversation, no composer: there is nothing to say to a relay that
      // is not there, and the history belongs to a session that is not open.
      expect(markup.includes("<form")).toBe(false);
      expect(markup.includes(CONVERSATION[0].message)).toBe(false);
      // The header's phase slot is empty, so the dot cannot be a colour with
      // nothing beside it to mean.
      expect(markup.includes("rounded-full")).toBe(false);
    }
  });

  test("offline keeps the history and the composer — the relay is away, not the panel", () => {
    const markup = render({ phase: "offline", conversation: CONVERSATION });
    expect(markup).toContain(CONVERSATION[0].message);
    expect(markup).toContain("<form");
    // Its sentence is chrome here, so it comes with the dot and the retry.
    expect(markup).toContain("rounded-full");
    expect(markup).toContain(en.agentPanel.retry);
  });

  test("an idle panel with no history invites the first question once", () => {
    const markup = render({ phase: "idle" });
    expect(occurrences(markup, en.agentPanel.empty)).toBe(1);
    expect(occurrences(markup, en.agentPanel.status.idle)).toBe(1);
    expect(markup).toContain("<form");
  });
});

describe("the panel is on Geist tokens", () => {
  test("the page, the cards and the hairlines all name a Geist step", () => {
    const markup = render({
      phase: "proposal",
      conversation: CONVERSATION,
      proposal: PROPOSAL,
      lastIdentity: "k1:9f2c",
    });
    expect(markup).toContain("bg-background-200"); // page
    expect(markup).toContain("bg-background-100"); // card
    expect(markup).toContain("border-gray-alpha-400"); // hairline
    expect(markup).toContain("text-gray-1000"); // primary ink
    expect(markup).toContain("font-mono"); // microlabel + identity
    // The accent is Geist blue now; violet is dead everywhere.
    expect(markup).toContain("bg-blue-700");
    expect(markup.includes("violet")).toBe(false);
    /* No page-local class survives the port. Checked inside `class` attributes
     * only — the one legitimate `agent-panel-` string left in the markup is the
     * proposal title's id, which aria-labelledby has to point at. The previous
     * form of this compared two booleans and passed even with a stray class
     * beside the id, which is no assertion at all. */
    const classNames = [...markup.matchAll(/class="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(classNames.length).toBeGreaterThan(10);
    expect(
      classNames.filter((value) => value.includes("agent-panel-")),
    ).toEqual([]);
    /* And nothing in this panel carries a resting shadow: Geist is flat, and the
     * only shadow the kit ships at rest is vg Button's own `shadow-xs`, which
     * belongs to the kit rather than to this surface. */
    expect(
      classNames.filter((value) => /\bshadow-(sm|md|lg|xl)\b/.test(value)),
    ).toEqual([]);
  });
});
