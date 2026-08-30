import React from "react";
import { DeviceSelectRow } from "./DeviceSelectRow";
import { useSettings } from "../../hooks/useSettings";

export const OutputDeviceSelector: React.FC<{ disabled?: boolean }> =
  React.memo(({ disabled = false }) => {
    const { outputDevices, refreshOutputDevices } = useSettings();

    return (
      <DeviceSelectRow
        settingKey="selected_output_device"
        labelKey="settings.sound.outputDevice.title"
        devices={outputDevices}
        refresh={refreshOutputDevices}
        /* Kept: "Output device" does not say this is the feedback sounds only,
         * and a reader who assumes otherwise sets it for the wrong reason. */
        hintKey="settings.sound.outputDevice.description"
        disabled={disabled}
      />
    );
  });
