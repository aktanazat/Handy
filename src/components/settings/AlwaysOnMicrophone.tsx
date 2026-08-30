import React from "react";
import { BooleanSettingRow } from "./BooleanSettingRow";

export const AlwaysOnMicrophone: React.FC = React.memo(() => (
  <BooleanSettingRow
    settingKey="always_on_microphone"
    labelKey="settings.debug.alwaysOnMicrophone.label"
  />
));
