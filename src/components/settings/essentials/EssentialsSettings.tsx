import React from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsLinkRow,
  SettingsPage,
  SettingsSurface,
} from "@/components/settings/rows";
import { useModelStore } from "@/stores/modelStore";
import { AutostartToggle } from "../AutostartToggle";
import { LanguageSelector } from "../LanguageSelector";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { PushToTalk } from "../PushToTalk";
import { ShortcutInput } from "../ShortcutInput";
import { ThemeSelector } from "../ThemeSelector";
import { MeetingAppsPicker } from "../meetings/MeetingAppsPicker";
import { MeetingDetectionToggle } from "../meetings/MeetingDetectionSettings";
import { RecordingRetentionRow } from "./RecordingRetentionRow";
import { SoundsRow } from "./SoundsRow";

/* Everything a person actually changes, on one surface.
 *
 * No section labels: the tab above already names the page, and eleven rows
 * under one hairline surface is the whole point — headings here would divide a
 * list short enough to read at once. Anything that needs a heading is not
 * essential and lives on Advanced.
 *
 * The two link rows are the seam. Dictation styles and the model catalog are
 * editors, not settings, so this page names them and hands them over rather
 * than growing a section for each. */
export const EssentialsSettings: React.FC<{
  onOpenModes: () => void;
}> = ({ onOpenModes }) => {
  const { t } = useTranslation();
  const { currentModel, models } = useModelStore();
  const model = models.find((candidate) => candidate.id === currentModel);

  return (
    <SettingsPage title={t("settingsV2.essentials.title")}>
      <SettingsSurface data-testid="settings-essentials">
        <ShortcutInput shortcutId="transcribe" />
        <PushToTalk />
        <MicrophoneSelector />
        {/* The spoken language, beside the microphone that hears it. The list
         * narrows to what the loaded model can recognise, so a model with one
         * language shows one language rather than a hundred it would ignore. */}
        <LanguageSelector
          supportedLanguages={model?.supported_languages}
          supportsLanguageDetection={model?.supports_language_detection}
        />
        <SoundsRow />
        <AutostartToggle />
        <MeetingDetectionToggle />
        <MeetingAppsPicker />
        <RecordingRetentionRow />
        <ThemeSelector />
        <SettingsLinkRow
          label={t("settingsV2.essentials.dictationStyles")}
          action={t("settingsV2.essentials.dictationStylesAction")}
          onOpen={onOpenModes}
        />
      </SettingsSurface>
    </SettingsPage>
  );
};
