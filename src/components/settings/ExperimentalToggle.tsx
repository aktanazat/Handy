import React from "react";
import { BooleanSettingRow } from "./BooleanSettingRow";

export const ExperimentalToggle: React.FC = React.memo(() => (
  <BooleanSettingRow
    settingKey="experimental_enabled"
    labelKey="settings.advanced.experimentalToggle.label"
  />
));
