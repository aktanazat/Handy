import React from "react";
import { useTranslation } from "react-i18next";
import type { RecordingRetentionPeriod } from "@/bindings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { SettingsRow } from "@/components/settings/rows";
import { useDataRetention } from "../useDataRetention";

const RETENTION_OPTIONS = [
  "never",
  "preserve_limit",
  "days_3",
  "weeks_2",
  "months_3",
] as const satisfies readonly RecordingRetentionPeriod[];

const RETENTION_ID = "essentials-recording-retention";

/* How long a recording stays on this Mac.
 *
 * The one retention control on Essentials, and the only place in the app that
 * writes `recording_retention_period`. Library and Meetings link here rather
 * than carrying a copy of it. */
export const RecordingRetentionRow: React.FC = () => {
  const { t } = useTranslation();
  const { errorNotice, dataUpdating, retentionPeriod, updateRetentionPeriod } =
    useDataRetention();

  return (
    <>
      <SettingsRow
        label={t("settingsV2.essentials.retention")}
        controlId={RETENTION_ID}
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
          <SelectTrigger id={RETENTION_ID} size="sm">
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
      {errorNotice}
    </>
  );
};
