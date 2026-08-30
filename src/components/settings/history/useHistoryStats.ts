import { useCallback, useEffect, useRef, useState } from "react";
import { commands, type HistoryStats } from "@/bindings";

// All-time stats follow the same discipline as the list: only the newest
// request may write, an error clears stale data, and late responses are
// ignored so a slow read never overwrites a fresh one.
export const useHistoryStats = () => {
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const statsRequestRef = useRef(0);

  const refreshHistoryStats = useCallback(async () => {
    const requestId = statsRequestRef.current + 1;
    statsRequestRef.current = requestId;
    setStatsLoading(true);
    setStatsError(false);
    try {
      const result = await commands.getHistoryStats();
      if (statsRequestRef.current !== requestId) return;
      if (result.status === "ok") {
        setHistoryStats(result.data);
      } else {
        setHistoryStats(null);
        setStatsError(true);
      }
    } catch {
      if (statsRequestRef.current !== requestId) return;
      setHistoryStats(null);
      setStatsError(true);
    } finally {
      // The stale-request guard only protects data writes; the loading flag
      // must clear on both success and rejection, so it resets unconditionally.
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHistoryStats();
  }, [refreshHistoryStats]);

  return { historyStats, statsLoading, statsError, refreshHistoryStats };
};
