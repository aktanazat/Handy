import React from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Send, X } from "lucide-react";
import type {
  AgentPanelProposalPreviewV1,
  AgentPanelTurnStatusV1,
  AgentPanelWorkspaceV1,
  SonaAgentChatTurnV1,
  SonaAgentStepV1,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import { cn } from "@/lib/cn";

/**
 * What the panel is showing, which is not the same thing as what the relay is
 * doing: several relay states collapse onto one screen, and one relay state
 * (`ready`) fans out into three depending on whether a turn or a proposal is
 * live. `AgentPanelApp` derives it; this module is the only thing that renders
 * it.
 */
export type PanelPhase =
  | "loading"
  | "disabled"
  | "unpaired"
  | "offline"
  | "idle"
  | "running"
  | "proposal"
  | "error";

/**
 * The phases whose sentence IS the panel's content, because there is nothing
 * else on screen: no conversation, no composer, nothing to act on.
 *
 * The phase sentence renders in exactly one place, and this table picks which.
 * With a conversation up, the phase is chrome and belongs in the header; with an
 * empty panel, it belongs in the middle of it. The panel used to print both at
 * once — a header reading "Relay offline." over a body reading "Relay offline."
 * — and that is the repetition this rebuild exists to remove.
 */
const HEADLINE_PHASES = {
  loading: true,
  disabled: true,
  unpaired: true,
  error: true,
} satisfies Partial<Record<PanelPhase, true>>;

const isHeadlinePhase = (phase: PanelPhase): boolean =>
  phase in HEADLINE_PHASES;

/**
 * The phases that have a conversation, a composer, and therefore a body. The
 * complement of this is not `HEADLINE_PHASES`: `offline` has both a body (the
 * history is still readable, the draft is still queueable) and a sentence, which
 * is exactly why the sentence has to pick a side.
 */
const BODY_PHASES = {
  idle: true,
  running: true,
  proposal: true,
  offline: true,
} satisfies Partial<Record<PanelPhase, true>>;

/**
 * The turn states that are over. A live turn can be stopped and its timer is
 * still counting; a finished one is a record, and offering to cancel it is an
 * offer to undo the past.
 *
 * One table, read in two places — the rail's mark and the cancel row's
 * existence — because those two must never disagree about whether the turn is
 * still happening.
 */
const TERMINAL_TURN_STATES = {
  succeeded: true,
  failed: true,
  canceled: true,
  unverified_external: true,
} satisfies Partial<Record<AgentPanelTurnStatusV1["state"], true>>;

/**
 * The status dot's tone.
 *
 * Three tones, and none of them is a brand colour: the panel wears the same
 * gray ladder as every other Sona surface, and the only hues it may reach for
 * are the two that mean something — red for broken, amber for waiting on you.
 * A blue "working" dot was decoration; the activity rail already says what the
 * turn is doing, and says it with a number beside it.
 */
const dotTone = (phase: PanelPhase): string => {
  if (phase === "error" || phase === "offline") return "bg-red-900";
  if (phase === "proposal") return "bg-amber-900";
  return "bg-gray-800";
};

const actionSummary = (proposal: AgentPanelProposalPreviewV1): string =>
  proposal.actions.map((action) => action.key).join(", ");

/**
 * Stable keys for a conversation that can legitimately repeat itself: the same
 * role saying the same words twice is one exchange, not one row rendered twice,
 * so the occurrence count is part of the identity.
 */
const conversationRows = (
  conversation: readonly SonaAgentChatTurnV1[],
): Array<{ key: string; turn: SonaAgentChatTurnV1 }> => {
  const occurrences = new Map<string, number>();
  return conversation.map((turn) => {
    const identity = JSON.stringify([turn.role, turn.message]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return {
      key: JSON.stringify([turn.role, turn.message, occurrence]),
      turn,
    };
  });
};

/* An answer worth reading cites where it came from, and the pack it was given
 * is nothing but quotes with `sona://` addresses beside them (`query/pack.rs`),
 * so an assistant that answers from evidence writes those addresses into its
 * reply. Left as text they are unclickable noise; split out here they are the
 * one gesture that turns an answer back into the meeting it came from.
 *
 * The address stops at the first character that cannot be inside one. Trailing
 * sentence punctuation is trimmed after the fact rather than excluded from the
 * class, because a `?` can legitimately open a query string while a `.` at the
 * end of a sentence never belongs to the link. */
const SONA_LINK = /sona:\/\/[^\s<>"'`)\]]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

export type MessageSegment = { text: string } | { link: string };

/** One message as alternating prose and addresses, in the order it was written. */
export const linkifySona = (message: string): MessageSegment[] => {
  const segments: MessageSegment[] = [];
  let cursor = 0;
  for (const match of message.matchAll(SONA_LINK)) {
    const link = match[0].replace(TRAILING_PUNCTUATION, "");
    if (link === "sona://") continue;
    const start = match.index;
    if (start > cursor) segments.push({ text: message.slice(cursor, start) });
    segments.push({ link });
    cursor = start + link.length;
  }
  if (cursor < message.length) segments.push({ text: message.slice(cursor) });
  return segments;
};

/** `m:ss`, counted from the turn's own start so a reload cannot restart it. */
const elapsedLabel = (milliseconds: number): string => {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const STEP_MARK = {
  running: "○",
  done: "●",
  failed: "×",
} satisfies Record<SonaAgentStepV1["state"], string>;

interface ActivityTreeProps {
  turn: AgentPanelTurnStatusV1;
  now: number;
}

/**
 * The left rail: what this turn has done so far, oldest first.
 *
 * Two rows are always true of a turn that exists — it was submitted, and it is
 * either still running or it is not — so those are drawn from the turn's own
 * state rather than waited for. Everything below them is whatever the response
 * envelope reported in `steps`, which is nothing at all until a workspace grows
 * tools. An empty `steps` is the normal case, not a loading state, so the rail
 * does not apologise for it.
 */
const ActivityTree: React.FC<ActivityTreeProps> = ({ turn, now }) => {
  const { t } = useTranslation();
  const live = !(turn.state in TERMINAL_TURN_STATES);

  return (
    <aside
      className="flex w-[148px] flex-none flex-col gap-1.5 overflow-y-auto border-r border-gray-alpha-400 px-3 py-3"
      aria-label={t("agentPanel.activityLabel")}
    >
      <ol className="flex list-none flex-col gap-1.5 p-0 text-[11px] leading-4 text-gray-900">
        <li className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="text-gray-700">
            {STEP_MARK.done}
          </span>
          <span className="min-w-0 truncate">{t("agentPanel.step.sent")}</span>
        </li>
        <li className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="text-gray-700">
            {live ? STEP_MARK.running : STEP_MARK.done}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {t(`agentPanel.turnState.${turn.state}`)}
          </span>
          {/* The one number on this rail, so it is tabular: a ticking second
              must not shuffle the label to its left. */}
          <span className="flex-none tabular-nums text-gray-800">
            {elapsedLabel(now - turn.started_at_utc_ms)}
          </span>
        </li>
        {turn.steps.map((step) => (
          <li key={step.id} className="flex items-baseline gap-1.5">
            <span
              aria-hidden="true"
              className={
                step.state === "failed" ? "text-red-900" : "text-gray-700"
              }
            >
              {STEP_MARK[step.state]}
            </span>
            <span className="min-w-0 truncate">{step.label}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
};

interface AgentPanelHeaderProps {
  phase: PanelPhase;
  lastIdentity: string | null;
  onToggle: () => void;
  onRefresh: () => void;
}

const AgentPanelHeader: React.FC<AgentPanelHeaderProps> = ({
  phase,
  lastIdentity,
  onToggle,
  onRefresh,
}) => {
  const { t } = useTranslation();
  /* Dot and word travel together: a lone dot beside no word is a colour with
   * nothing to mean. When the body carries the sentence, this slot is empty —
   * and a running turn is exactly that case now, because the activity rail
   * names the state and counts the seconds. A header reading "Working…" over
   * a rail reading "Thinking 0:12" is the same fact twice. */
  const showsPhase = !isHeadlinePhase(phase) && phase !== "running";

  return (
    <header className="flex min-h-[44px] flex-none items-center justify-between gap-2 border-b border-gray-alpha-400 px-3">
      {showsPhase ? (
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn("size-1.5 flex-none rounded-full", dotTone(phase))}
            aria-hidden="true"
          />
          <span className="truncate text-[13px] text-gray-1000" role="status">
            {t(`agentPanel.status.${phase}`)}
          </span>
          {/* Retry sits with the sentence it acts on, so the connection's state
              and the way to re-test it are never in two different regions. */}
          {phase === "offline" && (
            <Button variant="outline" size="sm" onClick={onRefresh}>
              {t("agentPanel.retry")}
            </Button>
          )}
        </div>
      ) : (
        <span />
      )}
      <div className="flex flex-none items-center gap-2">
        {lastIdentity && (
          <span
            className="max-w-[140px] truncate text-[11px] text-gray-800"
            title={lastIdentity}
          >
            {lastIdentity}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          title={t("agentPanel.panelToggle")}
          aria-label={t("agentPanel.panelToggle")}
          disabled={phase === "disabled" || phase === "loading"}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </header>
  );
};

interface AgentPanelStateProps {
  phase: PanelPhase;
  error: string | null;
  onRefresh: () => void;
}

/**
 * The empty panel. One centred sentence — the phase, said once, in the only
 * region on screen — plus whatever that phase adds to it: a spinner while the
 * relay is still answering, the raw cause and a retry when it failed.
 */
const AgentPanelState: React.FC<AgentPanelStateProps> = ({
  phase,
  error,
  onRefresh,
}) => {
  const { t } = useTranslation();

  if (!isHeadlinePhase(phase)) return null;

  const failed = phase === "error";

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
      role={failed ? "alert" : "status"}
    >
      {phase === "loading" && (
        <Loader2
          aria-hidden="true"
          className="size-4 animate-spin text-gray-900"
        />
      )}
      <p className="text-[13px] text-gray-900">
        {t(`agentPanel.status.${phase}`)}
      </p>
      {failed && error && (
        <p className="max-w-[40ch] text-[11px] text-gray-800 [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
      {failed && (
        <Button variant="outline" size="sm" onClick={onRefresh}>
          {t("agentPanel.retry")}
        </Button>
      )}
    </div>
  );
};

const WORKSPACES = ["sona_chat", "sona_config"] as const;

interface ComposerProps {
  workspace: AgentPanelWorkspaceV1;
  draft: string;
  canSend: boolean;
  onWorkspaceChange: (workspace: AgentPanelWorkspaceV1) => void;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
}

/**
 * One pill: what you are asking, and who you are asking.
 *
 * The two workspaces are not two moods of one brain — one answers questions
 * from your own corpus, the other proposes settings changes and can change
 * nothing without a card and a click. Which one a question goes to is the
 * user's to say, because a client-side guess that misroutes sends a private
 * question to the wrong sandbox, and there is no honest heuristic for the
 * difference between "what did I say about the theme" and "change the theme".
 */
const Composer: React.FC<ComposerProps> = ({
  workspace,
  draft,
  canSend,
  onWorkspaceChange,
  onDraftChange,
  onSend,
}) => {
  const { t } = useTranslation();

  return (
    <form
      className="flex flex-none items-center gap-2 border-t border-gray-alpha-400 px-3 py-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div
        className="flex flex-none items-center gap-1 rounded-full border border-gray-alpha-400 bg-background-100 p-0.5"
        role="radiogroup"
        aria-label={t("agentPanel.workspaceLabel")}
      >
        {WORKSPACES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={workspace === option}
            disabled={!canSend}
            onClick={() => onWorkspaceChange(option)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-50",
              workspace === option
                ? "bg-gray-alpha-200 text-gray-1000"
                : "text-gray-800 hover:text-gray-1000",
            )}
          >
            {t(`agentPanel.workspace.${option}`)}
          </button>
        ))}
      </div>
      <Input
        type="text"
        className="h-8 min-w-0 flex-1 rounded-full text-[13px]"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder={t(`agentPanel.placeholder.${workspace}`)}
        aria-label={t("agentPanel.inputLabel")}
        disabled={!canSend}
      />
      <Button
        type="submit"
        size="icon-sm"
        className="rounded-full"
        disabled={!canSend || draft.trim() === ""}
        aria-label={t("agentPanel.send")}
      >
        <Send aria-hidden="true" className="size-4" />
      </Button>
    </form>
  );
};

interface AgentPanelBodyProps {
  conversation: readonly SonaAgentChatTurnV1[];
  turn: AgentPanelTurnStatusV1 | null;
  now: number;
  proposal: AgentPanelProposalPreviewV1 | null;
  error: string | null;
  draft: string;
  workspace: AgentPanelWorkspaceV1;
  sending: boolean;
  canSend: boolean;
  onCancel: () => void;
  onApply: () => void;
  onUndo: () => void;
  onSend: () => void;
  onDraftChange: (draft: string) => void;
  onWorkspaceChange: (workspace: AgentPanelWorkspaceV1) => void;
  onOpenLink: (link: string) => void;
}

const AgentPanelBody: React.FC<AgentPanelBodyProps> = ({
  conversation,
  turn,
  now,
  proposal,
  error,
  draft,
  workspace,
  sending,
  canSend,
  onCancel,
  onApply,
  onUndo,
  onSend,
  onDraftChange,
  onWorkspaceChange,
  onOpenLink,
}) => {
  const { t } = useTranslation();
  const rows = conversationRows(conversation);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* The rail is the turn's structure and the scrollback is its content,
            so they scroll independently: reading back through an answer must
            not drag the step list off screen. */}
        {turn && <ActivityTree turn={turn} now={now} />}
        <section
          className="min-h-0 flex-1 overflow-y-auto p-4"
          aria-label={t("agentPanel.conversationLabel")}
        >
          {rows.length === 0 ? (
            <p className="my-6 text-center text-[13px] text-gray-800">
              {t("agentPanel.empty")}
            </p>
          ) : (
            <ul className="flex list-none flex-col gap-3 p-0">
              {rows.map(({ key, turn: row }) => (
                <li
                  key={key}
                  className={cn(
                    "max-w-[88%] rounded-md px-3 py-2 text-[13px] leading-[19px] text-gray-1000 [overflow-wrap:anywhere] whitespace-pre-wrap",
                    row.role === "user"
                      ? "self-end bg-gray-100"
                      : "border border-gray-alpha-400 bg-background-100",
                  )}
                >
                  {row.role === "assistant"
                    ? linkifySona(row.message).map((segment, index) =>
                        "link" in segment ? (
                          <button
                            // SAFETY: segments come from one immutable message
                            // string, so position is a stable identity here.
                            key={`${index}:${segment.link}`}
                            type="button"
                            onClick={() => onOpenLink(segment.link)}
                            className="underline decoration-gray-alpha-600 underline-offset-2 hover:decoration-gray-1000"
                          >
                            {segment.link}
                          </button>
                        ) : (
                          <React.Fragment key={`${index}:text`}>
                            {segment.text}
                          </React.Fragment>
                        ),
                      )
                    : row.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* The rail already says which step is running and for how long, so this
          row is only the thing the rail cannot be: a way to stop it — and only
          while there is something left to stop. A finished turn keeps its rail,
          because that is the record of what happened, but offering to cancel
          it would be offering to undo the past. */}
      {turn && !(turn.state in TERMINAL_TURN_STATES) && (
        <div className="flex flex-none items-center justify-end border-t border-gray-alpha-400 px-4 py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={sending}
          >
            {t("agentPanel.cancel")}
          </Button>
        </div>
      )}

      {proposal && (
        <section
          className="flex-none border-t border-gray-alpha-400 bg-background-100 p-4"
          aria-labelledby="agent-panel-proposal-title"
        >
          {/* This sentence-case section label is also the section's accessible
              name, which is why the old duplicate aria-label stays gone. */}
          <h2
            id="agent-panel-proposal-title"
            className="text-[13px] leading-5 text-gray-900"
          >
            {t("agentPanel.proposalTitle")}
          </h2>
          <p className="mt-2 text-[13px] leading-[19px] text-gray-1000">
            {proposal.summary}
          </p>
          <p className="mt-2 text-[13px] leading-[19px] text-gray-900">
            {proposal.rationale}
          </p>
          {/* Action keys stay verbatim because they are identifiers. */}
          <p className="mt-2 text-[11px] text-gray-800 [overflow-wrap:anywhere]">
            {actionSummary(proposal)}
          </p>
          {proposal.follow_up_question && (
            <p className="mt-2 text-[13px] leading-[19px] text-gray-900">
              {proposal.follow_up_question}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onApply}
              disabled={sending}
            >
              {t("agentPanel.apply")}
            </Button>
            {proposal.receipt_id && (
              <Button
                variant="outline"
                size="sm"
                onClick={onUndo}
                disabled={sending}
              >
                {t("agentPanel.undo")}
              </Button>
            )}
          </div>
        </section>
      )}

      {error && (
        <p
          className="flex-none px-4 py-2 text-[12.5px] text-red-900 [overflow-wrap:anywhere]"
          role="alert"
        >
          {error}
        </p>
      )}

      <Composer
        workspace={workspace}
        draft={draft}
        canSend={canSend}
        onWorkspaceChange={onWorkspaceChange}
        onDraftChange={onDraftChange}
        onSend={onSend}
      />
    </div>
  );
};

export interface AgentPanelViewProps {
  phase: PanelPhase;
  lastIdentity: string | null;
  conversation: readonly SonaAgentChatTurnV1[];
  /** The live turn, whose state and steps are the activity rail. */
  turn: AgentPanelTurnStatusV1 | null;
  /** Wall clock, ticked by the owner so the elapsed timer is testable. */
  now: number;
  proposal: AgentPanelProposalPreviewV1 | null;
  /** A failed send, cancel, apply or undo. Distinct from the `error` phase,
   * which is the relay itself being unreachable. */
  error: string | null;
  draft: string;
  workspace: AgentPanelWorkspaceV1;
  sending: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onCancel: () => void;
  onApply: () => void;
  onUndo: () => void;
  onSend: () => void;
  onDraftChange: (draft: string) => void;
  onWorkspaceChange: (workspace: AgentPanelWorkspaceV1) => void;
  /** Opening one `sona://` address an answer cited. */
  onOpenLink: (link: string) => void;
}

/**
 * The whole panel, as a function of state.
 *
 * Split out of `AgentPanelApp` for the same reason `RecordingOverlayContent` is
 * split out of `RecordingOverlay`: the surface is a pure function of the phase,
 * and the one rule that is easy to break — that a datum appears once per screen
 * — is only checkable if every phase can be rendered without a relay behind it.
 * `AgentPanelApp` owns the IPC and the state machine; this owns every pixel.
 */
export const AgentPanelView: React.FC<AgentPanelViewProps> = ({
  phase,
  lastIdentity,
  conversation,
  turn,
  now,
  proposal,
  error,
  draft,
  workspace,
  sending,
  onToggle,
  onRefresh,
  onCancel,
  onApply,
  onUndo,
  onSend,
  onDraftChange,
  onWorkspaceChange,
  onOpenLink,
}) => (
  <div className="flex size-full flex-col bg-background-200 text-gray-1000">
    <AgentPanelHeader
      phase={phase}
      lastIdentity={lastIdentity}
      onToggle={onToggle}
      onRefresh={onRefresh}
    />
    <AgentPanelState phase={phase} error={error} onRefresh={onRefresh} />
    {phase in BODY_PHASES && (
      <AgentPanelBody
        conversation={conversation}
        turn={turn}
        now={now}
        proposal={proposal}
        error={error}
        draft={draft}
        workspace={workspace}
        sending={sending}
        /* Offline still takes a draft — the relay is the thing that is away,
         * not the panel — and a proposal on screen does not stop a question. */
        canSend={
          (phase === "idle" || phase === "offline" || phase === "proposal") &&
          !sending
        }
        onCancel={onCancel}
        onApply={onApply}
        onUndo={onUndo}
        onSend={onSend}
        onDraftChange={onDraftChange}
        onWorkspaceChange={onWorkspaceChange}
        onOpenLink={onOpenLink}
      />
    )}
  </div>
);
