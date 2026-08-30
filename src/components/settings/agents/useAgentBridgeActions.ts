import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  commands,
  type AgentBridgeObservedRequest,
  type AgentBridgePendingMessage,
  type AgentBridgePermissionDecision,
} from "@/bindings";
import type { AgentBridgeViewState, BridgeMutation } from "./agentBridgeView";

interface AgentBridgeActionDeps {
  view: AgentBridgeViewState;
  updateView: (patch: Partial<AgentBridgeViewState>) => void;
  refreshObservations: () => Promise<void>;
  refreshSettings: () => Promise<void>;
}

/* The write side of the agent bridge. A command reports refusal in its result
 * and the transport can still throw, so every action funnels both into the one
 * error field and then re-reads the observations its write moved. */
export const useAgentBridgeActions = ({
  view,
  updateView,
  refreshObservations,
  refreshSettings,
}: AgentBridgeActionDeps) => {
  const { t } = useTranslation();
  const { hookSnippet, replySessionId, replyText } = view;

  const mutateBridge = useCallback(
    async (operation: () => Promise<BridgeMutation>) => {
      updateView({ error: null });
      try {
        const result = await operation();
        if (result.status !== "ok") {
          updateView({
            error: t("settings.agents.errors.operation", {
              error: String(result.error),
            }),
          });
          return;
        }
        updateView({ bridge: result.data });
        void refreshSettings();
        await refreshObservations();
      } catch (mutationError) {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(mutationError),
          }),
        });
      }
    },
    [refreshObservations, refreshSettings, t],
  );

  const authorizeProject = async () => {
    updateView({ authorizing: true });
    try {
      const selectedPath = await open({ directory: true, multiple: false });
      if (selectedPath !== null && !Array.isArray(selectedPath)) {
        await mutateBridge(() =>
          commands.authorizeAgentBridgeProject(selectedPath),
        );
      }
    } catch (authorizationError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(authorizationError),
        }),
      });
    } finally {
      updateView({ authorizing: false });
    }
  };

  const createReplyPreview = async () => {
    if (!replySessionId || replyText.trim() === "") return;
    updateView({ error: null });
    try {
      const result = await commands.createAgentBridgeReplyPreview(
        replySessionId,
        replyText,
      );
      if (result.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(result.error),
          }),
        });
        return;
      }
      updateView({ replyText: "" });
      await refreshObservations();
    } catch (previewError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(previewError),
        }),
      });
    }
  };

  const confirmPending = async (pending: AgentBridgePendingMessage) => {
    updateView({ error: null });
    try {
      const result = await commands.confirmAgentBridgeReply(
        pending.id,
        pending.session_id,
        pending.text,
      );
      if (result.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(result.error),
          }),
        });
        return;
      }
      await refreshObservations();
    } catch (confirmError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(confirmError),
        }),
      });
    }
  };

  const cancelPending = async (pendingId: string) => {
    updateView({ error: null });
    try {
      const result = await commands.cancelAgentBridgeMessage(pendingId);
      if (result.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(result.error),
          }),
        });
        return;
      }
      await refreshObservations();
    } catch (cancelError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(cancelError),
        }),
      });
    }
  };

  const dismissRequest = async (requestId: string) => {
    updateView({ error: null });
    try {
      const result = await commands.dismissAgentBridgeRequest(requestId);
      if (result.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(result.error),
          }),
        });
        return;
      }
      await refreshObservations();
    } catch (dismissError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(dismissError),
        }),
      });
    }
  };

  const decidePermission = async (
    request: AgentBridgeObservedRequest,
    decision: AgentBridgePermissionDecision,
  ) => {
    updateView({ error: null });
    try {
      const ruleResult = await commands.createAgentBridgePermissionRule(
        request.id,
        decision,
      );
      if (ruleResult.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(ruleResult.error),
          }),
        });
        return;
      }
      const responseResult = await commands.respondAgentBridgePermission(
        request.id,
        ruleResult.data.id,
        decision,
      );
      if (responseResult.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(responseResult.error),
          }),
        });
      }
      void refreshSettings();
      await refreshObservations();
    } catch (permissionError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(permissionError),
        }),
      });
    }
  };

  const copyHookSnippet = async () => {
    if (!hookSnippet) return;
    try {
      await navigator.clipboard.writeText(hookSnippet);
    } catch (copyError) {
      updateView({ hookError: String(copyError) });
    }
  };

  return {
    mutateBridge,
    authorizeProject,
    createReplyPreview,
    confirmPending,
    cancelPending,
    dismissRequest,
    decidePermission,
    copyHookSnippet,
  };
};
