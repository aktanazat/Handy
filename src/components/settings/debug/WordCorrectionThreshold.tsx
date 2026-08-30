import React from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { SettingsRow } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Slider } from "@/components/vg/slider";
import { useSettings } from "../../../hooks/useSettings";

export const WordCorrectionThreshold: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting, resetSetting, isUpdating } = useSettings();
  const label = t("settings.debug.wordCorrectionThreshold.title");
  const value = settings?.word_correction_threshold ?? 0.18;
  const busy = isUpdating("word_correction_threshold");

  return (
    <SettingsRow label={label} fact={value.toFixed(2)}>
      <Slider
        aria-label={label}
        className="w-40"
        value={[value]}
        min={0}
        max={1}
        step={0.01}
        disabled={busy}
        onValueChange={([next]) =>
          void updateSetting("word_correction_threshold", next)
        }
      />
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        aria-label={t("common.resetSetting", { name: label })}
        onClick={() => void resetSetting("word_correction_threshold")}
      >
        <RotateCcw aria-hidden="true" />
      </Button>
    </SettingsRow>
  );
};
