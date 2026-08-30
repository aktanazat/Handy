import React from "react";
import { BooleanSettingRow } from "./BooleanSettingRow";

export const AudioFeedback: React.FC = React.memo(() => (
  <BooleanSettingRow
    settingKey="audio_feedback"
    labelKey="settings.sound.audioFeedback.label"
  />
));
