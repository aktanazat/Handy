import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/vg/tooltip";
import { AppContent } from "@/App";
import { commands } from "@/bindings";
import type {
  AgentChatConversationSummaryV1,
  AgentPanelActionV1,
  AgentPanelProposalPreviewV1,
  AgentPanelStatusV1,
  AgentPanelTurnStatusV1,
  AgentPanelWorkspaceV1,
  SonaAgentChatTurnV1,
} from "@/bindings";
import { askSona } from "@/components/commandPaletteSearch";
import { ChatHistoryList } from "./ChatHistoryMenu";
import { ChatSheet } from "./ChatSheet";
import { sendSheetTurn } from "./ChatSheetHost";
import type { ChatPhase } from "./chatModel";
import {
  chatPhase,
  composerKeys,
  composerSend,
  isStillWaiting,
  linkifySona,
  proposalRowIndex,
  retryMessage,
  sheetKeys,
  stepMs,
  turnFailure,
  workedMs,
  workRowIndex,
} from "./chatModel";

/* The chat sheet: the six states it can be in, the two gestures that open and
 * close it, and the two callers that now target it instead of a second window.
 *
 * Copy comes from the shipped en bundle rather than a fixture, so a missing
 * `chat.*` key fails here as a raw key in the markup instead of on a screen.
 * `renderToStaticMarkup` runs no effects and no events, which is why the
 * gestures are pinned against the exported handlers. */

const localeFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

// SAFETY: the en bundle is repo-owned and the catalogue tests pin these keys;
// the narrow states the shape this test reads, not a guess about foreign data.
const en = JSON.parse(fs.readFileSync(localeFile, "utf8")) as {
  chat: {
    empty: string;
    title: string;
    close: string;
    history: string;
    historyEmpty: string;
    newChat: string;
    placeholder: string;
    scopeLabel: string;
    send: string;
    stop: string;
    retry: string;
    openSettings: string;
    workedFor: string;
    error: Record<"unreachable" | "refused" | "failed", string>;
    working: Record<"searchedCorpus" | "stillWaiting" | "cancel", string>;
    status: Record<"disabled" | "unpaired" | "offline" | "error", string>;
    turnState: Record<"running", string>;
    proposal: Record<"apply" | "applied" | "undo", string>;
    action: Record<
      | "resolve_loop"
      | "add_vocabulary_term"
      | "apply"
      | "dismiss"
      | "applied"
      | "undo"
      | "dismissed",
      string
    >;
    tools: Record<"label", string>;
  };
};

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeFile, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const paint = (node: React.ReactElement): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  );

const occurrences = (markup: string, needle: string): number =>
  markup.split(needle).length - 1;

/* `renderToStaticMarkup` escapes text, so an expectation lifted from the JSON
 * bundle has to be escaped the same way before it can be looked for. */
const escaped = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

const noop = () => undefined;

const TURN: AgentPanelTurnStatusV1 = {
  turn_id: "t1",
  workspace: "sona_chat",
  state: "running",
  event_cursor: 0,
  started_at_utc_ms: 1_000,
  completed_at_utc_ms: null,
  steps: [],
  actions: [],
  failure: null,
};

const PROPOSAL: AgentPanelProposalPreviewV1 = {
  proposal_id: "p1",
  summary: "Disable filler-word removal for Email mode.",
  rationale: "You asked for verbatim transcripts in that mode.",
  actions: [{ key: "theme", value: "dark" }],
  follow_up_question: null,
  source_settings_revision: 7,
  confirmation: "automatic",
  state: "pending",
  receipt_id: null,
  applied_revision: null,
};

const user = (message: string): SonaAgentChatTurnV1 => ({
  role: "user",
  message,
});
const assistant = (message: string): SonaAgentChatTurnV1 => ({
  role: "assistant",
  message,
});

