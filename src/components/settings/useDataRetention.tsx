import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type RecordingRetentionPeriod } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { Notice } from "./rows";

/* How much stays on disk: how many history entries are kept, and how long
 * their recordings survive. One error line serves both writes, because a
 * failure to store either is the same failure to the reader — and one node,
 * because the two surfaces that show it (the Essentials retention row and
 * Advanced's dictation section) had byte-identical copies of the markup. */
export const useDataRetention = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataUpdating, setDataUpdating] = useState(false);
  const historyLimit = getSetting("history_limit") ?? 5;
  const retentionPeriod = getSetting("recording_retention_period") ?? "never";

  const updateHistoryLimit = async (value: string) => {
    const next = Number.parseInt(value, 10);
    if (!Number.isFinite(next) || next < 0) return;
    setDataUpdating(true);
    setDataError(null);
    try {
      const result = await commands.updateHistoryLimit(next);
      if (result.status === "error") {
        setDataError(String(result.error));
        return;
      }
      await refreshSettings();
    } catch (error) {
      setDataError(String(error));
    } finally {
      setDataUpdating(false);
    }
  };

  const updateRetentionPeriod = async (period: RecordingRetentionPeriod) => {
    setDataUpdating(true);
    setDataError(null);
    try {
      const result = await commands.updateRecordingRetentionPeriod(period);
      if (result.status === "error") {
        setDataError(String(result.error));
        return;
      }
      await refreshSettings();
    } catch (error) {
      setDataError(String(error));
    } finally {
      setDataUpdating(false);
    }
  };

  return {
    /* The refusal, as the row that shows it: a full-width line inside the
     * surface rather than a label/control pair, which is why it is a node and
     * not a string the caller has to dress. `null` when the last write was
     * accepted, so a caller renders it unconditionally. */
    errorNotice:
      dataError === null ? null : (
        <div className="px-4 py-2.5">
          <Notice tone="danger" assertive>
            {`${t("settings.privacy.data.error")}: ${dataError}`}
          </Notice>
        </div>
      ),
    dataUpdating,
    historyLimit,
    retentionPeriod,
    updateHistoryLimit,
    updateRetentionPeriod,
  };
};
