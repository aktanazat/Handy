import React from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import { SettingsGroup } from "@/components/ui";
import { useSettings } from "../../../hooks/useSettings";
import { AppLanguageSelector } from "../AppLanguageSelector";
import { AudioFeedback } from "../AudioFeedback";
import { ChannelSelector } from "../ChannelSelector";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { PushToTalk } from "../PushToTalk";
import { ShortcutInput } from "../ShortcutInput";
import { ThemeSelector } from "../ThemeSelector";
import { VolumeSlider } from "../VolumeSlider";
import { ModelSettingsCard } from "./ModelSettingsCard";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled, getSetting } = useSettings();
  const pushToTalk = getSetting("push_to_talk");
  // Linux has no separate cancel chord: the platform reports the release of a
  // held key differently, so push to talk is the only cancel path there.
  const isLinux = type() === "linux";

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("settings.general.title")}</h1>
        <p className="settings-page-description">
          {t(
            "settings.general.description",
            "The keys you press, the microphone Sona listens to, and how the app looks.",
          )}
        </p>
      </header>

      <SettingsGroup title={t("settings.general.shortcut.title")}>
        <ShortcutInput shortcutId="transcribe" grouped />
        <PushToTalk grouped />
        {!isLinux && !pushToTalk && (
          <ShortcutInput shortcutId="cancel" grouped />
        )}
      </SettingsGroup>

      <ModelSettingsCard />

      <SettingsGroup title={t("settings.sound.title")}>
        <MicrophoneSelector grouped />
        <ChannelSelector grouped />
        <MuteWhileRecording grouped />
        <AudioFeedback grouped />
        <OutputDeviceSelector grouped disabled={!audioFeedbackEnabled} />
        <VolumeSlider disabled={!audioFeedbackEnabled} />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.general.appearance.title", "Appearance")}
        description={t(
          "settings.general.appearance.description",
          "Interface language and colour scheme. Both apply immediately.",
        )}
      >
        <AppLanguageSelector grouped />
        <ThemeSelector grouped />
      </SettingsGroup>
    </div>
  );
};
