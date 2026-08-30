import React from "react";
import { BooleanSettingRow } from "./BooleanSettingRow";

export const ShowWhatsNewOnUpdate: React.FC = () => (
  <BooleanSettingRow
    settingKey="show_whats_new_on_update"
    labelKey="settings.about.whatsNewUpdates.label"
    defaultValue
  />
);
