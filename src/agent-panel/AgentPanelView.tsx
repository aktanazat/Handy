import React from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Send, X } from "lucide-react";
import type {
  AgentPanelProposalPreviewV1,
  SonaAgentChatTurnV1,
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
 * The status dot's tone. Three tones is the entire vocabulary — the panel is
 * working, the panel needs you, the connection is broken — because the dot sits
 * beside the word that says which, and a fourth colour would be decoration.
 */
const dotTone = (phase: PanelPhase): string => {
  if (phase === "error" || phase === "offline") return "bg-red-700";
  if (phase === "running" || phase === "proposal") return "bg-blue-700";
  return "bg-gray-700";
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
   * nothing to mean. When the body carries the sentence, this slot is empty. */
  const showsPhase = !isHeadlinePhase(phase);

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
            className="max-w-[140px] truncate font-mono text-[11px] text-gray-800"
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
        <p className="max-w-[40ch] font-mono text-[11px] text-gray-800 [overflow-wrap:anywhere]">
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

interface AgentPanelBodyProps {
  conversation: readonly SonaAgentChatTurnV1[];
  hasTurn: boolean;
  proposal: AgentPanelProposalPreviewV1 | null;
  error: string | null;
  draft: string;
  sending: boolean;
  canSend: boolean;
  onCancel: () => void;
  onApply: () => void;
  onUndo: () => void;
  onSend: () => void;
  onDraftChange: (draft: string) => void;
}

const AgentPanelBody: React.FC<AgentPanelBodyProps> = ({
  conversation,
  hasTurn,
  proposal,
  error,
  draft,
  sending,
  canSend,
  onCancel,
  onApply,
  onUndo,
  onSend,
  onDraftChange,
}) => {
  const { t } = useTranslation();
  const rows = conversationRows(conversation);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
            {rows.map(({ key, turn }) => (
              <li
                key={key}
                className={cn(
                  "max-w-[88%] rounded-md px-3 py-2 text-[13px] leading-[19px] text-gray-1000 [overflow-wrap:anywhere]",
                  turn.role === "user"
                    ? "self-end bg-gray-100"
                    : "border border-gray-alpha-400 bg-background-100",
                )}
              >
                {turn.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The header already says "Working…", so this row is only the two things
          it can add: that work is still moving, and the way to stop it. */}
      {hasTurn && (
        <div className="flex flex-none items-center gap-2 border-t border-gray-alpha-400 px-4 py-2.5">
          <Loader2
            aria-hidden="true"
            className="size-4 animate-spin text-gray-900"
          />
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
          {/* The section label role: short, mono, uppercase, tracked. It is also
              the section's accessible name, which is why the old duplicate
              `proposalLabel` aria-label is gone. */}
          <h2
            id="agent-panel-proposal-title"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-gray-800"
          >
            {t("agentPanel.proposalTitle")}
          </h2>
          <p className="mt-2 text-[13px] leading-[19px] text-gray-1000">
            {proposal.summary}
          </p>
          <p className="mt-2 text-[13px] leading-[19px] text-gray-900">
            {proposal.rationale}
          </p>
          {/* The action keys, verbatim: they are identifiers, so they are mono
              and they are not uppercased. */}
          <p className="mt-2 font-mono text-[11px] text-gray-800 [overflow-wrap:anywhere]">
            {actionSummary(proposal)}
          </p>
          {proposal.follow_up_question && (
            <p className="mt-2 text-[13px] leading-[19px] text-gray-900">
              {proposal.follow_up_question}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={onApply} disabled={sending}>
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

      <form
        className="flex flex-none items-center gap-2 border-t border-gray-alpha-400 px-4 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <Input
          type="text"
          className="h-8 min-w-0 flex-1 text-[13px]"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={t("agentPanel.inputPlaceholder")}
          aria-label={t("agentPanel.inputLabel")}
          disabled={!canSend}
        />
        <Button
          type="submit"
          size="icon-sm"
          disabled={!canSend || draft.trim() === ""}
          aria-label={t("agentPanel.send")}
        >
          <Send aria-hidden="true" className="size-4" />
        </Button>
      </form>
    </div>
  );
};

export interface AgentPanelViewProps {
  phase: PanelPhase;
  lastIdentity: string | null;
  conversation: readonly SonaAgentChatTurnV1[];
  hasTurn: boolean;
  proposal: AgentPanelProposalPreviewV1 | null;
  /** A failed send, cancel, apply or undo. Distinct from the `error` phase,
   * which is the relay itself being unreachable. */
  error: string | null;
  draft: string;
  sending: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onCancel: () => void;
  onApply: () => void;
  onUndo: () => void;
  onSend: () => void;
  onDraftChange: (draft: string) => void;
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
  hasTurn,
  proposal,
  error,
  draft,
  sending,
  onToggle,
  onRefresh,
  onCancel,
  onApply,
  onUndo,
  onSend,
  onDraftChange,
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
        hasTurn={hasTurn}
        proposal={proposal}
        error={error}
        draft={draft}
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
      />
    )}
  </div>
);
