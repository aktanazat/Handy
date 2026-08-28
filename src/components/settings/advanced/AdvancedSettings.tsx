import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown, SettingContainer, SettingsGroup } from "@/components/ui";
import { useSettings } from "../../../hooks/useSettings";
import { AccelerationSelector } from "../AccelerationSelector";
import { AutostartToggle } from "../AutostartToggle";
import { ExperimentalToggle } from "../ExperimentalToggle";
import { LazyStreamClose } from "../LazyStreamClose";
import { ModelUnloadTimeoutSetting } from "../ModelUnloadTimeout";
import { ShowOverlay } from "../ShowOverlay";
import { ShowTrayIcon } from "../ShowTrayIcon";
import { StartHidden } from "../StartHidden";
import { KeyboardImplementationSelector } from "../debug/KeyboardImplementationSelector";

/* Previously three collapsed <details> disclosures, which hid every advanced
 * setting behind a click and made the page unscannable. The same settings are
 * now plain groups; the disclosure headings became the group headings. */
export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, settings, updateSetting } = useSettings();
  const experimentalEnabled = getSetting("experimental_enabled") || false;
  const englishSpelling = settings?.english_spelling ?? "as_spoken";

  return (
    <div className="settings-page advanced-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("sidebar.advanced")}</h1>
        <p className="settings-page-description">
          {t("settings.advanced.description")}
        </p>
      </header>

      <SettingsGroup
        title={t("settings.advanced.disclosures.launch.title")}
        description={t("settings.advanced.disclosures.launch.description")}
      >
        <StartHidden grouped />
        <AutostartToggle grouped />
        <ShowTrayIcon grouped />
        <ShowOverlay grouped />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.advanced.disclosures.processing.title")}
        description={t("settings.advanced.disclosures.processing.description")}
      >
        <ModelUnloadTimeoutSetting grouped />
        <SettingContainer
          grouped
          title={t("settings.advanced.englishSpelling.label")}
          description={t("settings.advanced.englishSpelling.description")}
        >
          <Dropdown
            selectedValue={englishSpelling}
            options={[
              {
                value: "as_spoken",
                label: t("settings.advanced.englishSpelling.values.as_spoken"),
              },
              {
                value: "british",
                label: t("settings.advanced.englishSpelling.values.british"),
              },
            ]}
            onSelect={(value) => {
              if (value === "as_spoken" || value === "british") {
                void updateSetting("english_spelling", value);
              }
            }}
          />
        </SettingContainer>
      </SettingsGroup>

      {/* The switch sits with what it unlocks, so turning it on visibly
       * extends this group instead of revealing a section elsewhere. */}
      <SettingsGroup
        title={t("settings.advanced.groups.experimental")}
        description={t(
          "settings.advanced.disclosures.experimental.description",
        )}
      >
        <ExperimentalToggle grouped />
        {experimentalEnabled ? (
          <>
            <KeyboardImplementationSelector grouped />
            <AccelerationSelector grouped />
            <LazyStreamClose grouped />
          </>
        ) : null}
      </SettingsGroup>
    </div>
  );
};
