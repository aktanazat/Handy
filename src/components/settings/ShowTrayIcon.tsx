import React from "react";
import { BooleanSettingRow } from "./BooleanSettingRow";

export const ShowTrayIcon: React.FC = React.memo(() => (
  <BooleanSettingRow
    settingKey="show_tray_icon"
    labelKey="settings.advanced.showTrayIcon.label"
    defaultValue
  />
));
