import React from "react";
import { useTranslation } from "react-i18next";
import type { RecordingRetentionPeriod } from "@/bindings";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { SettingsRow, SettingsSection } from "@/components/settings/rows";
import { AppDataDirectory } from "../AppDataDirectory";
import { MeetingRetentionSettings } from "../meetings/MeetingRetention";
import { FailureNotice } from "./FailureNotice";
import { PrivacyHistoryStorage } from "./PrivacyHistoryStorage";
import { useDataRetention } from "./useDataRetention";

const RETENTION_OPTIONS = [
  "never",
  "preserve_limit",
  "days_3",
  "weeks_2",
  "months_3",
] as const satisfies readonly RecordingRetentionPeriod[];

export const PrivacyDataSettings: React.FC = () => {
  const { t } = useTranslation();
  const {
    dataError,
    dataUpdating,
    historyLimit,
    retentionPeriod,
    updateHistoryLimit,
    updateRetentionPeriod,
  } = useDataRetention();

  return (
    <SettingsSection label={t("settings.privacy.data.title")}>
      <PrivacyHistoryStorage />
      {dataError ? (
        <FailureNotice className="px-4 py-2.5">
          {`${t("settings.privacy.data.error")}: ${dataError}`}
        </FailureNotice>
      ) : null}
      <SettingsRow
        label={t("settings.privacy.data.historyLimit.label")}
        hint={t("settings.privacy.data.historyLimit.description")}
        controlId="privacy-history-limit"
      >
        <Input
          id="privacy-history-limit"
          type="number"
          min="0"
          max="1000"
          value={historyLimit}
          onChange={(event) => void updateHistoryLimit(event.target.value)}
          disabled={dataUpdating}
          className="w-20"
        />
      </SettingsRow>
      <SettingsRow
        label={t("settings.privacy.data.retention.label")}
        controlId="privacy-recording-retention"
      >
        <Select
          value={retentionPeriod}
          disabled={dataUpdating}
          onValueChange={(period) => {
            const next = RETENTION_OPTIONS.find(
              (candidate) => candidate === period,
            );
            if (next) void updateRetentionPeriod(next);
          }}
        >
          {/* No fixed width: the retention labels are long in several locales
           * and a Select trigger clips them with no ellipsis. */}
          <SelectTrigger id="privacy-recording-retention" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RETENTION_OPTIONS.map((period) => (
              <SelectItem key={period} value={period}>
                {t("settings.privacy.data.retention.values." + period)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <MeetingRetentionSettings />
      <AppDataDirectory />
    </SettingsSection>
  );
};
