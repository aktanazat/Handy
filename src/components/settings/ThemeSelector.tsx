import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { SettingsRow } from "./rows";
import { useSettings } from "@/hooks/useSettings";
import { applyTheme, THEME_OPTIONS } from "@/lib/utils/theme";
import type { Theme } from "@/bindings";

export const ThemeSelector: React.FC = React.memo(() => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const id = useId();

  const currentTheme: Theme = settings?.theme ?? "system";

  const handleThemeChange = (value: string) => {
    /* SAFETY: the items below are exactly `THEME_OPTIONS`, which is the Theme
       union spelled out, and a Radix select can only report an item's value. */
    const theme = value as Theme;
    applyTheme(theme);
    updateSetting("theme", theme);
  };

  return (
    /* "Appearance", not "Application Theme": the row is the only appearance
     * control left, and its three options say what it does. */
    <SettingsRow label={t("settingsV2.essentials.appearance")} controlId={id}>
      <Select value={currentTheme} onValueChange={handleThemeChange}>
        <SelectTrigger id={id} size="sm" className="w-50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THEME_OPTIONS.map((value) => (
            <SelectItem key={value} value={value}>
              {t(`theme.options.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
});

ThemeSelector.displayName = "ThemeSelector";
