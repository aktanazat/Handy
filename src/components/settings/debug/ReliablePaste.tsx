import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/components/settings/rows";
import { Switch } from "@/components/vg/switch";
import { useSettings } from "../../../hooks/useSettings";
import { useOsType } from "../../../hooks/useOsType";

const CONTROL_ID = "debug-reliable-paste";

export const ReliablePasteToggle: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const osType = useOsType();

  // The receipt-sequenced paste path is implemented for macOS and Windows.
  if (osType !== "macos" && osType !== "windows") {
    return null;
  }

  return (
    <SettingsRow
      label={t("settings.debug.reliablePaste.title")}
      hint={t("settings.debug.reliablePaste.description")}
      controlId={CONTROL_ID}
    >
      <Switch
        id={CONTROL_ID}
        checked={getSetting("reliable_paste") ?? false}
        disabled={isUpdating("reliable_paste")}
        onCheckedChange={(enabled) =>
          void updateSetting("reliable_paste", enabled)
        }
      />
    </SettingsRow>
  );
};
