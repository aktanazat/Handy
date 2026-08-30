import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/vg/switch";
import { SettingsRow } from "./rows";
import { useSettings } from "../../hooks/useSettings";

/**
 * Registers or unregisters the command chord.
 *
 * The chord ships registered, so an unread store must read as on: rendering
 * "off" would invite a click that turns a working shortcut off. `?? true`
 * carries the backend default rather than inventing a second one.
 */
export const CommandMode: React.FC = React.memo(() => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const id = useId();

  return (
    <SettingsRow
      label={t("settings.general.commandMode.label", "Voice command mode")}
      /* Kept: the gesture is the one thing the label cannot say, and nothing
       * else on the page says it. */
      hint={t(
        "settings.general.commandMode.description",
        "Hold the command shortcut and say what to change about the text you have selected.",
      )}
      controlId={id}
    >
      <Switch
        id={id}
        checked={getSetting("command_mode_enabled") ?? true}
        onCheckedChange={(enabled) =>
          updateSetting("command_mode_enabled", enabled)
        }
        disabled={isUpdating("command_mode_enabled")}
      />
    </SettingsRow>
  );
});