interface SheetCase {
  open?: boolean;
  phase?: ChatPhase;
  conversation?: readonly SonaAgentChatTurnV1[];
  turn?: AgentPanelTurnStatusV1 | null;
  proposal?: AgentPanelProposalPreviewV1 | null;
  history?: readonly AgentChatConversationSummaryV1[];
  historyOpen?: boolean;
  now?: number;
  searchedCorpus?: boolean;
  toolsAllowed?: boolean;
  workspace?: AgentPanelWorkspaceV1;
}
const sheet = ({
  open = true,
  phase = "ready",
  conversation = [],
  turn = null,
  proposal = null,
  history = [],
  historyOpen = false,
  now = 6_000,
  searchedCorpus = false,
  toolsAllowed = false,
  workspace = "sona_chat",
}: SheetCase = {}): string =>
  paint(
    <ChatSheet
      open={open}
      phase={phase}
      conversationId={null}
      conversation={conversation}
      turn={turn}
      searchedCorpus={searchedCorpus}
      proposal={proposal}
      history={history}
      historyOpen={historyOpen}
      now={now}
      draft=""
      workspace={workspace}
      toolsAllowed={toolsAllowed}
      busy={false}
      error={null}
      onClose={noop}
      onHistoryOpenChange={noop}
      onSelectConversation={noop}
      onNewChat={noop}
      onDraftChange={noop}
      onWorkspaceChange={noop}
      onSend={noop}
      onStop={noop}
      onApply={noop}
      onUndo={noop}
      onApplyAction={noop}
      onDismissAction={noop}
      onToolsAllowedChange={noop}
      onOpenLink={noop}
      onOpenSettings={noop}
      onRetry={noop}
      onRetryTurn={noop}
    />,
  );

describe("the column's shape", () => {
  /* Closed it is still mounted — the shell needs a 0pt structural column to
   * return the page to 680 — so nothing can reach or read its fixed frame. */
  test("closed: mounted, 0 wide, inert, and out of the a11y tree", () => {
    const markup = sheet({ open: false });

    expect(markup).toContain('data-slot="chat-sheet"');
    expect(markup).toContain('data-slot="chat-frame"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("inert");
    expect(markup).toContain("pointer-events-none w-0");
  });

  /* The layout takes the 340 in the press frame. The fixed frame reads the
   * root shell's registered timeline after that; it owns no transition of its
   * own, and no scrim or blur returns the page to being hidden behind chat. */
  test("open: 340 of layout and a fixed frame on the shell timeline", () => {
    const markup = sheet();

    expect(markup).toContain('data-slot="chat-frame"');
    expect(markup).toContain("transition-none");
    expect(markup).toContain(
      "[transform:translateX(var(--shell-chat-offset))]",
    );
    expect(markup).toContain("w-[340px]");
    // One stronger hairline against the page, and no dimming of what is behind it.
    expect(markup).toContain("border-s border-gray-alpha-500");
    expect(markup).not.toContain("bg-black/");
    expect(markup).not.toContain("backdrop-blur");
  });

  /* Two boxes: the structural width box that makes room for the page, and the
   * fixed frame that keeps one physical window edge through both the open and
   * closed geometry. That stable edge is what lets a close slide out rather
   * than jump to the edge before it moves. */
  test("open: a structural width box and one fixed contained frame", () => {
    const markup = sheet();
    const outer = /<aside[^>]*class="([^"]*)"/.exec(markup)?.[1] ?? "";

    expect(outer).toContain("transition-none");
    expect(outer).toContain("flex-none");
    expect(outer).toContain("w-[340px]");
    expect(outer).not.toContain("border-s");
    expect(markup).toContain("fixed inset-y-0 end-0");
    expect(markup).toContain("[contain:layout_style]");
    // Stated on both boxes, and nowhere else.
    expect(occurrences(markup, "w-[340px]")).toBe(2);
  });

  test("the header names the chat between one X and two round controls", () => {
    const markup = sheet();

    expect(occurrences(markup, 'data-slot="chat-close"')).toBe(1);
    expect(occurrences(markup, 'data-slot="chat-history"')).toBe(1);
    expect(occurrences(markup, 'data-slot="chat-new"')).toBe(1);
    expect(markup).toContain(`aria-label="${en.chat.close}"`);
    expect(markup).toContain(`aria-label="${en.chat.history}"`);
    expect(markup).toContain(`aria-label="${en.chat.newChat}"`);
    expect(markup).toContain(`<h2`);
    expect(markup).toContain(en.chat.title);
    expect(markup).toContain("border-b border-gray-alpha-400");
  });

  test("empty: one invitation, a named scope row and a composer", () => {
    const markup = sheet();

    expect(markup).toContain(en.chat.empty);
    expect(markup).toContain(en.chat.scopeLabel);
    expect(occurrences(markup, 'role="radio"')).toBe(2);
    expect(markup).toContain(`placeholder="${en.chat.placeholder}"`);
    expect(markup).toContain(`aria-label="${en.chat.send}"`);
    expect(markup).not.toContain('data-slot="chat-stop"');
  });
});

