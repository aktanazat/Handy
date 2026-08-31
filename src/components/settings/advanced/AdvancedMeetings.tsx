import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsSection } from "@/components/settings/rows";
import {
  MeetingDetectionAdvanced,
  MeetingDetectionState,
} from "../meetings/MeetingDetectionSettings";
import { MeetingDigestSettings } from "../meetings/MeetingDigestSettings";
import { MeetingRetentionSettings } from "../meetings/MeetingRetention";
import { MeetingTrackersSettings } from "../meetings/MeetingTrackersSettings";

/* Everything about meetings that is not the switch on Essentials.
 *
 * The Meetings page used to carry this as a settings tail under its own
 * history, which is why detection had two homes. It has one now: the master
 * switch and the app list are Essentials, and what widens the evidence, how
 * long a meeting is kept, what the operator's own phrase lists are, and what
 * detection can currently see are all here. */
export const AdvancedMeetings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <>
      <SettingsSection label={t("settingsV2.advanced.meetings")}>
        <MeetingDetectionAdvanced />
        <MeetingRetentionSettings />
        <MeetingDigestSettings />
      </SettingsSection>
      <MeetingDetectionState />
      <MeetingTrackersSettings />
    </>
  );
};
