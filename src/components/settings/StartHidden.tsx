import React from "react";
import { BooleanSettingRow } from "./BooleanSettingRow";

export const StartHidden: React.FC = React.memo(() => (
  <BooleanSettingRow
    settingKey="start_hidden"
    labelKey="settings.advanced.startHidden.label"
    /* Kept: "hidden" does not say Sona is still running, in the tray, with
     * no window — which is the whole question this row raises. */
    hintKey="settings.advanced.startHidden.description"
  />
));
