import { useState } from "react";
import { commands, type RecordingRetentionPeriod } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";

/* How much stays on disk: how many history entries are kept, and how long
 * their recordings survive. One error line serves both writes, because a
 * failure to store either is the same failure to the reader. */
export const useDataRetention = () => {
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
    dataError,
    dataUpdating,
    historyLimit,
    retentionPeriod,
    updateHistoryLimit,
    updateRetentionPeriod,
  };
};
