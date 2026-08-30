import React, { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { SettingsRow } from "./rows";
import { commands } from "@/bindings";
import { useSettings } from "../../hooks/useSettings";

export const ChannelSelector: React.FC = React.memo(() => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating, isLoading } = useSettings();
  const [channelCount, setChannelCount] = useState(1);
  const id = useId();

  const selectedMicrophone = getSetting("selected_microphone") || "default";
  const selectedChannel = getSetting("selected_channel");

  useEffect(() => {
    let cancelled = false;
    setChannelCount(1);

    void (async () => {
      try {
        const deviceName =
          selectedMicrophone === "Default" ? "default" : selectedMicrophone;
        const result = await commands.getMicrophoneChannels(deviceName);
        if (!cancelled && result.status === "ok") {
          setChannelCount(result.data);
        }
      } catch (error) {
        console.error("Failed to get microphone channel count:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedMicrophone]);

  // Don't render if the device only has one channel.
  if (channelCount <= 1) {
    return null;
  }

  // An old selection may not exist on a newly selected device. The recorder
  // also falls back to averaging in that case, so reflect that effective value.
  const currentValue =
    selectedChannel == null || selectedChannel >= channelCount
      ? "average"
      : selectedChannel.toString();

  return (
    <SettingsRow label={t("settings.sound.channel.title")} controlId={id}>
      <Select
        value={currentValue}
        onValueChange={(value) =>
          void updateSetting(
            "selected_channel",
            value === "average" ? null : parseInt(value, 10),
          )
        }
        disabled={isUpdating("selected_channel") || isLoading}
      >
        <SelectTrigger id={id} size="sm" className="w-50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="average">
            {t("settings.sound.channel.average")}
          </SelectItem>
          {Array.from({ length: channelCount }, (_, index) => (
            <SelectItem key={index} value={index.toString()}>
              {t("settings.sound.channel.channel", { n: index + 1 })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
});

ChannelSelector.displayName = "ChannelSelector";
