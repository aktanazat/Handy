import React from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { SettingsRow } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Slider } from "@/components/vg/slider";
import { useSettings } from "../../../hooks/useSettings";

export const RecordingBuffer: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting, resetSetting, isUpdating } = useSettings();
  const label = t("settings.debug.recordingBuffer.title");
  const value = settings?.extra_recording_buffer_ms ?? 0;
  const busy = isUpdating("extra_recording_buffer_ms");

  return (
    <SettingsRow
      label={label}
      hint={t("settings.debug.recordingBuffer.description")}
      fact={`${value}ms`}
    >
      <Slider
        aria-label={label}
        className="w-40"
        value={[value]}
        min={0}
        max={1500}
        step={50}
        disabled={busy}
        onValueChange={([next]) =>
          void updateSetting("extra_recording_buffer_ms", next)
        }
      />
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        aria-label={t("common.resetSetting", { name: label })}
        onClick={() => void resetSetting("extra_recording_buffer_ms")}
      >
        <RotateCcw aria-hidden="true" />
      </Button>
    </SettingsRow>
  );
};
