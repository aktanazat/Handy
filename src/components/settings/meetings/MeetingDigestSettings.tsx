import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { BooleanSettingRow } from "@/components/settings/BooleanSettingRow";
import { SettingsRow } from "@/components/settings/rows";
import { Input } from "@/components/vg/input";
import { useSettings } from "@/hooks/useSettings";

/* D20's two controls: whether the evening digest speaks, and when.
 *
 * The hour row only exists while the digest is on. A time field under a switch
 * that is off is a control with nothing to control, and hiding it is what makes
 * the switch read as the decision it is.
 *
 * The backend stores minutes past local midnight rather than "18:00" so it has
 * no clock format to parse. This component is the only place that conversion
 * lives, because `<input type="time">` is the only thing that needs it. */

const DEFAULT_MINUTE_OF_DAY = 18 * 60;

/** Minutes past midnight as the `HH:MM` an `<input type="time">` speaks. */
export const minuteOfDayToTime = (minuteOfDay: number): string => {
  const clamped = Math.min(Math.max(Math.trunc(minuteOfDay), 0), 24 * 60 - 1);
  const hours = String(Math.floor(clamped / 60)).padStart(2, "0");
  const minutes = String(clamped % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
};

/** `HH:MM` back to minutes, or `null` for the empty and half-typed values the
 * field reports while someone is still typing into it. */
export const timeToMinuteOfDay = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

export const MeetingDigestSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const timeId = useId();
  const enabled = getSetting("meeting_digest_enabled") ?? false;
  const minuteOfDay =
    getSetting("meeting_digest_minute_of_day") ?? DEFAULT_MINUTE_OF_DAY;

  return (
    <>
      <BooleanSettingRow
        settingKey="meeting_digest_enabled"
        labelKey="settings.meetings.digest.title"
        hintKey="settings.meetings.digest.description"
      />
      {enabled ? (
        <SettingsRow
          label={t("settings.meetings.digest.timeLabel")}
          hint={t("settings.meetings.digest.timeHint")}
          controlId={timeId}
        >
          <Input
            id={timeId}
            type="time"
            className="w-32"
            value={minuteOfDayToTime(minuteOfDay)}
            disabled={isUpdating("meeting_digest_minute_of_day")}
            onChange={(changed) => {
              const next = timeToMinuteOfDay(changed.target.value);
              if (next === null) return;
              void updateSetting("meeting_digest_minute_of_day", next);
            }}
          />
        </SettingsRow>
      ) : null}
    </>
  );
};
