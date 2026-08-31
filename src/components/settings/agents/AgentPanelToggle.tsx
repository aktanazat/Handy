import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Switch } from "@/components/vg/switch";
import { Notice, SettingsRow } from "@/components/settings/rows";
import { useSettings } from "@/hooks/useSettings";

/* The agent panel is the separate always-on-top window agents talk through.
 * The panel manager owns the command because switching it off also closes an
 * open panel window: that consequence is the one thing a reader cannot infer
 * from the switch, so it is the row's hint and nothing else says it.
 *
 * A bare row: Advanced's Agents section is its heading now. */
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
    <>
      <SettingsRow
        label={t("settings.agents.panel.label", "Enable agent panel")}
        hint={t(
          "settings.agents.panel.rowDescription",
          "Turning this off closes the panel window and makes Sona refuse every request to reopen it.",
        )}
        controlId="agent-panel-enabled"
      >
        <Switch
          id="agent-panel-enabled"
          checked={enabled}
          disabled={settings === null || updating}
          onCheckedChange={(next) => void change(next)}
        />
      </SettingsRow>
      {error === null ? null : (
        <div className="px-4 py-2.5">
          <Notice tone="danger">
            {`${t("settings.agents.panel.error", "The agent panel setting could not be saved.")} ${error}`}
          </Notice>
        </div>
      )}
    </>
  );
};
