import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import { Notice, SettingsSection } from "@/components/settings/rows";
import { LiveState } from "./LiveState";
import type { AgentBridgeSettingsModel } from "./useAgentBridgeSettings";

interface AgentBridgePendingRepliesProps {
  pendingMessages: AgentBridgeSettingsModel["pendingMessages"];
  confirmPending: AgentBridgeSettingsModel["confirmPending"];
  cancelPending: AgentBridgeSettingsModel["cancelPending"];
}

export const AgentBridgePendingReplies: React.FC<
  AgentBridgePendingRepliesProps
> = ({ pendingMessages, confirmPending, cancelPending }) => {
  const { t } = useTranslation();

  return (
    <SettingsSection
      label={t("settings.agents.pending.title", "Pending replies")}
    >
      {pendingMessages.length === 0 ? (
        <div className="px-4 py-2.5">
          <Notice>{t("settings.agents.pending.empty")}</Notice>
        </div>
      ) : (
        pendingMessages.map((pending) => (
          <div
            key={pending.id}
            className="flex min-w-0 flex-wrap items-start justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px] text-gray-900">
                <span>
                  {t(
                    "settings.agents.controls.providers." +
                      pending.agent +
                      ".label",
                  )}
                </span>
                <code className="min-w-0 break-all">{pending.session_id}</code>
              </p>
              <p className="mt-1 text-[13px] leading-5 break-words whitespace-pre-wrap text-gray-1000">
                {pending.text}
              </p>
              <p className="mt-1">
                {/* The state, not an instruction: "review the destination
                 * before confirming" was the Confirm button said twice. */}
                <LiveState
                  className={pending.confirmed ? "text-gray-1000" : undefined}
                >
                  {pending.state === "held"
                    ? pending.confirmed
                      ? t("settings.agents.pending.confirmed")
                      : t("settings.agents.pending.states.held")
                    : t("settings.agents.pending.states." + pending.state)}
                </LiveState>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {!pending.confirmed && pending.state === "held" ? (
                <Button size="sm" onClick={() => void confirmPending(pending)}>
                  {t("settings.agents.pending.confirm")}
                </Button>
              ) : null}
              {pending.state === "held" || pending.state === "copy_only" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void cancelPending(pending.id)}
                >
                  {t("settings.agents.pending.cancel")}
                </Button>
              ) : null}
            </div>
          </div>
        ))
      )}
    </SettingsSection>
  );
};
