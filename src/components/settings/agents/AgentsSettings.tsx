import React from "react";
import { AgentBridgeSettingsPage } from "./AgentBridgeSettingsPage";
import { useAgentBridgeSettings } from "./useAgentBridgeSettings";

export const AgentsSettings: React.FC = () => {
  const model = useAgentBridgeSettings();
  return <AgentBridgeSettingsPage model={model} />;
};
