import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { Slider } from "@/components/vg/slider";
import { Switch } from "@/components/vg/switch";
import { SettingsRow } from "@/components/settings/rows";
import { useSettings } from "@/hooks/useSettings";

/* Feedback sounds, as one row.
 *
 * They were two rows and a third for the output device: a switch, a slider,
 * and a picker, all governed by the same boolean. A person setting this is
 * answering one question — should Sona make a noise, and how loud — so it is
 * one row, with the loudness beside the switch that silences it.
 *
 * The percentage sits in `fact`, which is tabular, so the label does not shift
 * under the drag. */
export const SoundsRow: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating, audioFeedbackEnabled } =
    useSettings();
  const id = useId();
  const volume = getSetting("audio_feedback_volume") ?? 1;
  const label = t("settingsV2.essentials.sounds");

  return (
    <SettingsRow
      label={label}
      fact={audioFeedbackEnabled ? `${Math.round(volume * 100)}%` : undefined}
      controlId={id}
    >
      <Slider
        aria-label={t("settingsV2.essentials.volume")}
        value={[volume]}
        onValueChange={([next]) =>
          void updateSetting("audio_feedback_volume", next)
        }
        min={0}
        max={1}
        step={0.01}
        disabled={!audioFeedbackEnabled}
        className="w-32"
      />
      <Switch
        id={id}
        checked={audioFeedbackEnabled}
        onCheckedChange={(enabled) =>
          void updateSetting("audio_feedback", enabled)
        }
        disabled={isUpdating("audio_feedback")}
      />
    </SettingsRow>
  );
};
