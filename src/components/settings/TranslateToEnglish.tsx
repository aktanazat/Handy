import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/vg/switch";
import { SettingsRow } from "./rows";
import { useSettings } from "../../hooks/useSettings";

export const TranslateToEnglish: React.FC = React.memo(() => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const id = useId();

  return (
    <SettingsRow
      label={t("settings.advanced.translateToEnglish.label")}
      controlId={id}
    >
      <Switch
        id={id}
        checked={getSetting("translate_to_english") || false}
        onCheckedChange={(enabled) =>
          updateSetting("translate_to_english", enabled)
        }
        disabled={isUpdating("translate_to_english")}
      />
    </SettingsRow>
  );
});
