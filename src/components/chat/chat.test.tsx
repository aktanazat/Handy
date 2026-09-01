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
  AgentPanelProposalPreviewV1,
  AgentPanelStatusV1,
  AgentPanelTurnStatusV1,
  SonaAgentChatTurnV1,
} from "@/bindings";
import { askSona } from "@/components/commandPaletteSearch";
import { ChatHistoryList } from "./ChatHistoryMenu";
import { ChatSheet } from "./ChatSheet";
import type { ChatPhase } from "./chatModel";
import {
  chatPhase,
  composerKeys,
  linkifySona,
  proposalRowIndex,
  sheetKeys,
  stepMs,
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
    close: string;
    history: string;
    historyEmpty: string;
    newChat: string;
    placeholder: string;
    send: string;
    stop: string;
    openSettings: string;
    workedFor: string;
    status: Record<"disabled" | "unpaired" | "offline" | "error", string>;
    turnState: Record<"running", string>;
    proposal: Record<"apply" | "applied" | "undo", string>;
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
}: SheetCase = {}): string =>
  paint(
    <ChatSheet
      open={open}
      phase={phase}
      conversationId={null}
      conversation={conversation}
      turn={turn}
      proposal={proposal}
      history={history}
      historyOpen={historyOpen}
      now={now}
      draft=""
      workspace="sona_chat"
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
      onOpenLink={noop}
      onOpenSettings={noop}
      onRetry={noop}
    />,
  );

describe("the column's shape", () => {
  /* Closed it is still mounted — the width has to animate from somewhere — so
   * the three things that must be true of it are that it takes no width, that
   * nothing can reach it, and that nothing can read it. */
  test("closed: mounted, 0 wide, inert, and out of the a11y tree", () => {
    const markup = sheet({ open: false });

    expect(markup).toContain('data-slot="chat-sheet"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("inert");
    expect(markup).toContain("pointer-events-none w-0 opacity-0");
    /* Nothing slides any more. A transform would put the column over the page
     * again, which is the layout this cutover replaced. */
    expect(markup).not.toContain("translate-x");
  });

  /* Width and opacity, at the one duration, taking its 340 out of the layout
   * rather than out of the page. A transform, a scrim or a blur here would each
   * be the surface going back to covering what it was asked about. */
  test("open: 340 of layout, on width and opacity alone", () => {
    const markup = sheet();

    expect(markup).toContain("transition-[width,opacity]");
    expect(markup).toContain("duration-150");
    expect(markup).toContain("ease-out");
    expect(markup).toContain("motion-reduce:transition-none");
    expect(markup).toContain("w-[340px]");
    expect(markup).not.toContain("translate-x");
    // One hairline against the page, and no dimming of what is behind it.
    expect(markup).toContain("border-s border-gray-alpha-400");
    expect(markup).not.toContain("bg-black/");
    expect(markup).not.toContain("backdrop-blur");
  });

  /* Two boxes: the one that animates and clips, and the frame that holds its
   * 340 through the travel so no answer rewraps while the page's edge moves.
   * The hairline is the frame's, which is what keeps the column a border-box
   * 340 of window rather than 341. */
  test("open: a clipping box around a frame that does not move", () => {
    const markup = sheet();
    const outer = /<aside[^>]*class="([^"]*)"/.exec(markup)?.[1] ?? "";

    expect(outer).toContain("overflow-hidden");
    expect(outer).toContain("flex-none");
    expect(outer).toContain("w-[340px]");
    expect(outer).not.toContain("border-s");
    // Stated on both boxes, and nowhere else.
    expect(occurrences(markup, "w-[340px]")).toBe(2);
  });

  test("the header is one X and two round hairlines", () => {
    const markup = sheet();

    expect(occurrences(markup, 'data-slot="chat-close"')).toBe(1);
    expect(occurrences(markup, 'data-slot="chat-history"')).toBe(1);
    expect(occurrences(markup, 'data-slot="chat-new"')).toBe(1);
    expect(markup).toContain(`aria-label="${en.chat.close}"`);
    expect(markup).toContain(`aria-label="${en.chat.history}"`);
    expect(markup).toContain(`aria-label="${en.chat.newChat}"`);
    // No title: the pill that opened it already said the word.
    expect(markup).not.toContain("<h1");
    expect(markup).not.toContain("<h2");
  });

  test("empty: one invitation, a scope row and a composer", () => {
    const markup = sheet();

    expect(markup).toContain(en.chat.empty);
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
    // Open: no pill at all, and the same single X.
    expect(shell(true)).not.toContain('data-slot="chat-pill"');
    expect(occurrences(shell(true), 'data-slot="chat-close"')).toBe(1);
  });

  /* The old surface is gone from the shell entirely: no second webview to open
   * and no command left that would open one. */
  test("no window-opening command survives on the chat path", () => {
    expect("agentPanelOpen" in commands).toBe(false);
    expect("agentPanelClose" in commands).toBe(false);
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