describe("a turn on screen", () => {
  test("running: a live line, and the send glyph becomes a stop", () => {
    const markup = sheet({
      conversation: [user("What did we decide?")],
      turn: TURN,
    });

    expect(markup).toContain('data-slot="chat-work"');
    expect(markup).toContain(en.chat.turnState.running);
    // 6000 - 1000, whole seconds.
    expect(markup).toContain("5s");
    expect(markup).toContain('data-slot="chat-stop"');
    expect(markup).not.toContain('data-slot="chat-send"');
  });

  test("a live turn stays visible while its conversation is still arriving", () => {
    const markup = sheet({ turn: TURN });

    expect(markup).toContain('data-slot="chat-work"');
    expect(markup).not.toContain('data-slot="chat-empty"');
  });

  test("failed: one typed failure line and a retry under its question", () => {
    for (const failure of ["unreachable", "refused", "failed"] as const) {
      const markup = sheet({
        conversation: [user("What did we decide?")],
        turn: {
          ...TURN,
          state: "failed",
          completed_at_utc_ms: 4_000,
          failure,
        },
      });

      expect(markup).toContain('data-slot="chat-turn-error"');
      expect(markup).toContain(escaped(en.chat.error[failure]));
      expect(markup).toContain(en.chat.retry);
      expect(markup).not.toContain('data-slot="chat-stop"');
    }
  });

  test("waiting: offers the existing cancel action after thirty seconds", () => {
    const queued = { ...TURN, state: "queued" as const };

    expect(isStillWaiting(queued, 30_999)).toBe(false);
    expect(isStillWaiting(queued, 31_000)).toBe(true);
    expect(isStillWaiting({ ...queued, state: "waiting_user" }, 31_000)).toBe(
      false,
    );

    const markup = sheet({
      conversation: [user("What did we decide?")],
      turn: queued,
      now: 31_000,
    });

    expect(markup).toContain('data-slot="chat-still-waiting"');
    expect(markup).toContain(en.chat.working.stillWaiting);
    expect(markup).toContain(en.chat.working.cancel);
  });

  test("marks the sheet turn only when its pack had sources", () => {
    const turn = {
      ...TURN,
      state: "succeeded" as const,
      completed_at_utc_ms: 4_000,
    };
    const sourced = sheet({
      conversation: [user("What did we decide?"), assistant("We decided.")],
      turn,
      searchedCorpus: true,
    });
    const packless = sheet({
      conversation: [user("What did we decide?"), assistant("We decided.")],
      turn,
    });

    expect(sourced).toContain('data-slot="chat-searched-corpus"');
    expect(sourced).toContain(en.chat.working.searchedCorpus);
    expect(packless).not.toContain('data-slot="chat-searched-corpus"');
  });

  /* Steps exist: the line becomes a disclosure, collapsed, with one row and a
   * duration per step. */
  test("running with steps: the line folds the steps away, closed", () => {
    const markup = sheet({
      conversation: [user("What did we decide?")],
      turn: {
        ...TURN,
        steps: [
          {
            id: "s1",
            label: "Read the transcript",
            state: "done",
            started_after_ms: 500,
            ended_after_ms: 2_500,
          },
        ],
      },
    });

    expect(markup).toContain("<details");
    expect(markup).not.toContain("<details open");
    expect(markup).toContain("Read the transcript");
    // 2500 - 500.
    expect(markup).toContain("2s");
  });

  test("answered: the reply is prose on the surface, its links pressable", () => {
    const markup = sheet({
      conversation: [
        user("Where did we say that?"),
        assistant("In sona://meeting/42, before the break."),
      ],
      turn: { ...TURN, state: "succeeded", completed_at_utc_ms: 4_000 },
    });

    expect(markup).toContain("sona://meeting/42");
    expect(markup).toContain("<button");
    expect(markup).not.toContain('data-slot="chat-stop"');
    /* A turn that reported no steps leaves no line behind: the answer is the
     * whole record, and "Worked for 3s" over it would be furniture. */
    expect(markup).not.toContain('data-slot="chat-work"');
  });

  /* With steps there is a line, and its number is fixed by the backend — so
   * reopening the sheet tomorrow still says how long it took rather than how
   * long ago it was. */
  test("answered with steps: the disclosure freezes at the turn's own length", () => {
    const markup = sheet({
      now: 900_000,
      conversation: [user("q"), assistant("a")],
      turn: {
        ...TURN,
        state: "succeeded",
        completed_at_utc_ms: 4_000,
        steps: [
          {
            id: "s1",
            label: "Read the transcript",
            state: "done",
            started_after_ms: 0,
            ended_after_ms: 3_000,
          },
        ],
      },
    });

    expect(markup).toContain('data-slot="chat-work"');
    expect(markup).toContain(
      escaped(en.chat.workedFor.replace("{{seconds}}", "3")),
    );
  });
});

