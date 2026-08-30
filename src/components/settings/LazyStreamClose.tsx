import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/vg/switch";
import { SettingsRow } from "./rows";
import { useSettings } from "../../hooks/useSettings";

export const LazyStreamClose: React.FC = React.memo(() => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const id = useId();

  return (
    <SettingsRow
      label={t("settings.advanced.lazyStreamClose.label")}
      /* Kept: the 30-second window and the Bluetooth cost are facts a reader
       * cannot get from the label, and the cost is why anyone turns it off. */
      hint={t("settings.advanced.lazyStreamClose.description")}
      controlId={id}
    >
      <Switch
        id={id}
        checked={getSetting("lazy_stream_close") ?? false}
        onCheckedChange={(enabled) =>
          updateSetting("lazy_stream_close", enabled)
        }
        disabled={isUpdating("lazy_stream_close")}
      />
    </SettingsRow>
  );
});
