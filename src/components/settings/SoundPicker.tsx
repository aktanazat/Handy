import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { PlayIcon } from "lucide-react";
import { Button } from "@/components/vg/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { FIELD_MAX_W, SettingsRow } from "./rows";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSettings } from "../../hooks/useSettings";
import type { SoundTheme } from "@/bindings";

/* Every theme's name, including one the list may not be offering. `custom` is
 * offered only once both files exist, but it can already be the SAVED value:
 * `customSounds` starts `{ start: false, stop: false }` on every boot until
 * the file check resolves, and a file can be deleted later while the setting
 * still reads `custom`. Radix portals a label into the trigger only from a
 * mounted, selected item, so the trigger has to be handed the name itself or
 * it renders empty in exactly those two states. */
const THEME_LABELS = {
  marimba: "Marimba",
  pop: "Pop",
  custom: "Custom",
  /* `satisfies`, so a new `SoundTheme` is a compile error here rather than a
   * blank trigger for whoever saved it. */
} satisfies Record<SoundTheme, string>;

export const SoundPicker: React.FC<{ label: string }> = ({ label }) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const playTestSound = useSettingsStore((state) => state.playTestSound);
  const customSounds = useSettingsStore((state) => state.customSounds);
  const id = useId();

  const selectedTheme = getSetting("sound_theme") ?? "marimba";

  // Only offer Custom once both custom sound files exist.
  const offered: SoundTheme[] =
    customSounds.start && customSounds.stop
      ? ["marimba", "pop", "custom"]
      : ["marimba", "pop"];

  const playBothSounds = async () => {
    await playTestSound("start");
    await playTestSound("stop");
  };

  return (
    <SettingsRow label={label} controlId={id}>
      <Select
        value={selectedTheme}
        onValueChange={(value) =>
          /* SAFETY: the items below are the SoundTheme values, and a Radix
             select can only report an item's own value. */
          updateSetting("sound_theme", value as SoundTheme)
        }
      >
        <SelectTrigger id={id} size="sm" className={`w-auto ${FIELD_MAX_W}`}>
          <SelectValue>{THEME_LABELS[selectedTheme]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {offered.map((theme) => (
            <SelectItem key={theme} value={theme}>
              {THEME_LABELS[theme]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t(
          "settings.debug.soundTheme.preview",
          "Preview the start and stop sounds",
        )}
        onClick={() => void playBothSounds()}
      >
        <PlayIcon aria-hidden="true" />
      </Button>
    </SettingsRow>
  );
};
