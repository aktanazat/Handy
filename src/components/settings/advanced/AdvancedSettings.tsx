import React from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { useSettings } from "../../../hooks/useSettings";
import { AccelerationSelector } from "../AccelerationSelector";
import { AutostartToggle } from "../AutostartToggle";
import { ExperimentalToggle } from "../ExperimentalToggle";
import { LazyStreamClose } from "../LazyStreamClose";
import { ModelUnloadTimeoutSetting } from "../ModelUnloadTimeout";
import { ShowOverlay } from "../ShowOverlay";
import { HudPillSettings } from "../HudPillSettings";
import { ShowTrayIcon } from "../ShowTrayIcon";
import { StartHidden } from "../StartHidden";
import { KeyboardImplementationSelector } from "../debug/KeyboardImplementationSelector";

const SPELLING_ID = "advanced-english-spelling";

/* Previously three collapsed <details> disclosures, which hid every advanced
 * setting behind a click; then three boxed groups that each explained their own
 * heading. Now three hairline sections whose headings are the whole label. */
export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const experimentalEnabled = settings?.experimental_enabled ?? false;
  const englishSpelling = settings?.english_spelling ?? "as_spoken";

  return (
    <SettingsPage title={t("sidebar.advanced")}>
      <SettingsSection label={t("settings.advanced.disclosures.launch.title")}>
        <StartHidden />
        <AutostartToggle />
        <ShowTrayIcon />
        <ShowOverlay />
        <HudPillSettings />
      </SettingsSection>

      <SettingsSection
        label={t("settings.advanced.disclosures.processing.title")}
      >
        <ModelUnloadTimeoutSetting />
        {/* The two option names are the description: "As spoken" or
         * "British" says everything a sentence under the row would. */}
        <SettingsRow
          label={t("settings.advanced.englishSpelling.label")}
          controlId={SPELLING_ID}
        >
          <Select
            value={englishSpelling}
            onValueChange={(value) => {
              if (value !== "as_spoken" && value !== "british") return;
              void updateSetting("english_spelling", value);
            }}
          >
            <SelectTrigger id={SPELLING_ID} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="as_spoken">
                {t("settings.advanced.englishSpelling.values.as_spoken")}
              </SelectItem>
              <SelectItem value="british">
                {t("settings.advanced.englishSpelling.values.british")}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      {/* The switch sits with what it unlocks, so turning it on visibly
       * extends this section instead of revealing one elsewhere. */}
      <SettingsSection label={t("settings.advanced.groups.experimental")}>
        <ExperimentalToggle />
        {experimentalEnabled ? (
          <>
            <KeyboardImplementationSelector />
            <AccelerationSelector />
            <LazyStreamClose />
          </>
        ) : null}
      </SettingsSection>
    </SettingsPage>
  );
};
