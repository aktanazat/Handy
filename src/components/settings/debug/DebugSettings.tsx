import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsPage, SettingsSection } from "@/components/settings/rows";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { ClamshellMicrophoneSelector } from "../ClamshellMicrophoneSelector";
import { SoundPicker } from "../SoundPicker";
import { KeyboardDiagnostic } from "./KeyboardDiagnostic";
import { LiveLogViewer } from "./LiveLogViewer";
import { LogLevelSelector } from "./LogLevelSelector";
import { RecordingBuffer } from "./RecordingBuffer";
import { WhatsNewPreview } from "./WhatsNewPreview";
import { WordCorrectionThreshold } from "./WordCorrectionThreshold";

/* Instrumentation, so the density here is the point: nine affordances, sorted
 * into the four things people come to this page to debug. What it does not get
 * is a sentence per group explaining the group's own heading. The delivery
 * group holds only what is genuinely global — the three per-mode delivery
 * knobs that used to sit here live in the mode editor, beside their siblings
 * and bound to the field a run actually reads. */
export const DebugSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <SettingsPage title={t("settings.debug.title")}>
      <SettingsSection label={t("settings.debug.groups.capture")}>
        <AlwaysOnMicrophone />
        <ClamshellMicrophoneSelector />
        <RecordingBuffer />
        <SoundPicker label={t("settings.debug.soundTheme.label")} />
      </SettingsSection>

      <SettingsSection label={t("settings.debug.groups.delivery")}>
        <WordCorrectionThreshold />
      </SettingsSection>

      <SettingsSection label={t("settings.debug.groups.diagnostics")}>
        <KeyboardDiagnostic />
        <WhatsNewPreview />
      </SettingsSection>

      <SettingsSection label={t("settings.debug.groups.logging")}>
        <LogLevelSelector />
        <LiveLogViewer />
      </SettingsSection>
    </SettingsPage>
  );
};