describe("a settings answer", () => {
  test("pending: one card carrying the summary, the change set and Apply", () => {
    const markup = sheet({
      conversation: [user("Go dark"), assistant(PROPOSAL.summary)],
      proposal: PROPOSAL,
    });

    expect(occurrences(markup, 'data-slot="chat-proposal"')).toBe(1);
    // The summary is the card's title and appears once, not once as a message
    // and once as a card.
    expect(occurrences(markup, PROPOSAL.summary)).toBe(1);
    expect(markup).toContain("theme");
    expect(markup).toContain(en.chat.proposal.apply);
    expect(markup).not.toContain(en.chat.proposal.undo);
    /* And it is readable in full at the column's 340: this sentence is the
     * whole of what the assistant said — the card took the row it would
     * otherwise have been printed in — so a truncated one would be an Apply
     * under half a sentence. */
    const summary =
      new RegExp(`<span class="([^"]*)">${PROPOSAL.summary}`).exec(
        markup,
      )?.[1] ?? "";
    expect(summary).not.toContain("truncate");
    expect(summary).toContain("[overflow-wrap:anywhere]");
  });

  test("applied: the same card, now saying so, with an undo beside it", () => {
    const markup = sheet({
      conversation: [user("Go dark"), assistant(PROPOSAL.summary)],
      proposal: {
        ...PROPOSAL,
        state: "applied",
        receipt_id: "receipt-p1-8",
        applied_revision: 8,
      },
    });

    expect(occurrences(markup, 'data-slot="chat-proposal"')).toBe(1);
    expect(markup).toContain(en.chat.proposal.applied);
    expect(markup).toContain(en.chat.proposal.undo);
    expect(markup).not.toContain(`>${en.chat.proposal.apply}<`);
  });
});

const RESOLVE: AgentPanelActionV1 = {
  action_index: 0,
  action: {
    kind: "resolve_loop",
    reason: "You said in the meeting that the deck went out.",
    loop_id: "m-1:commitment:0123456789abcdef",
  },
  state: "pending",
  operation_id: null,
};

const offering = (
  ...actions: AgentPanelActionV1[]
): AgentPanelTurnStatusV1 => ({
  ...TURN,
  state: "succeeded",
  completed_at_utc_ms: 4_000,
  actions,
});

describe("a corpus change the answer offered", () => {
  test("pending: what changes, why, and both ways to answer it", () => {
    const markup = sheet({
      conversation: [user("Close the deck commitment"), assistant("Done?")],
      turn: offering(RESOLVE),
    });

    expect(occurrences(markup, 'data-slot="chat-action"')).toBe(1);
    expect(markup).toContain(en.chat.action.resolve_loop);
    expect(markup).toContain(escaped(RESOLVE.action.reason));
    expect(markup).toContain(en.chat.action.apply);
    expect(markup).toContain(en.chat.action.dismiss);
    expect(markup).not.toContain(en.chat.action.applied);
    /* A loop id is a digest. The card names the kind of change and leaves the
     * row to the reason, which is a sentence about that one commitment. */
    expect(markup).not.toContain("m-1:commitment:0123456789abcdef");
  });

  test("applied: the same card, now saying so, with an undo beside it", () => {
    const markup = sheet({
      turn: offering({
        ...RESOLVE,
        state: "applied",
        operation_id: "3f1a-op",
      }),
    });

    expect(occurrences(markup, 'data-slot="chat-action"')).toBe(1);
    expect(markup).toContain(en.chat.action.applied);
    expect(markup).toContain(en.chat.action.undo);
    expect(markup).not.toContain(`>${en.chat.action.apply}<`);
  });

  test("dismissed: a card that says so and offers nothing", () => {
    const markup = sheet({
      turn: offering({ ...RESOLVE, state: "dismissed" }),
    });

    expect(markup).toContain(en.chat.action.dismissed);
    expect(markup).not.toContain(`>${en.chat.action.apply}<`);
    expect(markup).not.toContain(`>${en.chat.action.undo}<`);
  });

  /* Three offers are three choices, each answerable on its own. */
  test("a set of offers is a card each, in the order they were offered", () => {
    const markup = sheet({
      turn: offering(RESOLVE, {
        action_index: 1,
        action: {
          kind: "add_vocabulary_term",
          reason: "Sona keeps writing it as two words.",
          term: "north star",
          replacement: "Northstar",
        },
        state: "pending",
        operation_id: null,
      }),
    });

    expect(occurrences(markup, 'data-slot="chat-action"')).toBe(2);
    expect(markup.indexOf(en.chat.action.resolve_loop)).toBeLessThan(
      markup.indexOf("Northstar"),
    );
  });

  test("an answer with nothing to offer draws no card", () => {
    const markup = sheet({
      conversation: [user("What did we decide?"), assistant("The deck ships.")],
      turn: offering(),
    });

    expect(markup).not.toContain('data-slot="chat-action"');
  });
});

