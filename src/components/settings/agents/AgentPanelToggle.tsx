import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Alert, SettingsGroup, ToggleSwitch } from "@/components/ui";
import { useSettings } from "@/hooks/useSettings";

/* The agent panel is the separate always-on-top window agents talk through.
 * The panel manager owns the command because switching it off also closes an
 * open panel window. */
export const AgentPanelToggle: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings, settings } = useSettings();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = getSetting("agent_panel_enabled") ?? true;

  const change = async (next: boolean) => {
    setUpdating(true);
    setError(null);
    try {
      const saved = await commands.changeAgentPanelEnabledSetting(next);
      if (saved.status === "error") throw new Error(saved.error);
      await refreshSettings();
    } catch (changeError) {
      setError(String(changeError));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <SettingsGroup
      title={t("settings.agents.panel.title", "Agent panel")}
      description={t(
        "settings.agents.panel.description",
        "The floating window agents post to and read replies from.",
      )}
    >
      <ToggleSwitch
        grouped
        checked={enabled}
        disabled={settings === null}
        isUpdating={updating}
        onChange={(next) => void change(next)}
        label={t("settings.agents.panel.label", "Enable agent panel")}
        description={t(
          "settings.agents.panel.rowDescription",
          "Turning this off closes the panel window and makes Sona refuse every request to reopen it.",
        )}
      />
      {error === null ? null : (
        <Alert
          contained
          variant="error"
        >{`${t("settings.agents.panel.error", "The agent panel setting could not be saved.")} ${error}`}</Alert>
      )}
    </SettingsGroup>
  );
};
