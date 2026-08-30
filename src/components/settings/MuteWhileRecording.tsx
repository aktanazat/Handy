import React from "react";
import { BooleanSettingRow } from "./BooleanSettingRow";

export const MuteWhileRecording: React.FC = React.memo(() => (
  <BooleanSettingRow
    settingKey="mute_while_recording"
    labelKey="settings.debug.muteWhileRecording.label"
  />
));
