import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "@/components/ui";
import { CustomWords } from "../CustomWords";

/* The Vocabulary view of the Modes page. Global vocabulary lives here because
 * it is the counterpart to the per-mode vocabulary in the editor; the editor
 * pairs override these for one mode only. */
export const ModesVocabularyView: React.FC = () => {
  const { t } = useTranslation();

  return (
    <section
      className="mode-vocabulary-view"
      aria-labelledby="global-vocabulary-title"
    >
      <div className="section-heading-inline">
        <div>
          <h2 id="global-vocabulary-title">
            {t("settings.modes.globalVocabulary.title")}
          </h2>
          <p>{t("settings.modes.globalVocabulary.description")}</p>
        </div>
      </div>
      <SettingsGroup>
        <CustomWords descriptionMode="inline" grouped />
      </SettingsGroup>
    </section>
  );
};
