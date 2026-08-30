import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { FIELD_MAX_W, SettingsRow } from "./rows";
import {
  SUPPORTED_LANGUAGES,
  getSupportedLanguage,
  setLanguage,
} from "../../i18n";
import { useSettings } from "@/hooks/useSettings";

export const AppLanguageSelector: React.FC = React.memo(() => {
  const { t, i18n } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const id = useId();

  const currentLanguage =
    getSupportedLanguage(settings?.app_language) || i18n.language;

  const handleLanguageChange = (langCode: string) => {
    // The locale's strings load on demand, so this resolves after the switch.
    void setLanguage(langCode);
    updateSetting("app_language", langCode);
  };

  return (
    <SettingsRow label={t("appLanguage.title")} controlId={id}>
      <Select value={currentLanguage} onValueChange={handleLanguageChange}>
        <SelectTrigger id={id} size="sm" className={`w-auto ${FIELD_MAX_W}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {`${lang.nativeName} (${lang.name})`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
});

AppLanguageSelector.displayName = "AppLanguageSelector";
