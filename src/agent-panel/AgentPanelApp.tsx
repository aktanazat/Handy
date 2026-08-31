import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  events,
  type AgentPanelStatusV1,
  type AgentPanelWorkspaceV1,
  type SonaAgentChatTurnV1,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";

import { AgentPanelView, type PanelPhase } from "./AgentPanelView";

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

/**
 * Every relay event the panel cares about, funnelled into one invalidation. The
 * backend is the source of truth for status, turn, proposal and geometry, so the
 * panel re-reads rather than patching a local copy per event.
 */
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

export const AgentPanelApp: React.FC = () => {
  const { i18n } = useTranslation();
  const { settings } = useSettings();
  const [phase, setPhase] = useState<PanelPhase>("loading");
  const [status, setStatus] = useState<AgentPanelStatusV1 | null>(null);
  const [draft, setDraft] = useState("");
  const [workspace, setWorkspace] =
    useState<AgentPanelWorkspaceV1>("sona_chat");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastIdentity, setLastIdentity] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
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

  /* The elapsed timer is the only thing on screen that changes without an
   * event behind it, so it is the only thing that gets a clock — and only
   * while a turn is actually running. */
  const turn = status?.turn ?? null;
  const turnActive = turn !== null && hasActiveTurn(turn);
  useEffect(() => {
    if (!turnActive) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [turnActive, turn?.turn_id]);

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
        workspace,
        /* Packs are assembled by whoever has the evidence. The panel asks the
         * question; it does not go looking through the corpus first. */
        context_pack: null,
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
    const active = status?.turn;
    if (!active || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await commands.agentPanelCancelTurn({
        turn_id: active.turn_id,
      });
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

  return (
    <AgentPanelView
      phase={phase}
      lastIdentity={lastIdentity}
      conversation={conversation}
      turn={turn}
      now={now}
      proposal={status?.proposal ?? null}
      error={error}
      draft={draft}
      workspace={workspace}
      sending={sending}
      onToggle={() => void togglePanel()}
      onRefresh={() => void refresh()}
      onCancel={() => void cancel()}
      onApply={() => void apply(false)}
      onUndo={() => void undo()}
      onSend={() => void send()}
      onDraftChange={setDraft}
      onWorkspaceChange={setWorkspace}
      /* The panel is its own webview, so a cited address cannot be navigated
       * here: the backend routes it and the main window answers, exactly as it
       * would for the same URL arriving from outside the app. */
      onOpenLink={(link) => void commands.sonaOpenLink(link)}
    />
  );
};
