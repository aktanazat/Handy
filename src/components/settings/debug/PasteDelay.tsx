import React from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { SettingsRow } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Slider } from "@/components/vg/slider";
import { useSettings } from "../../../hooks/useSettings";

type PasteDelayKey = "paste_delay_ms" | "paste_delay_after_ms";

/* The two delays bracket the paste keystroke and fail in opposite directions —
 * one loses the transcript, the other pastes your previous clipboard — so each
 * row names its own side and carries its own symptom. Callers pass the setting
 * key and nothing else: the copy travels with the key, so the two rows cannot
 * end up wearing the same sentence. */
const COPY = {
  paste_delay_ms: {
    label: "settings.debug.pasteDelay.title",
    hint: "settings.debug.pasteDelay.description",
  },
  paste_delay_after_ms: {
    label: "settings.debug.pasteDelayAfter.title",
    hint: "settings.debug.pasteDelayAfter.description",
  },
} satisfies Record<PasteDelayKey, { label: string; hint: string }>;

export const PasteDelay: React.FC<{ settingKey?: PasteDelayKey }> = ({
  settingKey = "paste_delay_ms",
}) => {
  const { t } = useTranslation();
  const { settings, updateSetting, resetSetting, isUpdating } = useSettings();
  const copy = COPY[settingKey];
  const label = t(copy.label);
  const value = settings?.[settingKey] ?? 60;
  const busy = isUpdating(settingKey);

  return (
    <SettingsRow label={label} hint={t(copy.hint)} fact={`${value}ms`}>
      <Slider
        aria-label={label}
        className="w-40"
        value={[value]}
        min={10}
        max={500}
        step={10}
        disabled={busy}
        onValueChange={([next]) => void updateSetting(settingKey, next)}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        aria-label={t("common.resetSetting", { name: label })}
        onClick={() => void resetSetting(settingKey)}
      >
        <RotateCcw aria-hidden="true" />
      </Button>
    </SettingsRow>
  );
};