describe("the per-question tools grant", () => {
  test("off by default, and only offered on the Ask scope", () => {
    const asking = sheet();
    const settings = sheet({ workspace: "sona_config" });

    expect(asking).toContain('data-slot="chat-tools"');
    expect(asking).toContain('aria-checked="false"');
    expect(asking).toContain(en.chat.tools.label);
    expect(settings).not.toContain('data-slot="chat-tools"');
  });

  test("on: the chip says so", () => {
    const markup = sheet({ toolsAllowed: true });
    const chip =
      /<button[^>]*data-slot="chat-tools"[^>]*>/.exec(markup)?.[0] ?? "";

    expect(chip).toContain('aria-checked="true"');
  });
});

describe("the per-question tools grant, as a gesture", () => {
  /* The grant is read into the turn before this runs, so clearing it here is
   * what stops the next question inheriting it. */
  test("a send asks the question and puts the grant back down", () => {
    const done: string[] = [];

    composerSend(
      () => done.push("send"),
      () => done.push("clear"),
    )();

    expect(done).toEqual(["send", "clear"]);
  });
});

describe("the states where nothing would answer", () => {
  test("unpaired: one line and a way to Settings, conversation intact", () => {
    const markup = sheet({
      phase: "unpaired",
      conversation: [user("Anything?")],
    });

    expect(markup).toContain(escaped(en.chat.status.unpaired));
    expect(markup).toContain(en.chat.openSettings);
    // The scrollback is not blanked by a relay that went away.
    expect(markup).toContain("Anything?");
  });

  test("each broken phase says its own sentence, once", () => {
    for (const phase of ["disabled", "offline", "error"] as const) {
      const markup = sheet({ phase });
      expect(occurrences(markup, escaped(en.chat.status[phase]))).toBe(1);
    }
  });

  test("ready says nothing about the relay at all", () => {
    expect(sheet()).not.toContain('data-slot="chat-notice"');
  });
});

describe("the history popover", () => {
  /* Radix portals the popover's content to the document body, which server
   * rendering has none of — so what a press on the clock shows is checked
   * through the list itself. */
  const list = (
    conversations: readonly AgentChatConversationSummaryV1[],
    currentId: string | null = null,
  ): string =>
    paint(
      <ChatHistoryList
        conversations={conversations}
        currentId={currentId}
        onSelect={noop}
      />,
    );

  test("no history: one sentence, not an empty box", () => {
    expect(list([])).toContain(escaped(en.chat.historyEmpty));
  });

  test("with history: one row per conversation, by its title", () => {
    const markup = list([
      {
        conversation_id: "c1",
        title: "What did we decide about pricing?",
        updated_at_utc_ms: 1,
      },
      {
        conversation_id: "c2",
        title: "Who owes the deck?",
        updated_at_utc_ms: 2,
      },
    ]);

    expect(occurrences(markup, "<button")).toBe(2);
    expect(markup).toContain("What did we decide about pricing?");
    expect(markup).toContain("Who owes the deck?");
    expect(markup).not.toContain(escaped(en.chat.historyEmpty));
  });

  /* Picking one loads it, so the list has to say which one you are already in
   * — otherwise twenty rows include the one you are reading and nothing marks
   * it. */
  test("the conversation on screen is marked as current", () => {
    const markup = list(
      [{ conversation_id: "c1", title: "Pricing", updated_at_utc_ms: 1 }],
      "c1",
    );

    expect(markup).toContain('aria-current="true"');
  });

  /* The trigger lives in the sheet's header whether or not it is pressed. */
  test("the clock is in the sheet's header", () => {
    expect(sheet()).toContain('data-slot="chat-history"');
  });
});

