import React from "react";
import { DeviceSelectRow } from "./DeviceSelectRow";
import { useSettings } from "../../hooks/useSettings";

export const MicrophoneSelector: React.FC = React.memo(() => {
  const { audioDevices, refreshAudioDevices } = useSettings();

  return (
    <DeviceSelectRow
      settingKey="selected_microphone"
      labelKey="settings.sound.microphone.title"
      devices={audioDevices}
      refresh={refreshAudioDevices}
    />
  );
});
