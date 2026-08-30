import React from "react";
import { useTranslation } from "react-i18next";
import { Slider } from "@/components/vg/slider";
import { SettingsRow } from "./rows";
import { useSettings } from "../../hooks/useSettings";

export const VolumeSlider: React.FC<{ disabled?: boolean }> = ({
  disabled = false,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const audioFeedbackVolume = getSetting("audio_feedback_volume") ?? 0.5;
  const label = t("settings.sound.volume.title");

  /* The percentage is the row's measurement, so it sits beside the label as a
   * mono fact — not as a second sentence under the control. */
  return (
    <SettingsRow
      label={label}
      /* `fact` sets it in mono, so the digits are already fixed-width and the
       * label beside them does not shift under the drag. */
      fact={`${Math.round(audioFeedbackVolume * 100)}%`}
      disabled={disabled}
    >
      <Slider
        aria-label={label}
        value={[audioFeedbackVolume]}
        onValueChange={([value]) =>
          updateSetting("audio_feedback_volume", value)
        }
        min={0}
        max={1}
        step={0.01}
        disabled={disabled}
        className="w-40"
      />
    </SettingsRow>
  );
};
