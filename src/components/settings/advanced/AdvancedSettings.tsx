import React from "react";
import { useTranslation } from "react-i18next";
import { ShowOverlay } from "../ShowOverlay";
import { ModelUnloadTimeoutSetting } from "../ModelUnloadTimeout";
import { Dropdown } from "../../ui/Dropdown";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { StartHidden } from "../StartHidden";
import { AutostartToggle } from "../AutostartToggle";
import { ShowTrayIcon } from "../ShowTrayIcon";
import { ExperimentalToggle } from "../ExperimentalToggle";
import { useSettings } from "../../../hooks/useSettings";
import { KeyboardImplementationSelector } from "../debug/KeyboardImplementationSelector";
import { AccelerationSelector } from "../AccelerationSelector";
import { LazyStreamClose } from "../LazyStreamClose";

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

      <SettingsGroup title={t("settings.advanced.groups.app")}>
        <ExperimentalToggle descriptionMode="tooltip" grouped />
      </SettingsGroup>

      <details className="settings-disclosure">
        <summary>
          <span>{t("settings.advanced.disclosures.launch.title")}</span>
          <span>{t("settings.advanced.disclosures.launch.description")}</span>
        </summary>
        <div className="settings-disclosure-body">
          <SettingsGroup>
            <StartHidden descriptionMode="tooltip" grouped />
            <AutostartToggle descriptionMode="tooltip" grouped />
            <ShowTrayIcon descriptionMode="tooltip" grouped />
            <ShowOverlay descriptionMode="tooltip" grouped />
          </SettingsGroup>
        </div>
      </details>

      <details className="settings-disclosure">
        <summary>
          <span>{t("settings.advanced.disclosures.processing.title")}</span>
          <span>
            {t("settings.advanced.disclosures.processing.description")}
          </span>
        </summary>
        <div className="settings-disclosure-body">
          <SettingsGroup>
            <ModelUnloadTimeoutSetting descriptionMode="tooltip" grouped />
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
                    label: t(
                      "settings.advanced.englishSpelling.values.as_spoken",
                    ),
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
        </div>
      </details>

      {experimentalEnabled ? (
        <details className="settings-disclosure">
          <summary>
            <span>{t("settings.advanced.groups.experimental")}</span>
            <span>
              {t("settings.advanced.disclosures.experimental.description")}
            </span>
          </summary>
          <div className="settings-disclosure-body">
            <SettingsGroup>
              <KeyboardImplementationSelector
                descriptionMode="tooltip"
                grouped
              />
              <AccelerationSelector descriptionMode="tooltip" grouped />
              <LazyStreamClose descriptionMode="tooltip" grouped />
            </SettingsGroup>
          </div>
        </details>
      ) : null}
    </div>
  );
};
