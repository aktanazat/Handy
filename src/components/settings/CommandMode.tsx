import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface CommandModeProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * Registers or unregisters the command chord.
 *
 * The chord ships registered, so an unread store must read as on: rendering
 * "off" would invite a click that turns a working shortcut off. `?? true`
 * carries the backend default rather than inventing a second one.
 */
export const CommandMode: React.FC<CommandModeProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    return (
      <ToggleSwitch
        checked={getSetting("command_mode_enabled") ?? true}
        onChange={(enabled) => updateSetting("command_mode_enabled", enabled)}
        isUpdating={isUpdating("command_mode_enabled")}
        label={t("settings.general.commandMode.label", "Voice command mode")}
        description={t(
          "settings.general.commandMode.description",
          "Hold the command shortcut and say what to change about the text you have selected.",
        )}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
