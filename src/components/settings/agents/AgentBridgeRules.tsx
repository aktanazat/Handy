import React from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Button } from "@/components/vg/button";
import { Notice, SettingsCard } from "@/components/settings/rows";
import type { AgentBridgeSettingsModel } from "./useAgentBridgeSettings";

interface AgentBridgeRulesProps {
  bridge: AgentBridgeSettingsModel["bridge"];
  mutateBridge: AgentBridgeSettingsModel["mutateBridge"];
}

export const AgentBridgeRules: React.FC<AgentBridgeRulesProps> = ({
  bridge,
  mutateBridge,
}) => {
  const { t } = useTranslation();

  return (
    /* The tab strip already says "Exact permission rules", and each row is
     * the exact scope the paragraph used to spell out. */
    <SettingsCard className="divide-y divide-gray-alpha-400">
      {bridge.permission_rules.length === 0 ? (
        <div className="px-4 py-2.5">
          <Notice>{t("settings.agents.rules.empty")}</Notice>
        </div>
      ) : (
        bridge.permission_rules.map((rule) => (
          <div
            key={rule.id}
            className="flex min-w-0 flex-wrap items-start justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-5 break-words text-gray-1000">
                {rule.tool_name}
                {" · "}
                {t("settings.agents.rules.decisions." + rule.decision)}
              </p>
              <code className="mt-1 block text-xs break-all text-gray-800 tabular-nums">
                {rule.canonical_project_hash}
              </code>
            </div>
            {rule.agent === "claude" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-red-900"
                title={t("settings.agents.rules.remove")}
                aria-label={t("settings.agents.rules.remove")}
                onClick={() =>
                  void mutateBridge(() =>
                    commands.deleteAgentBridgePermissionRule(rule.id),
                  )
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))
      )}
    </SettingsCard>
  );
};
