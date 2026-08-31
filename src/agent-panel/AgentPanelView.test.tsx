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
  AgentPanelTurnStatusV1,
  AgentPanelWorkspaceV1,
  SonaAgentChatTurnV1,
} from "@/bindings";
import { AgentPanelView, linkifySona, type PanelPhase } from "./AgentPanelView";

/* The panel's one hard rule is that a datum appears once per screen. It used to
 * break it in three places at once — the phase sentence in the header AND in the
 * body, "Working…" in the header AND in the running row, "Proposed changes" as
 * both the section's accessible name and its visible heading — which is what the
 * rebuild was asked to remove. Those are counting assertions, so they are the
 * ones worth pinning: a future edit that re-adds an echo cannot pass them.
 *
 * The activity rail is the newest place that rule can break: it names the turn
 * state and counts the elapsed seconds, so the header no longer prints a
 * "Working…" of its own, and `agentPanel.status` has no `running` sentence to
 * print. The phase still exists — it decides what the body may draw — it just
 * has nothing left to say that the rail is not already saying.
 *
 * Colour and layout resolve through the shared light and dark theme tokens. */

const localeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

/* SAFETY: the en bundle is checked in beside this test; agentPanel.status
 * carries one sentence per phase that speaks, agentPanel.turnState one per
 * relay turn state, and scripts/check-translations.ts holds every locale to
 * that key set. A missing key would fail the render assertions below with the
 * raw key in the markup. */
const en = JSON.parse(fs.readFileSync(localeRoot, "utf8")) as {
  agentPanel: Record<
    "cancel" | "proposalTitle" | "retry" | "empty" | "activityLabel",
    string
  > & {
    status: Record<Exclude<PanelPhase, "running">, string>;
    turnState: Record<AgentPanelTurnStatusV1["state"], string>;
    step: Record<"sent", string>;
    workspace: Record<AgentPanelWorkspaceV1, string>;
    placeholder: Record<AgentPanelWorkspaceV1, string>;
  };
};

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

/** The phases that print a sentence of their own. `running` does not: see above. */
const SPEAKING_PHASES: Array<Exclude<PanelPhase, "running">> = [
  "loading",
  "disabled",
  "unpaired",
  "offline",
  "idle",
  "proposal",
  "error",
];

const CONVERSATION: readonly SonaAgentChatTurnV1[] = [
  { role: "user", message: "Turn off filler removal" },
  { role: "assistant", message: "Here is what that changes." },
];

const ANSWER: readonly SonaAgentChatTurnV1[] = [
  { role: "user", message: "What did I promise Steven?" },
  {
    role: "assistant",
    message: "The deck, by Friday. sona://meeting/m-1",
  },
];

const STARTED_AT = 1_764_000_000_000;

const TURN: AgentPanelTurnStatusV1 = {
  turn_id: "t1",
  workspace: "sona_chat",
  state: "running",
  event_cursor: 0,
  started_at_utc_ms: STARTED_AT,
  steps: [],
};

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
  turn?: AgentPanelTurnStatusV1 | null;
  now?: number;
  proposal?: AgentPanelProposalPreviewV1 | null;
  error?: string | null;
  lastIdentity?: string | null;
  draft?: string;
  workspace?: AgentPanelWorkspaceV1;
}

const render = ({
  phase,
  conversation = [],
  turn = null,
  now = STARTED_AT,
  proposal = null,
  error = null,
  lastIdentity = null,
  draft = "",
  workspace = "sona_chat",
}: ViewCase): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <AgentPanelView
        phase={phase}
        lastIdentity={lastIdentity}
        conversation={conversation}
        turn={turn}
        now={now}
        proposal={proposal}
        error={error}
        draft={draft}
        workspace={workspace}
        sending={false}
        onToggle={() => {}}
        onRefresh={() => {}}
        onCancel={() => {}}
        onApply={() => {}}
        onUndo={() => {}}
        onSend={() => {}}
        onDraftChange={() => {}}
        onWorkspaceChange={() => {}}
        onOpenLink={() => {}}
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

const classNames = (markup: string): string[] =>
  [...markup.matchAll(/class="([^"]*)"/g)].map((match) => match[1]);

