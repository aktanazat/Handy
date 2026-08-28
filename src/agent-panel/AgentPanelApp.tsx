import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Send, X } from "lucide-react";
import {
  commands,
  events,
  type AgentPanelProposalPreviewV1,
  type AgentPanelStatusV1,
  type SonaAgentChatTurnV1,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";

type PanelPhase =
  | "loading"
  | "disabled"
  | "unpaired"
  | "offline"
  | "idle"
  | "running"
  | "proposal"
  | "error";

const EMPTY_CONVERSATION: readonly SonaAgentChatTurnV1[] = [];

const hasActiveTurn = (turn: AgentPanelStatusV1["turn"]): boolean =>
  turn?.state === "submitting" ||
  turn?.state === "queued" ||
  turn?.state === "leased" ||
  turn?.state === "running" ||
  turn?.state === "waiting_user" ||
  turn?.state === "waiting_approval" ||
  turn?.state === "canceling";

const relayStatusToPhase = (
  relayStatus: AgentPanelStatusV1["relay_status"],
  panel: AgentPanelStatusV1 | null,
): PanelPhase => {
  if (relayStatus === "disabled") return "disabled";
  if (relayStatus === "unpaired") return "unpaired";
  if (relayStatus === "offline") return "offline";
  if (
    panel?.turn?.state === "failed" ||
    panel?.turn?.state === "unverified_external"
  ) {
    return "error";
  }
  if (hasActiveTurn(panel?.turn ?? null)) return "running";
  if (panel?.proposal) return "proposal";
  if (relayStatus === "ready") return "idle";
  return "error";
};

const actionSummary = (proposal: AgentPanelProposalPreviewV1): string =>
  proposal.actions.map((action) => action.key).join(", ");

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

const subscribeToAgentPanelEvents = async (
  onInvalidate: () => void,
): Promise<() => void> => {
  const listeners = await Promise.all([
    events.agentPanelStatusChanged.listen(onInvalidate),
    events.agentPanelTurnChanged.listen(onInvalidate),
    events.agentPanelProposalChanged.listen(onInvalidate),
    events.agentPanelGeometryChanged.listen(onInvalidate),
  ]);
  return () => {
    listeners.forEach((listener) => void listener());
  };
};
interface AgentPanelHeaderProps {
  phase: PanelPhase;
  lastIdentity: string | null;
  onToggle: () => void;
}

const AgentPanelHeader: React.FC<AgentPanelHeaderProps> = ({
  phase,
  lastIdentity,
  onToggle,
}) => {
  const { t } = useTranslation();

  return (
    <header className="agent-panel-header">
      <div className="agent-panel-status">
        <span
          className="agent-panel-status-dot"
          data-phase={phase}
          aria-hidden="true"
        />
        <span role="status">{t(`agentPanel.status.${phase}`)}</span>
      </div>
      <div className="agent-panel-header-actions">
        {lastIdentity && (
          <span className="agent-panel-identity" title={lastIdentity}>
            {lastIdentity}
          </span>
        )}
        <button
          type="button"
          className="agent-panel-icon-button"
          onClick={onToggle}
          title={t("agentPanel.panelToggle")}
          aria-label={t("agentPanel.panelToggle")}
          disabled={phase === "disabled" || phase === "loading"}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};

interface AgentPanelStateProps {
  phase: PanelPhase;
  error: string | null;
  onRefresh: () => void;
}

const AgentPanelState: React.FC<AgentPanelStateProps> = ({
  phase,
  error,
  onRefresh,
}) => {
  const { t } = useTranslation();

  if (phase === "loading") {
    return (
      <div className="agent-panel-state" role="status">
        <Loader2 aria-hidden="true" className="agent-panel-spinner" />
        <span>{t("agentPanel.loading")}</span>
      </div>
    );
  }

  if (phase === "disabled") {
    return (
      <div className="agent-panel-state">
        <p>{t("agentPanel.status.disabled")}</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="agent-panel-state" role="alert">
        <p>{t("agentPanel.status.error")}</p>
        {error && <p className="agent-panel-error-detail">{error}</p>}
        <button
          type="button"
          className="agent-panel-text-button"
          onClick={onRefresh}
        >
          {t("agentPanel.retry")}
        </button>
      </div>
    );
  }

  if (phase === "unpaired") {
    return (
      <div className="agent-panel-state">
        <p>{t("agentPanel.status.unpaired")}</p>
      </div>
    );
  }

  if (phase === "offline") {
    return (
      <div className="agent-panel-state">
        <p>{t("agentPanel.status.offline")}</p>
        <button
          type="button"
          className="agent-panel-text-button"
          onClick={onRefresh}
        >
          {t("agentPanel.retry")}
        </button>
      </div>
    );
  }

  return null;
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
    <div className="agent-panel-body">
      <section
        className="agent-panel-conversation"
        aria-label={t("agentPanel.conversationLabel")}
      >
        {rows.length === 0 ? (
          <p className="agent-panel-empty">{t("agentPanel.empty")}</p>
        ) : (
          <ul className="agent-panel-turn-list">
            {rows.map(({ key, turn }) => (
              <li
                key={key}
                className={`agent-panel-turn agent-panel-turn-${turn.role}`}
              >
                <p>{turn.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {hasTurn && (
        <div className="agent-panel-running" role="status">
          <Loader2 aria-hidden="true" className="agent-panel-spinner" />
          <span>{t("agentPanel.status.running")}</span>
          <button
            type="button"
            className="agent-panel-text-button"
            onClick={onCancel}
            disabled={sending}
          >
            {t("agentPanel.cancel")}
          </button>
        </div>
      )}

      {proposal && (
        <section
          className="agent-panel-proposal"
          aria-label={t("agentPanel.proposalLabel")}
        >
          <h2>{t("agentPanel.proposalTitle")}</h2>
          <p className="agent-panel-proposal-summary">{proposal.summary}</p>
          <p className="agent-panel-proposal-rationale">{proposal.rationale}</p>
          <p className="agent-panel-proposal-actions">
            {actionSummary(proposal)}
          </p>
          {proposal.follow_up_question && (
            <p className="agent-panel-proposal-question">
              {proposal.follow_up_question}
            </p>
          )}
          <div className="agent-panel-proposal-actions-row">
            <button
              type="button"
              className="agent-panel-primary-button"
              onClick={onApply}
              disabled={sending}
            >
              {t("agentPanel.apply")}
            </button>
            {proposal.receipt_id && (
              <button
                type="button"
                className="agent-panel-secondary-button"
                onClick={onUndo}
                disabled={sending}
              >
                {t("agentPanel.undo")}
              </button>
            )}
          </div>
        </section>
      )}

      {error && (
        <p className="agent-panel-error" role="alert">
          {error}
        </p>
      )}

      <form
        className="agent-panel-composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={t("agentPanel.inputPlaceholder")}
          aria-label={t("agentPanel.inputLabel")}
          disabled={!canSend}
        />
        <button
          type="submit"
          className="agent-panel-send-button"
          disabled={!canSend || draft.trim() === ""}
          aria-label={t("agentPanel.send")}
        >
          <Send aria-hidden="true" className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
};

export const AgentPanelApp: React.FC = () => {
  const { i18n } = useTranslation();
  const { settings } = useSettings();
  const [phase, setPhase] = useState<PanelPhase>("loading");
  const [status, setStatus] = useState<AgentPanelStatusV1 | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastIdentity, setLastIdentity] = useState<string | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setError(null);
    try {
      const result = await commands.agentPanelStatus();
      if (requestRef.current !== requestId) return;
      if (result.status === "error") {
        setPhase("error");
        setError(result.error);
        return;
      }
      setStatus(result.data);
      setPhase(relayStatusToPhase(result.data.relay_status, result.data));
    } catch (refreshError) {
      if (requestRef.current !== requestId) return;
      setPhase("error");
      setError(String(refreshError));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let stopListening = () => {};
    const subscribe = async () => {
      try {
        const stop = await subscribeToAgentPanelEvents(() => {
          if (!disposed) void refresh();
        });
        if (disposed) {
          stop();
          return;
        }
        stopListening = stop;
      } catch (subscribeError) {
        if (!disposed) {
          console.error("Panel event subscription failed:", subscribeError);
        }
      }
    };

    void subscribe();
    return () => {
      disposed = true;
      stopListening();
    };
  }, [refresh]);

  useEffect(() => {
    if (settings && settings.agent_panel_enabled !== true) {
      setPhase("disabled");
    }
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    void commands.agentPanelPublicIdentity().then(
      (result) => {
        if (cancelled) return;
        if (result.status === "ok") {
          setLastIdentity(result.data.key_id);
          return;
        }
        setLastIdentity(null);
      },
      () => {
        if (!cancelled) setLastIdentity(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const send = async () => {
    const message = draft.trim();
    if (message === "" || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await commands.agentPanelSendTurn({
        turn_id: crypto.randomUUID(),
        message,
        locale: i18n.language,
      });
      if (result.status === "error") {
        setError(result.error);
        await refresh();
        return;
      }
      setDraft("");
      setStatus(result.data);
      setPhase(relayStatusToPhase(result.data.relay_status, result.data));
    } catch (sendError) {
      setError(String(sendError));
      await refresh();
    } finally {
      setSending(false);
    }
  };

  const cancel = async () => {
    const turn = status?.turn;
    if (!turn || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await commands.agentPanelCancelTurn({ turn_id: turn.turn_id });
      if (result.status === "error") {
        setError(result.error);
      } else {
        setStatus(result.data);
        setPhase(relayStatusToPhase(result.data.relay_status, result.data));
      }
    } catch (cancelError) {
      setError(String(cancelError));
    } finally {
      setSending(false);
    }
  };

  const apply = async (confirmed: boolean) => {
    const proposal = status?.proposal;
    if (!proposal || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await commands.agentPanelApplyChange({
        proposal_id: proposal.proposal_id,
        action_index: 0,
        expected_revision: proposal.source_settings_revision,
        confirmed,
      });
      if (result.status === "error") {
        setError(result.error);
      } else {
        setStatus(result.data);
        setPhase(relayStatusToPhase(result.data.relay_status, result.data));
      }
    } catch (applyError) {
      setError(String(applyError));
    } finally {
      setSending(false);
    }
  };

  const undo = async () => {
    const proposal = status?.proposal;
    if (!proposal?.receipt_id || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await commands.agentPanelUndoChange({
        receipt_id: proposal.receipt_id,
        expected_revision:
          proposal.applied_revision ?? proposal.source_settings_revision,
      });
      if (result.status === "error") {
        setError(result.error);
      } else {
        setStatus(result.data);
        setPhase(relayStatusToPhase(result.data.relay_status, result.data));
      }
    } catch (undoError) {
      setError(String(undoError));
    } finally {
      setSending(false);
    }
  };

  const togglePanel = async () => {
    setError(null);
    try {
      const result = status?.panel_open
        ? await commands.agentPanelClose()
        : await commands.agentPanelOpen();
      if (result.status === "error") {
        setPhase("error");
        setError(result.error);
        return;
      }
      setStatus(result.data);
      setPhase(relayStatusToPhase(result.data.relay_status, result.data));
    } catch (toggleError) {
      setPhase("error");
      setError(String(toggleError));
    }
  };

  const conversation = status?.conversation ?? EMPTY_CONVERSATION;
  const turn = status?.turn ?? null;
  const proposal = status?.proposal ?? null;
  const canSend =
    (phase === "idle" || phase === "offline" || phase === "proposal") &&
    !sending;
  const shouldShowBody =
    phase === "idle" ||
    phase === "running" ||
    phase === "proposal" ||
    phase === "offline";

  return (
    <div className="agent-panel-shell">
      <AgentPanelHeader
        phase={phase}
        lastIdentity={lastIdentity}
        onToggle={() => void togglePanel()}
      />
      <AgentPanelState
        phase={phase}
        error={error}
        onRefresh={() => void refresh()}
      />
      {shouldShowBody && (
        <AgentPanelBody
          conversation={conversation}
          hasTurn={turn !== null}
          proposal={proposal}
          error={error}
          draft={draft}
          sending={sending}
          canSend={canSend}
          onCancel={() => void cancel()}
          onApply={() => void apply(false)}
          onUndo={() => void undo()}
          onSend={() => void send()}
          onDraftChange={setDraft}
        />
      )}
    </div>
  );
};