describe("the model behind the sheet", () => {
  test("nine relay statuses collapse onto the six the sheet acts on", () => {
    const status = (
      relay: AgentPanelStatusV1["relay_status"],
    ): AgentPanelStatusV1 => ({
      invalidation_id: 1,
      relay_status: relay,
      conversation_id: null,
      conversation: [],
      turn: null,
      proposal: null,
    });

    expect(chatPhase(null)).toBe("loading");
    expect(chatPhase(status("ready"))).toBe("ready");
    expect(chatPhase(status("disabled"))).toBe("disabled");
    expect(chatPhase(status("unpaired"))).toBe("unpaired");
    expect(chatPhase(status("offline"))).toBe("offline");
    for (const relay of [
      "invalid_configuration",
      "secret_unavailable",
      "untrusted_response",
      "remote_rejected",
      "ownership_rejected",
    ] as const) {
      expect(chatPhase(status(relay))).toBe("error");
    }
  });

  test("the work row sits above the answer, and after a live question", () => {
    const finished = {
      ...TURN,
      state: "succeeded" as const,
      steps: [
        {
          id: "s1",
          label: "Read",
          state: "done" as const,
          started_after_ms: 0,
          ended_after_ms: 1,
        },
      ],
    };

    expect(workRowIndex([user("q"), assistant("a")], finished)).toBe(1);
    expect(workRowIndex([user("q")], TURN)).toBe(1);
    // A finished turn that reported nothing has no row: the answer is the record.
    expect(
      workRowIndex([user("q"), assistant("a")], {
        ...TURN,
        state: "succeeded",
      }),
    ).toBe(-1);
  });

  test("a typed failure owns the retry question and its work row", () => {
    const failed = {
      ...TURN,
      state: "failed" as const,
      completed_at_utc_ms: 4_000,
      failure: "unreachable" as const,
    };
    const conversation = [
      user("Earlier question"),
      assistant("Earlier answer"),
      user("Retry this question"),
    ];

    expect(turnFailure(failed)).toBe("unreachable");
    expect(retryMessage(conversation, failed)).toBe("Retry this question");
    expect(retryMessage(conversation, TURN)).toBeNull();
    expect(workRowIndex(conversation, failed)).toBe(3);
  });

  test("the proposal takes the row whose words it already is", () => {
    expect(
      proposalRowIndex([user("q"), assistant(PROPOSAL.summary)], PROPOSAL),
    ).toBe(1);
    expect(proposalRowIndex([user("q"), assistant("other")], PROPOSAL)).toBe(
      -1,
    );
    expect(proposalRowIndex([user("q")], null)).toBe(-1);
  });

  test("a finished turn's elapsed time stops moving", () => {
    const finished = { ...TURN, completed_at_utc_ms: 4_000 };

    expect(workedMs(finished, 6_000)).toBe(3_000);
    expect(workedMs(finished, 900_000)).toBe(3_000);
    expect(workedMs(TURN, 6_000)).toBe(5_000);
  });

  test("a running step is measured against the clock, a finished one is not", () => {
    const running = {
      id: "s",
      label: "Read",
      state: "running" as const,
      started_after_ms: 1_000,
      ended_after_ms: null,
    };

    expect(stepMs(running, TURN, 6_000)).toBe(4_000);
    expect(stepMs({ ...running, ended_after_ms: 2_000 }, TURN, 6_000)).toBe(
      1_000,
    );
  });

  test("sona addresses split out of prose, sentence punctuation excluded", () => {
    expect(linkifySona("See sona://meeting/42, then stop.")).toEqual([
      { text: "See " },
      { link: "sona://meeting/42" },
      { text: ", then stop." },
    ]);
  });
});

describe("the two gestures", () => {
  const press = (key: string, shiftKey = false) => {
    let prevented = false;
    let fired = false;
    const event = {
      key,
      shiftKey,
      preventDefault: () => {
        prevented = true;
      },
    };
    return { event, prevented: () => prevented, fired: () => fired };
  };

  test("Enter sends, Shift+Enter opens a line", () => {
    let sends = 0;
    const send = composerKeys(() => {
      sends += 1;
    });

    const enter = press("Enter");
    send(enter.event);
    expect(sends).toBe(1);
    expect(enter.prevented()).toBe(true);

    const shifted = press("Enter", true);
    send(shifted.event);
    expect(sends).toBe(1);
    expect(shifted.prevented()).toBe(false);
  });

  test("Escape closes the sheet and nothing else does", () => {
    let closes = 0;
    const close = sheetKeys(() => {
      closes += 1;
    });

    close(press("Escape").event);
    expect(closes).toBe(1);

    for (const key of ["Enter", "Tab", "a"]) {
      close(press(key).event);
    }
    expect(closes).toBe(1);
  });
});

/* The pill and the column are one fold, so the shell is where that is
 * checkable: the pill's press has to move the same boolean the column reads,
 * and the column's width has to come off the two columns already there. */