describe("the panel says each thing exactly once", () => {
  test("every phase that speaks renders its sentence in one place and one place only", () => {
    for (const phase of SPEAKING_PHASES) {
      const sentence = en.agentPanel.status[phase];
      const markup = render({
        phase,
        conversation: CONVERSATION,
        error: phase === "error" ? "relay handshake timed out" : null,
      });
      expect(occurrences(markup, sentence)).toBe(1);
    }
  });

  test("a running turn says so on the rail, and the header does not say it again", () => {
    const markup = render({
      phase: "running",
      conversation: CONVERSATION,
      turn: TURN,
    });
    // The rail names the state, once, beside a timer.
    expect(occurrences(markup, en.agentPanel.turnState.running)).toBe(1);
    expect(markup).toContain(en.agentPanel.activityLabel);
    expect(markup).toContain(en.agentPanel.cancel);
    // And the header's phase slot is empty, so there is no dot with nothing to
    // mean and no second word for the same fact.
    expect(occurrences(markup, en.agentPanel.step.sent)).toBe(1);
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

describe("a free-text answer", () => {
  test("lands in the scrollback with no card behind it", () => {
    const markup = render({ phase: "idle", conversation: ANSWER });
    expect(markup).toContain("The deck, by Friday. ");
    // An answer is a message, not a proposal: nothing to apply, nothing to undo.
    expect(markup.includes(en.agentPanel.proposalTitle)).toBe(false);
    expect(markup.includes("agent-panel-proposal-title")).toBe(false);
  });

  test("a proposal turn still gets its card beside the same scrollback", () => {
    const markup = render({
      phase: "proposal",
      conversation: CONVERSATION,
      proposal: PROPOSAL,
    });
    expect(markup).toContain(CONVERSATION[1].message);
    expect(markup).toContain(en.agentPanel.proposalTitle);
  });
});

/* The pack the panel is given is quotes plus `sona://` addresses
 * (`query/pack.rs`), so an answer that used its evidence writes those addresses
 * back. Left as text they are the one thing on screen that looks clickable and
 * is not. */
describe("an answer's citations", () => {
  test("every address in the message becomes its own control, in place", () => {
    expect(
      linkifySona("Two: sona://meeting/m-1 and sona://person/p-2."),
    ).toEqual([
      { text: "Two: " },
      { link: "sona://meeting/m-1" },
      { text: " and " },
      { link: "sona://person/p-2" },
      { text: "." },
    ]);
  });

  test("a message with no address is one piece of prose", () => {
    expect(linkifySona("Nothing to cite.")).toEqual([
      { text: "Nothing to cite." },
    ]);
  });

  /* The sentence's punctuation is not part of the address, and a scheme with
   * nothing after it addresses nothing. */
  test("what is not part of the address stays prose", () => {
    expect(
      linkifySona("Ends here: sona://loop/m-1:loop:abc, then more"),
    ).toEqual([
      { text: "Ends here: " },
      { link: "sona://loop/m-1:loop:abc" },
      { text: ", then more" },
    ]);
    expect(linkifySona("a sona:// b")).toEqual([{ text: "a sona:// b" }]);
  });

  test("the assistant's bubble carries the address as a button", () => {
    const markup = render({ phase: "idle", conversation: ANSWER });
    expect(markup).toContain(">sona://meeting/m-1</button>");
  });

  /* Only the assistant cites. A question that happens to contain an address is
   * the reader's own words, and rewriting those is not this surface's job. */
  test("the reader's own message is left alone", () => {
    const markup = render({
      phase: "idle",
      conversation: [{ role: "user", message: "open sona://meeting/m-9" }],
    });
    expect(markup).toContain("open sona://meeting/m-9");
    expect(markup.includes(">sona://meeting/m-9</button>")).toBe(false);
  });
});

describe("the activity rail", () => {
  test("counts from the turn's own start, not from when the panel painted", () => {
    const markup = render({
      phase: "running",
      conversation: ANSWER,
      turn: TURN,
      now: STARTED_AT + 95_000,
    });
    expect(markup).toContain("1:35");
    expect(markup).toContain("tabular-nums");
  });

  test("an empty steps list is the normal case, not a missing one", () => {
    const markup = render({ phase: "running", turn: TURN });
    expect(markup).toContain(en.agentPanel.activityLabel);
    // The two rows a turn always has, and nothing pretending to load.
    expect(occurrences(markup, "<li")).toBe(2);
  });

  test("reported steps become rows under the turn's own state", () => {
    const markup = render({
      phase: "running",
      turn: {
        ...TURN,
        steps: [
          { id: "s1", label: "Searched meetings", state: "done" },
          { id: "s2", label: "Read the transcript", state: "running" },
        ],
      },
    });
    expect(markup).toContain("Searched meetings");
    expect(markup).toContain("Read the transcript");
    expect(occurrences(markup, "<li")).toBe(4);
  });

  test("a finished turn keeps its rail and loses its cancel", () => {
    const markup = render({
      phase: "idle",
      conversation: ANSWER,
      turn: { ...TURN, state: "succeeded" },
    });
    expect(markup).toContain(en.agentPanel.turnState.succeeded);
    expect(markup.includes(en.agentPanel.cancel)).toBe(false);
  });
});

describe("the composer", () => {
  test("names both workspaces and marks the live one", () => {
    const markup = render({ phase: "idle", workspace: "sona_chat" });
    expect(markup).toContain(en.agentPanel.workspace.sona_chat);
    expect(markup).toContain(en.agentPanel.workspace.sona_config);
    expect(occurrences(markup, 'role="radio" aria-checked="true"')).toBe(1);
    expect(markup).toContain(en.agentPanel.placeholder.sona_chat);
  });

  test("switching workspace switches what the field asks for", () => {
    const markup = render({ phase: "idle", workspace: "sona_config" });
    expect(markup).toContain(en.agentPanel.placeholder.sona_config);
    expect(markup.includes(en.agentPanel.placeholder.sona_chat)).toBe(false);
  });
});

describe("the panel theme", () => {
  test("the page, the cards and the hairlines all name a theme step", () => {
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
  });

  test("the only hues are the two that mean something", () => {
    /* Porcelain/Ink is a gray ladder. Red says broken, amber says waiting on
     * you, and there is no third meaning — so blue, the old "working" accent,
     * is gone along with the violet it replaced. Checked across every phase
     * that draws, because a hue that only appears while offline is still a
     * hue in the panel. */
    const painted = [
      render({ phase: "running", conversation: ANSWER, turn: TURN }),
      render({ phase: "offline", conversation: ANSWER }),
      render({ phase: "error", error: "handshake timed out" }),
      render({
        phase: "proposal",
        conversation: CONVERSATION,
        proposal: PROPOSAL,
      }),
      render({
        phase: "idle",
        turn: { ...TURN, steps: [{ id: "s", label: "x", state: "failed" }] },
      }),
    ].join("\n");

    for (const banned of ["blue", "violet", "green", "indigo", "purple"]) {
      expect(painted.includes(banned)).toBe(false);
    }
    /* Every colour utility in the markup, reduced to its scale name. Anything
     * outside the ladder plus red/amber is a new hue nobody signed off on. */
    const scales = new Set(
      classNames(painted)
        .flatMap((value) => value.split(/\s+/))
        .map(
          (token) =>
            /(?:bg|text|border|divide|ring)-([a-z]+)-\d/.exec(token)?.[1],
        )
        .filter((scale): scale is string => scale !== undefined),
    );
    expect([...scales].sort()).toEqual(["amber", "background", "gray", "red"]);
  });

  test("nothing gradients, and nothing at rest is lifted", () => {
    const markup = render({
      phase: "proposal",
      conversation: CONVERSATION,
      proposal: PROPOSAL,
      turn: TURN,
    });
    const tokens = classNames(markup).flatMap((value) => value.split(/\s+/));
    expect(
      tokens.filter((token) => /gradient|^(from|via|to)-/.test(token)),
    ).toEqual([]);
    expect(
      tokens.filter((token) => /^shadow-(sm|md|lg|xl)$/.test(token)),
    ).toEqual([]);
    /* No page-local class survives the port. Checked inside `class` attributes
     * only — the one legitimate `agent-panel-` string left in the markup is the
     * proposal title's id, which aria-labelledby has to point at. */
    expect(
      classNames(markup).filter((value) => value.includes("agent-panel-")),
    ).toEqual([]);
  });
});
