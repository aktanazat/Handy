import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "@/components/ui";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { ClamshellMicrophoneSelector } from "../ClamshellMicrophoneSelector";
import { SoundPicker } from "../SoundPicker";
import { KeyboardDiagnostic } from "./KeyboardDiagnostic";
import { LiveLogViewer } from "./LiveLogViewer";
import { LogLevelSelector } from "./LogLevelSelector";
import { PasteDelay } from "./PasteDelay";
import { RecordingBuffer } from "./RecordingBuffer";
import { ReliablePasteToggle } from "./ReliablePaste";
import { WhatsNewPreview } from "./WhatsNewPreview";
import { WordCorrectionThreshold } from "./WordCorrectionThreshold";

/* Everything here used to sit in one unlabelled group of twelve rows. Same
 * twelve affordances, sorted into the four things people come here to debug. */
export const DebugSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("settings.debug.title")}</h1>
        <p className="settings-page-description">
          {t(
            "settings.debug.description",
            "Instrumentation and unsupported knobs. Visible because debug mode is on.",
          )}
        </p>
      </header>

      <SettingsGroup title={t("settings.debug.groups.capture", "Capture")}>
        <AlwaysOnMicrophone grouped />
        <ClamshellMicrophoneSelector grouped />
        <RecordingBuffer grouped />
        <SoundPicker
          label={t("settings.debug.soundTheme.label")}
          description={t("settings.debug.soundTheme.description")}
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.debug.groups.delivery", "Text delivery")}
      >
        <WordCorrectionThreshold grouped />
        <PasteDelay grouped />
        <PasteDelay
          grouped
          settingKey="paste_delay_after_ms"
          labelKey="settings.debug.pasteDelayAfter.title"
          descriptionKey="settings.debug.pasteDelayAfter.description"
        />
        <ReliablePasteToggle grouped />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.debug.groups.diagnostics", "Diagnostics")}
      >
        <KeyboardDiagnostic />
        <WhatsNewPreview grouped />
      </SettingsGroup>

      <SettingsGroup title={t("settings.debug.groups.logging", "Logging")}>
        <LogLevelSelector grouped />
        <LiveLogViewer grouped />
      </SettingsGroup>
    </div>
  );
};
