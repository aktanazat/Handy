import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, X } from "lucide-react";
import type {
  AgentChatConversationSummaryV1,
  AgentPanelProposalPreviewV1,
  AgentPanelTurnStatusV1,
  AgentPanelWorkspaceV1,
  SonaAgentChatTurnV1,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import { cn } from "@/lib/cn";
import { ChatComposer } from "./ChatComposer";
import { ChatHistoryMenu } from "./ChatHistoryMenu";
import { ChatTurns } from "./ChatTurns";
import { CHAT_NOTICE_PHASES, isTurnRunning, sheetKeys } from "./chatModel";
import type { ChatPhase } from "./chatModel";

/* The column's width, and the one number the shell's arithmetic depends on.
 * The main window is a fixed 900pt and never resizes, so with the rail
 * collapsed to its 48pt glyph strip the page keeps 512pt beside the chat:
 * enough that the meeting you are asking about stays readable and stays
 * usable, which is the whole reason this is a column of the window rather
 * than a strip over the page. Border-box, so the hairline is inside the 340
 * rather than a 341st pixel taken off the page.
 *
 * Stated twice below on purpose, and only here: the outer box is what
 * animates, the inner frame is what the content is laid out in. */
const CHAT_WIDTH = "w-[340px]";

/* Width and opacity, nothing else. A column that is part of the layout has to
 * move the page's edge with it — that is what being ingrained costs, and it is
 * the one thing a slide-over never had to pay. It stays cheap because the
 * chat itself is not re-laid-out while the edge travels: the frame inside
 * holds its 340 and the outer box clips it.
 *
 * 150ms because that is long enough to read as the page making room and short
 * enough that a second press is never queued behind it. Under
 * prefers-reduced-motion App.css zeroes every transition globally, so
 * `motion-reduce:transition-none` here is belt and braces on the one element
 * that would look worst mid-travel. */
const CHAT_MOTION =
  "transition-[width,opacity] duration-150 ease-out motion-reduce:transition-none";

interface ChatSheetHeaderProps {
  history: readonly AgentChatConversationSummaryV1[];
  currentId: string | null;
  historyOpen: boolean;
  busy: boolean;
  /** Where focus lands when the column opens with nothing typeable in it. */
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onHistoryOpenChange: (open: boolean) => void;
  onSelectConversation: (conversationId: string) => void;
  onNewChat: () => void;
}

/* Three round hairlines and nothing else. No title: the sheet is the answer to
 * a press on a pill that says Chat, and repeating the word at the top of it
 * would be the first of the duplications this surface keeps being rebuilt to
 * remove. The window's accessible name carries it instead. */
const ROUND_BUTTON =
  "grid size-7 place-items-center rounded-full border border-gray-alpha-400 text-gray-900 transition-colors hover:bg-gray-alpha-100 hover:text-gray-1000 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none";

const ChatSheetHeader: React.FC<ChatSheetHeaderProps> = ({
  history,
  currentId,
  historyOpen,
  busy,
  closeRef,
  onClose,
  onHistoryOpenChange,
  onSelectConversation,
  onNewChat,
}) => {
  const { t } = useTranslation();

  return (
    <header className="flex flex-none items-center justify-between gap-2 px-3 py-2.5">
      <button
        type="button"
        ref={closeRef}
        data-slot="chat-close"
        onClick={onClose}
        aria-label={t("chat.close")}
        title={t("chat.close")}
        className={ROUND_BUTTON}
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
      <div className="flex items-center gap-1.5">
        <ChatHistoryMenu
          conversations={history}
          currentId={currentId}
          open={historyOpen}
          onOpenChange={onHistoryOpenChange}
          onSelect={onSelectConversation}
        />
        <button
          type="button"
          data-slot="chat-new"
          onClick={onNewChat}
          disabled={busy}
          aria-label={t("chat.newChat")}
          title={t("chat.newChat")}
          className={ROUND_BUTTON}
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </div>
    </header>
  );
};

interface ChatNoticeProps {
  phase: ChatPhase;
  onOpenSettings: () => void;
  onRetry: () => void;
}

/**
 * One line for the four phases where nothing would answer.
 *
 * It sits above the composer rather than replacing the conversation, because
 * a relay that went away does not unsay what was already said — and the reader
 * who scrolls back to an answer while the network is down is doing the one
 * thing this surface can still do for them.
 */
const ChatNotice: React.FC<ChatNoticeProps> = ({
  phase,
  onOpenSettings,
  onRetry,
}) => {
  const { t } = useTranslation();

  if (!(phase in CHAT_NOTICE_PHASES)) return null;

  return (
    <p
      data-slot="chat-notice"
      role="status"
      className="flex flex-none flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-gray-alpha-400 px-3 py-2 text-[12px] leading-4 text-gray-900"
    >
      {t(`chat.status.${phase}`)}
      {phase === "unpaired" && (
        <Button variant="link" size="xs" onClick={onOpenSettings}>
          {t("chat.openSettings")}
        </Button>
      )}
      {(phase === "offline" || phase === "error") && (
        <Button variant="link" size="xs" onClick={onRetry}>
          {t("chat.retry")}
        </Button>
      )}
    </p>
  );
};

export interface ChatSheetProps {
  open: boolean;
  phase: ChatPhase;
  conversationId: string | null;
  conversation: readonly SonaAgentChatTurnV1[];
  turn: AgentPanelTurnStatusV1 | null;
  proposal: AgentPanelProposalPreviewV1 | null;
  history: readonly AgentChatConversationSummaryV1[];
  historyOpen: boolean;
  /** Wall clock, ticked by the owner so the elapsed numbers are testable. */
  now: number;
  draft: string;
  workspace: AgentPanelWorkspaceV1;
  /** A send, stop, apply, undo or history read is mid-flight. */
  busy: boolean;
  /** A refused command, as distinct from the relay's own state. */
  error: string | null;
  onClose: () => void;
  onHistoryOpenChange: (open: boolean) => void;
  onSelectConversation: (conversationId: string) => void;
  onNewChat: () => void;
  onDraftChange: (draft: string) => void;
  onWorkspaceChange: (workspace: AgentPanelWorkspaceV1) => void;
  onSend: () => void;
  onStop: () => void;
  onApply: () => void;
  onUndo: () => void;
  onOpenLink: (link: string) => void;
  onOpenSettings: () => void;
  onRetry: () => void;
}

/**
 * The chat, as a column of the main window rather than a window of its own.
 *
 * It is mounted whether or not it is open, and when it opens it takes its
 * 340pt out of the layout rather than out of the page: the rail collapses to
 * glyphs, the page column narrows to 512, and what you were reading stays
 * beside the answer — lit, scrollable, clickable, separated by one hairline.
 * Nothing is covered and there is no scrim, because a chat that hides the
 * thing you are asking about is a chat you have to close in order to use.
 *
 * Two boxes, one job each. The outer box is the width: it animates between 0
 * and 340 and clips what is inside it. The inner frame is the chat: it holds
 * its 340 through the whole travel, so no line of an answer rewraps while the
 * page's edge is moving.
 *
 * A pure function of its props apart from one effect — where focus goes when
 * the column opens, which the pill cannot own because the pill has unmounted
 * by then. `ChatSheetHost` owns the IPC and the clock.
 */
export const ChatSheet: React.FC<ChatSheetProps> = ({
  open,
  phase,
  conversationId,
  conversation,
  turn,
  proposal,
  history,
  historyOpen,
  now,
  draft,
  workspace,
  busy,
  error,
  onClose,
  onHistoryOpenChange,
  onSelectConversation,
  onNewChat,
  onDraftChange,
  onWorkspaceChange,
  onSend,
  onStop,
  onApply,
  onUndo,
  onOpenLink,
  onOpenSettings,
  onRetry,
}) => {
  const { t } = useTranslation();
  const running = isTurnRunning(turn);
  const columnRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  /** Whether this opening has already put the caret in the field. */
  const caretPlaced = useRef(false);
  /* Offline still takes a draft — the relay is the thing that is away, not the
   * column — and a proposal on screen does not stop a question. Loading is the
   * one beat where the field cannot take a keystroke, because the status it
   * would be sent under has not come back yet. */
  const composerDisabled = busy || phase === "loading" || phase === "disabled";

  /* Where focus goes when the column opens.
   *
   * It has to go somewhere: the press that opened it came from a pill that has
   * just taken itself off screen, and focus left on a removed node falls back
   * to the body — where Escape reaches nothing, because Escape is bound on
   * this element rather than on the window.
   *
   * The field is what the column is for, so the caret belongs in it. On the
   * first paint after a press it cannot take the caret — that is the loading
   * beat above — so the close button holds focus for it and the field takes
   * over the moment it wakes. Once placed, this stops moving anything; and it
   * moves nothing that a reader has since focused themselves, which is the
   * only other thing that can hold focus during that beat. */
  useEffect(() => {
    if (!open) {
      caretPlaced.current = false;
      return;
    }
    if (caretPlaced.current) return;
    const holder = document.activeElement;
    if (
      holder !== null &&
      holder !== document.body &&
      columnRef.current?.contains(holder) !== true
    )
      return;
    const field = fieldRef.current;
    if (field === null || field.disabled) {
      closeRef.current?.focus();
      return;
    }
    field.focus();
    caretPlaced.current = true;
  }, [open, composerDisabled]);

  return (
    <aside
      ref={columnRef}
      data-slot="chat-sheet"
      aria-label={t("chat.title")}
      /* Closed it is out of the tab order and out of the accessibility tree:
         a column nobody can see must not be one a Tab key can walk into. */
      aria-hidden={open ? undefined : true}
      inert={!open}
      onKeyDown={sheetKeys(onClose)}
      className={cn(
        "flex min-h-0 flex-none overflow-hidden",
        CHAT_MOTION,
        open
          ? cn(CHAT_WIDTH, "opacity-100")
          : "pointer-events-none w-0 opacity-0",
      )}
    >
      {/* The frame that does not move, carrying the hairline that separates
          the column from the page. The line lives here rather than on the box
          above so that a border-box 340 is 340 of window and the frame inside
          it is exactly as wide as the box it is clipped by. */}
      <div
        className={cn(
          "flex min-h-0 flex-none flex-col border-s border-gray-alpha-400 bg-background-100",
          CHAT_WIDTH,
        )}
      >
        <ChatSheetHeader
          history={history}
          currentId={conversationId}
          historyOpen={historyOpen}
          busy={busy || running}
          closeRef={closeRef}
          onClose={onClose}
          onHistoryOpenChange={onHistoryOpenChange}
          onSelectConversation={onSelectConversation}
          onNewChat={onNewChat}
        />
        <div
          data-slot="chat-scroll"
          className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-4"
        >
          {phase === "loading" ? (
            <div className="flex h-full items-center justify-center">
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin text-gray-800 motion-reduce:animate-none"
              />
            </div>
          ) : conversation.length === 0 && proposal === null ? (
            <div
              data-slot="chat-empty"
              className="flex h-full items-center justify-center"
            >
              <p className="max-w-[32ch] text-center text-[13px] leading-5 text-gray-800">
                {t("chat.empty")}
              </p>
            </div>
          ) : (
            <ChatTurns
              conversation={conversation}
              turn={turn}
              proposal={proposal}
              now={now}
              busy={busy}
              onApply={onApply}
              onUndo={onUndo}
              onOpenLink={onOpenLink}
            />
          )}
        </div>
        <ChatNotice
          phase={phase}
          onOpenSettings={onOpenSettings}
          onRetry={onRetry}
        />
        {error !== null && (
          <p
            role="alert"
            className="flex-none border-t border-gray-alpha-400 px-3 py-2 text-[12px] leading-4 text-red-900 [overflow-wrap:anywhere]"
          >
            {error}
          </p>
        )}
        <ChatComposer
          workspace={workspace}
          draft={draft}
          fieldRef={fieldRef}
          running={running}
          disabled={composerDisabled}
          onWorkspaceChange={onWorkspaceChange}
          onDraftChange={onDraftChange}
          onSend={onSend}
          onStop={onStop}
        />
      </div>
    </aside>
  );
};
