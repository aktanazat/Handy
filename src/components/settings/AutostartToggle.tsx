import React from "react";
import { BooleanSettingRow } from "./BooleanSettingRow";

export const AutostartToggle: React.FC = React.memo(() => (
  <BooleanSettingRow
    settingKey="autostart_enabled"
    labelKey="settings.advanced.autostart.label"
  />
));
