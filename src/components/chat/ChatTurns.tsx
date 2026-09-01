import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import type {
  AgentPanelProposalPreviewV1,
  AgentPanelTurnStatusV1,
  SonaAgentChatTurnV1,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import { cn } from "@/lib/cn";
import {
  conversationRows,
  isStillWaiting,
  isTurnRunning,
  linkifySona,
  proposalRowIndex,
  stepMs,
  turnFailure,
  workedMs,
  workRowIndex,
} from "./chatModel";

interface AssistantTextProps {
  message: string;
  onOpenLink: (link: string) => void;
}

/* An answer is prose on the surface, not a card and not a bubble: it is the
 * thing the sheet exists to show, and putting a container around it would make
 * it look like an aside to something else. Only the addresses inside it are
 * chrome, because only they are pressable. */
const AssistantText: React.FC<AssistantTextProps> = ({
  message,
  onOpenLink,
}) => (
  <p className="text-[13px] leading-[19px] whitespace-pre-wrap text-gray-1000 [overflow-wrap:anywhere]">
    {linkifySona(message).map((segment, index) =>
      "link" in segment ? (
        <button
          // SAFETY: segments come from one immutable message string, so
          // position is a stable identity here.
          key={`${index}:${segment.link}`}
          type="button"
          onClick={() => onOpenLink(segment.link)}
          className="underline decoration-gray-alpha-600 underline-offset-2 hover:decoration-gray-1000"
        >
          {segment.link}
        </button>
      ) : (
        <React.Fragment key={`${index}:text`}>{segment.text}</React.Fragment>
      ),
    )}
  </p>
);

interface TurnWorkProps {
  turn: AgentPanelTurnStatusV1;
  now: number;
  searchedCorpus: boolean;
  busy: boolean;
  onStop: () => void;
  onRetry: () => void;
}

const WORK_LINE =
  "inline-flex items-center gap-1 text-[12px] leading-4 text-gray-900";

/**
 * The activity that belongs below a turn's question.
 *
 * A live turn always gets a timing line. A completed turn gets it only when
 * the relay reported steps, leaving a plain answer as prose. Failure and the
 * corpus marker share this row because neither has an assistant answer of its
 * own to introduce them.
 */
const TurnWork: React.FC<TurnWorkProps> = ({
  turn,
  now,
  searchedCorpus,
  busy,
  onStop,
  onRetry,
}) => {
  const { t } = useTranslation();
  const running = isTurnRunning(turn);
  const failure = turnFailure(turn);
  const showTiming = running || turn.steps.length > 0;
  const label = running
    ? `${t(`chat.turnState.${turn.state}`)} · ${t("chat.stepSeconds", {
        seconds: Math.round(workedMs(turn, now) / 1000),
      })}`
    : t("chat.workedFor", {
        seconds: Math.round(workedMs(turn, now) / 1000),
      });

  return (
    <div data-slot="chat-work" className="flex flex-col items-start gap-1">
      {showTiming &&
        (turn.steps.length === 0 ? (
          <p role="status" className={WORK_LINE}>
            {label}
          </p>
        ) : (
          <details className="group">
            <summary
              className={cn(
                WORK_LINE,
                "cursor-default list-none outline-none marker:content-none hover:text-gray-1000 focus-visible:text-gray-1000 [&::-webkit-details-marker]:hidden",
              )}
            >
              <ChevronRight
                aria-hidden="true"
                className="size-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
              />
              {label}
            </summary>
            <ol className="mt-1.5 flex list-none flex-col gap-1 border-s border-gray-alpha-400 py-0.5 ps-3">
              {turn.steps.map((step) => (
                <li
                  key={step.id}
                  className="flex items-baseline gap-2 text-[12px] leading-4"
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      step.state === "failed"
                        ? "text-red-900"
                        : "text-gray-900",
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="flex-none tabular-nums text-gray-800">
                    {t("chat.stepSeconds", {
                      seconds: Math.round(stepMs(step, turn, now) / 1000),
                    })}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        ))}
      {searchedCorpus && (
        <p
          data-slot="chat-searched-corpus"
          className="text-[11px] leading-4 text-gray-800"
        >
          {t("chat.working.searchedCorpus")}
        </p>
      )}
      {isStillWaiting(turn, now) && (
        <p
          data-slot="chat-still-waiting"
          role="status"
          className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-4 text-gray-900"
        >
          {t("chat.working.stillWaiting")}
          <Button variant="link" size="xs" onClick={onStop} disabled={busy}>
            {t("chat.working.cancel")}
          </Button>
        </p>
      )}
      {failure !== null && (
        <p
          data-slot="chat-turn-error"
          role="status"
          className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-4 text-red-900"
        >
          {t(`chat.error.${failure}`)}
          <Button variant="link" size="xs" onClick={onRetry} disabled={busy}>
            {t("chat.retry")}
          </Button>
        </p>
      )}
    </div>
  );
};

interface ProposalCardProps {
  proposal: AgentPanelProposalPreviewV1;
  busy: boolean;
  onApply: () => void;
  onUndo: () => void;
}

/**
 * A settings answer, as the one thing you can do about it.
 *
 * The card IS the assistant's turn — the backend puts the proposal's summary
 * into the conversation and stores the proposal beside it, so drawing both
 * would print one sentence twice. Applying moves this same card to Applied
 * with an Undo, rather than adding a second card that reports on the first.
 */
const ProposalCard: React.FC<ProposalCardProps> = ({
  proposal,
  busy,
  onApply,
  onUndo,
}) => {
  const { t } = useTranslation();

  return (
    <div
      data-slot="chat-proposal"
      className="flex items-center gap-3 rounded-panel border border-gray-alpha-400 bg-background-100 p-3"
    >
      <span
        aria-hidden="true"
        className="grid size-8 flex-none place-items-center rounded-lg bg-gray-alpha-200 text-gray-1000"
      >
        <SlidersHorizontal className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Wraps rather than truncates. This sentence is the whole of what the
            assistant said — the backend puts the summary in the conversation
            and the card takes that row, so there is no second copy of it to
            read — and a press on Apply under half a sentence is a press on
            something nobody was shown. The column is 340pt wide; prose from a
            relay breaks anywhere, like every other relay sentence here. */}
        <span className="text-[13px] leading-[18px] text-gray-1000 [overflow-wrap:anywhere]">
          {proposal.summary}
        </span>
        {/* Action keys stay verbatim: they are identifiers, and naming the set
            is what makes one Apply honest about what it moves. */}
        <span className="truncate text-[11px] leading-4 text-gray-900">
          {proposal.actions.map((action) => action.key).join(", ")}
        </span>
      </span>
      {proposal.state === "pending" && (
        <Button
          variant="outline"
          size="sm"
          className="flex-none"
          onClick={onApply}
          disabled={busy}
        >
          {t("chat.proposal.apply")}
        </Button>
      )}
      {proposal.state === "applied" && (
        <span className="flex flex-none items-center gap-1.5">
          <span className="text-[12px] leading-4 text-gray-900">
            {t("chat.proposal.applied")}
          </span>
          <Button variant="ghost" size="sm" onClick={onUndo} disabled={busy}>
            {t("chat.proposal.undo")}
          </Button>
        </span>
      )}
      {(proposal.state === "undone" || proposal.state === "rejected") && (
        <span className="flex-none text-[12px] leading-4 text-gray-900">
          {t(`chat.proposal.${proposal.state}`)}
        </span>
      )}
    </div>
  );
};

export interface ChatTurnsProps {
  conversation: readonly SonaAgentChatTurnV1[];
  turn: AgentPanelTurnStatusV1 | null;
  proposal: AgentPanelProposalPreviewV1 | null;
  /** Wall clock, ticked by the owner so the elapsed numbers are testable. */
  now: number;
  /** This turn's optional evidence pack had at least one quoted source. */
  searchedCorpus: boolean;
  busy: boolean;
  onStop: () => void;
  onRetry: () => void;
  onApply: () => void;
  onUndo: () => void;
  onOpenLink: (link: string) => void;
}

/**
 * The scrollback: what was said, what the turn did on the way, and the one
 * card a settings answer becomes.
 */
export const ChatTurns: React.FC<ChatTurnsProps> = ({
  conversation,
  turn,
  proposal,
  now,
  searchedCorpus,
  busy,
  onStop,
  onRetry,
  onApply,
  onUndo,
  onOpenLink,
}) => {
  const rows = conversationRows(conversation);
  const workIndex = workRowIndex(conversation, turn, searchedCorpus);
  const cardIndex = proposalRowIndex(conversation, proposal);
  const work = turn !== null && workIndex >= 0 && (
    <TurnWork
      turn={turn}
      now={now}
      searchedCorpus={searchedCorpus}
      busy={busy}
      onStop={onStop}
      onRetry={onRetry}
    />
  );

  return (
    <ul className="flex list-none flex-col gap-4 p-0">
      {rows.map(({ key, turn: row }, index) => (
        <React.Fragment key={key}>
          {index === workIndex && <li>{work}</li>}
          <li
            className={
              row.role === "user"
                ? "max-w-[85%] self-end rounded-[14px] bg-gray-alpha-200 px-3 py-2 text-[13px] leading-[19px] whitespace-pre-wrap text-gray-1000 [overflow-wrap:anywhere]"
                : ""
            }
          >
            {row.role === "user" ? (
              row.message
            ) : index === cardIndex && proposal !== null ? (
              <ProposalCard
                proposal={proposal}
                busy={busy}
                onApply={onApply}
                onUndo={onUndo}
              />
            ) : (
              <AssistantText message={row.message} onOpenLink={onOpenLink} />
            )}
          </li>
        </React.Fragment>
      ))}
      {/* A turn still working has no answer to sit above, so its work goes
          last — and a proposal with no row of its own is drawn rather than
          dropped. */}
      {workIndex === rows.length && <li>{work}</li>}
      {cardIndex === -1 && proposal !== null && (
        <li>
          <ProposalCard
            proposal={proposal}
            busy={busy}
            onApply={onApply}
            onUndo={onUndo}
          />
        </li>
      )}
      {proposal?.rationale !== undefined && proposal.rationale !== "" && (
        <li>
          <AssistantText message={proposal.rationale} onOpenLink={onOpenLink} />
        </li>
      )}
      {proposal?.follow_up_question !== undefined &&
        proposal.follow_up_question !== null && (
          <li>
            <AssistantText
              message={proposal.follow_up_question}
              onOpenLink={onOpenLink}
            />
          </li>
        )}
    </ul>
  );
};
