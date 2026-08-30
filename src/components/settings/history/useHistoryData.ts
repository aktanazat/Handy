import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands } from "@/bindings";
import { loadHistoryAudioBlob } from "./historyAudioBlob";
import { useAudioImportJobs } from "./useAudioImportJobs";
import { useHistoryFeed } from "./useHistoryFeed";
import { useHistoryStats } from "./useHistoryStats";
import { useVisibleReceipts } from "./useVisibleReceipts";

/* Everything the Library page reads or writes, in one place: the feed, the
 * totals above it, the file imports beside it, and the operations a row can
 * perform on itself. The three data hooks are independent except where the
 * backend makes them dependent — a history write moves the totals, and a
 * finished import writes a row the feed has not seen — so those two edges are
 * the only wiring here, and both are stable callbacks so no subscription is
 * torn down by a re-render. */
export const useHistoryData = () => {
  const { t } = useTranslation();
  const { historyStats, statsLoading, statsError, refreshHistoryStats } =
    useHistoryStats();

  const handleHistoryMutation = useCallback(() => {
    void refreshHistoryStats();
  }, [refreshHistoryStats]);

  const {
    state,
    query,
    setQuery,
    view,
    setView,
    activeQuery,
    sentinelRef,
    fetchPage,
    reloadFirstPage,
  } = useHistoryFeed(handleHistoryMutation);

  const receiptsByHistoryId = useVisibleReceipts(state.entries);

  const handleImportCompleted = useCallback(() => {
    reloadFirstPage();
    void refreshHistoryStats();
  }, [reloadFirstPage, refreshHistoryStats]);

  const {
    audioImportJobs,
    audioImportError,
    startingAudioImport,
    startAudioImport,
    cancelAudioImport,
  } = useAudioImportJobs(handleImportCompleted);

  const toggleSaved = useCallback(
    async (id: number) => {
      try {
        const result = await commands.toggleHistoryEntrySaved(id);
        if (result.status !== "ok") {
          throw new Error(String(result.error));
        }
      } catch (error) {
        console.error("Failed to update saved history entry:", error);
        toast.error(t("settings.history.saveError"));
      }
    },
    [t],
  );

  const copyToClipboard = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
  }, []);

  const getAudioBlob = useCallback(async (historyId: number) => {
    try {
      return await loadHistoryAudioBlob(historyId);
    } catch (error) {
      console.error("Failed to load history audio:", error);
      return null;
    }
  }, []);

  const deleteEntry = useCallback(async (id: number) => {
    const result = await commands.deleteHistoryEntry(id);
    if (result.status !== "ok") {
      throw new Error(String(result.error));
    }
  }, []);

  const retryHistoryEntry = useCallback(async (id: number) => {
    const result = await commands.retryHistoryEntryTranscription(id);
    if (result.status !== "ok") {
      throw new Error(String(result.error));
    }
  }, []);

  const openRecordingsFolder = useCallback(async () => {
    try {
      const result = await commands.openRecordingsFolder();
      if (result.status !== "ok") {
        throw new Error(String(result.error));
      }
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
    }
  }, []);

  return {
    state,
    query,
    setQuery,
    view,
    setView,
    activeQuery,
    sentinelRef,
    receiptsByHistoryId,
    audioImportJobs,
    audioImportError,
    startingAudioImport,
    historyStats,
    statsLoading,
    statsError,
    refreshHistoryStats,
    fetchPage,
    toggleSaved,
    copyToClipboard,
    getAudioBlob,
    deleteEntry,
    retryHistoryEntry,
    startAudioImport,
    cancelAudioImport,
    openRecordingsFolder,
  };
};
