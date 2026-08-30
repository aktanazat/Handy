import React from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import { SettingsPage, SettingsSection } from "@/components/settings/rows";
import { useSettings } from "../../../hooks/useSettings";
import { AppLanguageSelector } from "../AppLanguageSelector";
import { CommandMode } from "../CommandMode";
import { AudioFeedback } from "../AudioFeedback";
import { ChannelSelector } from "../ChannelSelector";
import { MaterialSelector } from "../MaterialSelector";
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
  /* Defaults on, matching the backend, so the chord's row does not blink out
   * on first paint while the store is still loading. */
  const commandModeEnabled = getSetting("command_mode_enabled") ?? true;
  // Linux has no separate cancel chord: the platform reports the release of a
  // held key differently, so push to talk is the only cancel path there.
  const isLinux = type() === "linux";

  return (
    <SettingsPage title={t("settings.general.title")}>
      {/* The command chord sits with the switch that registers it, so turning
       * the feature off visibly takes its shortcut row with it. */}
      <SettingsSection label={t("settings.general.shortcut.title")}>
        <ShortcutInput shortcutId="transcribe" />
        <PushToTalk />
        {!isLinux && !pushToTalk && <ShortcutInput shortcutId="cancel" />}
        <CommandMode />
        {commandModeEnabled && <ShortcutInput shortcutId="command" />}
      </SettingsSection>

      <ModelSettingsCard />

      <SettingsSection label={t("settings.sound.title")}>
        <MicrophoneSelector />
        <ChannelSelector />
        <MuteWhileRecording />
        <AudioFeedback />
        <OutputDeviceSelector disabled={!audioFeedbackEnabled} />
        <VolumeSlider disabled={!audioFeedbackEnabled} />
      </SettingsSection>

      <SettingsSection label={t("settings.general.appearance.title")}>
        <AppLanguageSelector />
        <ThemeSelector />
        <MaterialSelector />
      </SettingsSection>
    </SettingsPage>
  );
};
