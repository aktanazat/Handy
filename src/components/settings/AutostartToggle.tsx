import React from "react";
import { BooleanSettingRow } from "./BooleanSettingRow";

/* "Launch on startup" named the mechanism; this names the moment. Essentials
 * is where a person meets it, so it reads the way they would say it. */
export const AutostartToggle: React.FC = React.memo(() => (
  <BooleanSettingRow
    settingKey="autostart_enabled"
    labelKey="settingsV2.essentials.launchAtLogin"
  />
));
