import React from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsDisclosure,
  SettingsSection,
} from "@/components/settings/rows";
import { AgentPanelToggle } from "../agents/AgentPanelToggle";
import { AgentBridgeWorkspace } from "../agents/AgentBridgeWorkspace";

/* The two switches that decide whether Sona talks to anything else on this
 * Mac, and the console behind them.
 *
 * The panel is the window agents speak through; the bridge is what a local
 * coding agent may ask Sona to do. Both are off-by-default policy, so they are
 * rows. Everything the bridge then shows — sessions, permission requests, the
 * reply queue, the rules — is a console you open when something is happening,
 * so it is one disclosure rather than nine sections that are empty on a Mac
 * with no agent running. */
export const AdvancedAgents: React.FC = () => {
  const { t } = useTranslation();

  return (
    <SettingsSection label={t("settingsV2.advanced.agents")}>
      <AgentPanelToggle />
      <SettingsDisclosure label={t("settingsV2.advanced.agentBridge")} lazy>
        <AgentBridgeWorkspace />
      </SettingsDisclosure>
    </SettingsSection>
  );
};
