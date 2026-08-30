import React, { useEffect, useState } from "react";
import { commands } from "@/bindings";
import { DeviceSelectRow } from "./DeviceSelectRow";
import { useSettings } from "../../hooks/useSettings";

export const ClamshellMicrophoneSelector: React.FC = React.memo(() => {
  const { audioDevices, refreshAudioDevices } = useSettings();
  const [isLaptop, setIsLaptop] = useState<boolean>(false);

  useEffect(() => {
    void (async () => {
      try {
        const result = await commands.isLaptop();
        setIsLaptop(result.status === "ok" && result.data);
      } catch (error) {
        console.error("Failed to check if device is laptop:", error);
        setIsLaptop(false);
      }
    })();
  }, []);

  // Only render on laptops
  if (!isLaptop) {
    return null;
  }

  return (
    <DeviceSelectRow
      settingKey="clamshell_microphone"
      labelKey="settings.debug.clamshellMicrophone.title"
      devices={audioDevices}
      refresh={refreshAudioDevices}
      /* Kept: "clamshell" is the jargon, and this sentence is the definition. */
      hintKey="settings.debug.clamshellMicrophone.description"
    />
  );
});

ClamshellMicrophoneSelector.displayName = "ClamshellMicrophoneSelector";