const shell = (chatOpen: boolean): string => {
  const restore = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_OS_PLUGIN_INTERNALS__: { os_type: "macos" } },
  });
  try {
    return paint(
      <AppContent
        onboardingStep="done"
        onAccessibilityComplete={noop}
        onModelSelected={noop}
        direction="ltr"
        currentSection="overview"
        onSectionChange={noop}
        onOpenMeeting={noop}
        loadingLabel="Loading"
        meetingInvalidation={0}
        meetingNavigationRequest={null}
        meetingStartRequest={0}
        personRequest={null}
        organizationRequest={null}
        commandOpen={false}
        commandActions={[]}
        commandSeed={null}
        agentPanel={{
          enabled: true,
          paired: true,
          remoteIntelligence: true,
        }}
        chatOpen={chatOpen}
        onChatOpenChange={noop}
        onCommandOpenChange={noop}
        onCommandOpen={noop}
      />,
    );
  } finally {
    if (restore) Object.defineProperty(globalThis, "window", restore);
    else Reflect.deleteProperty(globalThis, "window");
  }
};

describe("the shell's one fold", () => {
  test("the column is mounted beside the pane, once, whether open or not", () => {
    for (const open of [false, true]) {
      const markup = shell(open);
      const columnAt = markup.indexOf('data-slot="chat-sheet"');

      expect(occurrences(markup, 'data-slot="chat-sheet"')).toBe(1);
      /* After the pane closes, which is the one place it is a column of the
       * window rather than something laid over the page. */
      expect(columnAt).toBeGreaterThan(markup.indexOf("</main>"));
    }
  });

  test("opening it narrows the page instead of covering it", () => {
    const closed = shell(false);
    const open = shell(true);

    // The rail's words are what pay for the column: 220 becomes 48.
    expect(closed).toContain("w-[220px]");
    expect(open).toContain("w-[48px]");
    /* The pane is what is left, and it is left to flex into it: no width of
     * its own anywhere, so 900 - 48 - 340 is arithmetic rather than a number
     * somebody has to keep in step. */
    const pane = /<main class="([^"]*)"/.exec(open)?.[1] ?? "";
    expect(pane).toContain("flex-1");
    expect(pane).toContain("min-w-0");
    expect(pane).not.toMatch(/\bw-\[/);
  });

  test("the pill is the door and the column's X is the way back", () => {
    // Closed: one pill, saying the region it opens is not showing.
    expect(shell(false)).toContain('aria-expanded="false"');
    expect(occurrences(shell(false), 'data-slot="chat-close"')).toBe(1);
    // Open: the root fades an inert, hidden pill while the same single X owns close.
    expect(occurrences(shell(true), 'data-slot="chat-pill"')).toBe(1);
    expect(shell(true)).toContain('aria-hidden="true"');
    expect(occurrences(shell(true), 'data-slot="chat-close"')).toBe(1);
  });

  /* The old surface is gone from the shell entirely: no second webview to open
   * and no command left that would open one. */
  test("no window-opening command survives on the chat path", () => {
    expect("agentPanelOpen" in commands).toBe(false);
    expect("agentPanelClose" in commands).toBe(false);
  });
});

