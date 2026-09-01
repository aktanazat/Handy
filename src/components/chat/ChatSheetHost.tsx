import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  events,
  type AgentChatConversationSummaryV1,
  type AgentPanelCommandErrorV1,
  type AgentPanelStatusV1,
  type AgentPanelWorkspaceV1,
  type Result,
  type SonaAgentChatTurnV1,
} from "@/bindings";
import { ChatSheet } from "./ChatSheet";
import {
  chatPhase,
  isTurnRunning,
  retryMessage,
  shouldPackChatTurn,
} from "./chatModel";
import type { ChatPackGate } from "./chatModel";

const EMPTY_CONVERSATION: readonly SonaAgentChatTurnV1[] = [];
const EMPTY_HISTORY: readonly AgentChatConversationSummaryV1[] = [];

/**
 * Open the chat sheet from anywhere below the shell.
 *
 * A context rather than a prop chain because the callers are scattered and
 * shallow-hostile — a review's follow-up button is six components down and has
 * nothing else to say to the shell. The default is a no-op so a component
 * rendered outside the shell (a test, a story) still sends its turn; opening
 * the sheet is a courtesy the shell provides, not a precondition for asking.
 */
const ChatOpenerContext = React.createContext<() => void>(() => undefined);

export const ChatOpenerProvider = ChatOpenerContext.Provider;

export const useChatOpener = (): (() => void) =>
  React.useContext(ChatOpenerContext);

/**
 * Every relay event the sheet cares about, funnelled into one invalidation.
 * The backend is the source of truth for status, turn and proposal, so the
 * sheet re-reads rather than patching a local copy per event.
 */
const subscribeToChatEvents = async (
  onInvalidate: () => void,
): Promise<() => void> => {
  const listeners = await Promise.all([
    events.agentPanelStatusChanged.listen(onInvalidate),
    events.agentPanelTurnChanged.listen(onInvalidate),
    events.agentPanelProposalChanged.listen(onInvalidate),
  ]);
  return () => {
    listeners.forEach((listener) => void listener());
  };
};

export interface SheetTurnRequest {
  message: string;
  locale: string;
  workspace: AgentPanelWorkspaceV1;
  gate: ChatPackGate;
}

export interface SheetTurnResult {
  result: Result<AgentPanelStatusV1, AgentPanelCommandErrorV1>;
  searchedCorpus: boolean;
}

/** Assemble evidence only for an explicitly consented Ask turn. */
export const sendSheetTurn = async ({
  message,
  locale,
  workspace,
  gate,
}: SheetTurnRequest): Promise<SheetTurnResult> => {
  let contextPack: string | null = null;
  let searchedCorpus = false;
  if (shouldPackChatTurn(workspace, gate)) {
    const pack = await commands.sonaQueryPack(message);
    if (pack.status === "ok") {
      contextPack = pack.data.pack;
      searchedCorpus = pack.data.sources.length > 0;
    }
  }
  return {
    result: await commands.agentPanelSendTurn({
      turn_id: crypto.randomUUID(),
      message,
      locale,
      workspace,
      context_pack: contextPack,
    }),
    searchedCorpus,
  };
};

export interface ChatSheetHostProps {
  open: boolean;
  panel: ChatPackGate;
  onClose: () => void;
  onOpenSettings: () => void;
}

/**
 * The sheet's IPC and its clock.
 *
 * Both are gated on `open`: a closed sheet subscribes to nothing and reads
 * nothing, which is the whole point of the sheet replacing a second webview
 * that had to be kept in geometric lockstep with this one whether anyone was
 * looking at it or not. A turn started before the sheet was closed keeps
 * running on the backend and is waiting in the scrollback when it reopens.
 */
