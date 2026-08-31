import React from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsDisclosure,
  SettingsSection,
} from "@/components/settings/rows";
import { AgentPanelToggle } from "../agents/AgentPanelToggle";
import { SonaAgentPairing } from "../agents/SonaAgentPairing";
import { AgentBridgeWorkspace } from "../agents/AgentBridgeWorkspace";

/* The two switches that decide whether Sona talks to anything else on this
 * Mac, and the consoles behind them.
 *
 * The panel is the window agents speak through; the bridge is what a local
 * coding agent may ask Sona to do. Both are off-by-default policy, so they are
 * rows. Everything each one then shows — the relay it is paired with, the
 * sessions, the permission requests, the reply queue, the rules — is a console
 * you open when something is happening, so each is one disclosure rather than
 * a dozen sections that are empty on a Mac with nothing connected. */
export const AdvancedAgents: React.FC = () => {
  const { t } = useTranslation();

  return (
    <SettingsSection label={t("settingsV2.advanced.agents")}>
      <AgentPanelToggle />
      <SettingsDisclosure label={t("settings.agents.sonaAgent.title")} lazy>
        <SonaAgentPairing />
      </SettingsDisclosure>
      <SettingsDisclosure label={t("settingsV2.advanced.agentBridge")} lazy>
        <AgentBridgeWorkspace />
      </SettingsDisclosure>
    </SettingsSection>
  );
};