describe("the sheet's Ask turn", () => {
  test("packs only a paired Ask turn with remote intelligence consent", async () => {
    const original = {
      pack: commands.sonaQueryPack,
      send: commands.agentPanelSendTurn,
    };
    const packedQuestions: string[] = [];
    const sent: Array<{ workspace: string; contextPack: string | null }> = [];
    commands.sonaQueryPack = async (question) => {
      packedQuestions.push(question);
      return {
        status: "ok",
        data: {
          schema_version: 1,
          pack: "meeting quotes",
          sources: [
            {
              kind: "meeting",
              id: "m1",
              title: "Decisions",
              snippet: "We chose the launch date.",
              when_utc_ms: 1,
              link: "sona://meeting/m1",
            },
          ],
        },
      };
    };
    commands.agentPanelSendTurn = async (request) => {
      sent.push({
        workspace: request.workspace,
        contextPack: request.context_pack,
      });
      return {
        status: "ok",
        data: {
          invalidation_id: 1,
          relay_status: "ready",
          conversation_id: "c1",
          conversation: [],
          turn: null,
          proposal: null,
        },
      };
    };
    const cases = [
      {
        workspace: "sona_chat",
        gate: { paired: true, remoteIntelligence: true },
      },
      {
        workspace: "sona_chat",
        gate: { paired: true, remoteIntelligence: false },
      },
      {
        workspace: "sona_chat",
        gate: { paired: false, remoteIntelligence: true },
      },
      {
        workspace: "sona_config",
        gate: { paired: true, remoteIntelligence: true },
      },
    ] as const;
    const searchedCorpus: boolean[] = [];
    try {
      for (const [index, turn] of cases.entries()) {
        const outcome = await sendSheetTurn({
          message: `question ${index}`,
          locale: "en",
          workspace: turn.workspace,
          gate: turn.gate,
          toolsAllowed: false,
        });
        searchedCorpus.push(outcome.searchedCorpus);
      }
    } finally {
      commands.sonaQueryPack = original.pack;
      commands.agentPanelSendTurn = original.send;
    }

    expect(packedQuestions).toEqual(["question 0"]);
    expect(sent).toEqual([
      { workspace: "sona_chat", contextPack: "meeting quotes" },
      { workspace: "sona_chat", contextPack: null },
      { workspace: "sona_chat", contextPack: null },
      { workspace: "sona_config", contextPack: null },
    ]);
    expect(searchedCorpus).toEqual([true, false, false, false]);
  });

  test("retrying a failed question creates a fresh turn", async () => {
    const original = commands.agentPanelSendTurn;
    const turnIds: string[] = [];
    commands.agentPanelSendTurn = async (request) => {
      turnIds.push(request.turn_id);
      return {
        status: "ok",
        data: {
          invalidation_id: 1,
          relay_status: "ready",
          conversation_id: "c1",
          conversation: [],
          turn: null,
          proposal: null,
        },
      };
    };
    try {
      await sendSheetTurn({
        message: "What did we decide?",
        locale: "en",
        workspace: "sona_chat",
        gate: { paired: false, remoteIntelligence: false },
        toolsAllowed: false,
      });
      await sendSheetTurn({
        message: "What did we decide?",
        locale: "en",
        workspace: "sona_chat",
        gate: { paired: false, remoteIntelligence: false },
        toolsAllowed: false,
      });
    } finally {
      commands.agentPanelSendTurn = original;
    }

    expect(turnIds).toHaveLength(2);
    expect(turnIds[0]).not.toBe(turnIds[1]);
  });

  /* The grant is the reader's, for one question. It rides on the turn that
   * asked for it, and the settings proposer — a zero-tool sandbox on the relay
   * — never carries one however the composer was left. */
  test("the tools grant rides one Ask turn and never a settings turn", async () => {
    const original = commands.agentPanelSendTurn;
    const granted: boolean[] = [];
    commands.agentPanelSendTurn = async (request) => {
      granted.push(request.tools_allowed);
      return {
        status: "ok",
        data: {
          invalidation_id: 1,
          relay_status: "ready",
          conversation_id: "c1",
          conversation: [],
          turn: null,
          proposal: null,
        },
      };
    };
    try {
      for (const [workspace, toolsAllowed] of [
        ["sona_chat", true],
        ["sona_chat", false],
        ["sona_config", true],
      ] as const) {
        await sendSheetTurn({
          message: "What did we decide?",
          locale: "en",
          workspace,
          gate: { paired: false, remoteIntelligence: false },
          toolsAllowed,
        });
      }
    } finally {
      commands.agentPanelSendTurn = original;
    }

    expect(granted).toEqual([true, false, false]);
  });
});

describe("the palette's Ask row", () => {
  /* It builds the pack and sends the turn; the sheet is opened by the shell.
   * A second window is never asked for, which is the whole cutover. */
  test("asks the backend for a pack and a turn, and opens nothing", async () => {
    const original = {
      pack: commands.sonaQueryPack,
      send: commands.agentPanelSendTurn,
    };
    const calls: string[] = [];
    commands.sonaQueryPack = async () => {
      calls.push("pack");
      return {
        status: "ok",
        data: {
          schema_version: 1,
          question: "pricing",
          pack: "quotes",
          sources: [],
          truncated: false,
        },
      };
    };
    commands.agentPanelSendTurn = async (request) => {
      calls.push(`send:${request.workspace}:${request.context_pack ?? ""}`);
      return {
        status: "ok",
        data: {
          invalidation_id: 1,
          relay_status: "ready",
          conversation_id: "c1",
          conversation: [],
          turn: null,
          proposal: null,
        },
      };
    };
    try {
      expect(
        await askSona("pricing", "en", {
          enabled: true,
          paired: true,
          remoteIntelligence: true,
        }),
      ).toBe("sent");
    } finally {
      commands.sonaQueryPack = original.pack;
      commands.agentPanelSendTurn = original.send;
    }

    expect(calls).toEqual(["pack", "send:sona_chat:quotes"]);
  });
});