export const ChatSheetHost: React.FC<ChatSheetHostProps> = ({
  open,
  panel,
  onClose,
  onOpenSettings,
}) => {
  const { i18n } = useTranslation();
  const [status, setStatus] = useState<AgentPanelStatusV1 | null>(null);
  const [history, setHistory] =
    useState<readonly AgentChatConversationSummaryV1[]>(EMPTY_HISTORY);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [workspace, setWorkspace] =
    useState<AgentPanelWorkspaceV1>("sona_chat");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [searchedCorpus, setSearchedCorpus] = useState(false);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const result = await commands.agentPanelStatus();
    if (requestRef.current !== requestId) return;
    if (result.status === "error") {
      setError(result.error);
      return;
    }
    setError(null);
    setStatus(result.data);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let stopListening = () => {};
    void subscribeToChatEvents(() => {
      if (!disposed) void refresh();
    }).then((stop) => {
      if (disposed) stop();
      else stopListening = stop;
    });
    return () => {
      disposed = true;
      stopListening();
    };
  }, [open, refresh]);

  /* The elapsed numbers are the only thing on screen that change without an
   * event behind them, so they are the only thing that gets a clock — and only
   * while a turn is actually running. */
  const turn = status?.turn ?? null;
  const conversation = status?.conversation ?? EMPTY_CONVERSATION;
  const running = isTurnRunning(turn);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [running, turn?.turn_id]);

  /* One shape for every command the sheet issues: mark busy, take the status
   * the backend answered with, and put a refusal on screen instead of a
   * silently unchanged sheet. */
  const run = useCallback(
    async (
      command: () => Promise<
        | { status: "ok"; data: AgentPanelStatusV1 }
        | { status: "error"; error: string }
      >,
    ): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const result = await command();
        if (result.status === "error") {
          setError(result.error);
          return false;
        }
        setStatus(result.data);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const sendTurn = async (message: string): Promise<boolean> => {
    let turnSearchedCorpus = false;
    const sent = await run(async () => {
      const outcome = await sendSheetTurn({
        message,
        locale: i18n.language,
        workspace,
        gate: panel,
      });
      turnSearchedCorpus = outcome.searchedCorpus;
      return outcome.result;
    });
    setSearchedCorpus(turnSearchedCorpus);
    return sent;
  };

  const send = async () => {
    const message = draft.trim();
    if (message === "" || busy) return;
    if (await sendTurn(message)) setDraft("");
  };

  const openHistory = async (next: boolean) => {
    setHistoryOpen(next);
    if (!next) return;
    const result = await commands.agentChatHistoryList();
    if (result.status === "error") {
      setError(result.error);
      return;
    }
    setHistory(result.data);
  };

  const selectConversation = async (conversationId: string) => {
    setHistoryOpen(false);
    if (await run(() => commands.agentChatOpen(conversationId))) {
      setSearchedCorpus(false);
    }
  };

  const newConversation = async () => {
    if (await run(commands.agentChatNew)) setSearchedCorpus(false);
  };

  const retryTurn = async () => {
    const message = retryMessage(conversation, turn);
    if (message === null || busy) return;
    await sendTurn(message);
  };

  const proposal = status?.proposal ?? null;

  return (
    <ChatSheet
      open={open}
      phase={chatPhase(status)}
      conversationId={status?.conversation_id ?? null}
      conversation={conversation}
      turn={turn}
      searchedCorpus={searchedCorpus}
      proposal={proposal}
      history={history}
      historyOpen={historyOpen}
      now={now}
      draft={draft}
      workspace={workspace}
      busy={busy}
      error={error}
      onClose={onClose}
      onHistoryOpenChange={(next) => void openHistory(next)}
      onSelectConversation={(id) => void selectConversation(id)}
      onNewChat={() => void newConversation()}
      onDraftChange={setDraft}
      onWorkspaceChange={setWorkspace}
      onSend={() => void send()}
      onStop={() => {
        if (turn === null) return;
        void run(() =>
          commands.agentPanelCancelTurn({ turn_id: turn.turn_id }),
        );
      }}
      onApply={() => {
        if (proposal === null) return;
        void run(() =>
          commands.agentPanelApplyChange({
            proposal_id: proposal.proposal_id,
            expected_revision: proposal.source_settings_revision,
            /* The card is the confirmation. A reader who presses Apply under a
             * subtitle naming the settings it moves has confirmed it; the
             * classes exist so nothing applies itself, not so the same person
             * is asked twice. */
            confirmed: true,
          }),
        );
      }}
      onUndo={() => {
        const receiptId = proposal?.receipt_id ?? null;
        if (proposal === null || receiptId === null) return;
        void run(() =>
          commands.agentPanelUndoChange({
            receipt_id: receiptId,
            expected_revision:
              proposal.applied_revision ?? proposal.source_settings_revision,
          }),
        );
      }}
      /* Routed through the backend, which owns what a `sona://` address means
       * and which surface it wakes — the same path an address arriving from
       * outside the app takes. */
      onOpenLink={(link) => void commands.sonaOpenLink(link)}
      onOpenSettings={onOpenSettings}
      onRetry={() => void refresh()}
      onRetryTurn={() => void retryTurn()}
    />
  );
};
