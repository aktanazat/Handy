import React from "react";
import { useTranslation } from "react-i18next";
import { commands, type AgentBridgeAgent } from "@/bindings";
import { Switch } from "@/components/vg/switch";
import { SettingsRow, SettingsSection } from "@/components/settings/rows";
import { LiveState } from "./LiveState";
import type { AgentBridgeSettingsModel } from "./useAgentBridgeSettings";

const AGENTS = [
  "claude",
  "codex",
  "grok",
  "omp",
] as const satisfies readonly AgentBridgeAgent[];

const isAgentEnabled = (
  bridge: AgentBridgeSettingsModel["bridge"],
  agent: AgentBridgeAgent,
) => {
  if (agent === "claude") return bridge.claude_enabled;
  if (agent === "codex") return bridge.codex_enabled;
  if (agent === "grok") return bridge.grok_enabled;
  return bridge.omp_enabled;
};

interface AgentBridgeControlsProps {
  bridge: AgentBridgeSettingsModel["bridge"];
  status: AgentBridgeSettingsModel["status"];
  mutateBridge: AgentBridgeSettingsModel["mutateBridge"];
}

export const AgentBridgeControls: React.FC<AgentBridgeControlsProps> = ({
  bridge,
  status,
  mutateBridge,
}) => {
  const { t } = useTranslation();

  return (
    <SettingsSection label={t("settings.agents.controls.title")}>
      <SettingsRow
        label={t("settings.agents.controls.master.label")}
        controlId="agent-bridge-master"
      >
        <Switch
          id="agent-bridge-master"
          checked={bridge.master_enabled}
          onCheckedChange={(enabled) =>
            void mutateBridge(() => commands.setAgentBridgeMaster(enabled))
          }
        />
      </SettingsRow>
      {/* Each agent's reply capability is the one thing the label cannot
       * carry, so it is a hint; the sentence that also repeated the label is
       * gone. */}
      {AGENTS.map((agent) => (
        <SettingsRow
          key={agent}
          label={t("settings.agents.controls.providers." + agent + ".label")}
          hint={t(
            "settings.agents.controls.providers." + agent + ".description",
          )}
          controlId={"agent-bridge-" + agent}
          disabled={!bridge.master_enabled}
        >
          <Switch
            id={"agent-bridge-" + agent}
            checked={isAgentEnabled(bridge, agent)}
            disabled={!bridge.master_enabled}
            onCheckedChange={(enabled) =>
              void mutateBridge(() =>
                commands.setAgentBridgeAgentEnabled(agent, enabled),
              )
            }
          />
        </SettingsRow>
      ))}
      {status ? (
        <SettingsRow label={t("settings.agents.controls.status")}>
          <LiveState>
            {t("settings.agents.status." + status.diagnostic)}
          </LiveState>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
};
