import React from "react";
import { FileAudio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsPage } from "../rows";
import { Button } from "@/components/vg/button";
import { HistoryAudioImportSection } from "./HistoryAudioImportSection";
import { HistoryImportLive } from "./HistoryImportLive";
import { HistoryFeed } from "./HistoryFeed";
import { HistoryToolbar } from "./HistoryToolbar";
import { HistorySummary } from "./HistorySummary";
import { useHistoryData } from "./useHistoryData";

export const HistorySettings: React.FC = () => {
  const { t } = useTranslation();
  const {
    state,
    query,
    setQuery,
    view,
    setView,
    activeQuery,
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
    sentinelRef,
    startAudioImport,
    cancelAudioImport,
    openRecordingsFolder,
  } = useHistoryData();

  return (
    /* The column and the page title come from the shared primitive, not from
     * this file: `SettingsPage` decides the measure and the 24px title, so
     * Library cannot drift from every other settings page. The title keeps
     * exactly one companion — the page's primary action. The folder button
     * lives on the list toolbar with the other quiet list controls, so this
     * row can never crowd it. */
    <SettingsPage
      /* The rail names this destination Library, so the page answers to the
       * same word — one destination, one name. `settings.history.*` keys keep
       * their address; only the visible values moved to the rail's term. */
      title={t("topNav.library")}
      actions={
        <Button
          size="sm"
          onClick={() => void startAudioImport()}
          disabled={startingAudioImport}
          data-testid="history-import"
        >
          <FileAudio aria-hidden="true" className="size-4" />
          {t("overview.hero.importAudio")}
        </Button>
      }
    >
      {/* The totals and the import status read as one block under the title. */}
      <div className="flex min-w-0 flex-col gap-4">
        <HistorySummary
          stats={historyStats}
          loading={statsLoading}
          error={statsError}
          onRetry={() => void refreshHistoryStats()}
        />
        <HistoryImportLive jobs={audioImportJobs} />
      </div>

      <HistoryAudioImportSection
        jobs={audioImportJobs}
        error={audioImportError}
        onCancel={cancelAudioImport}
      />

      <div className="flex flex-col gap-3">
        <HistoryToolbar
          state={state}
          query={query}
          setQuery={setQuery}
          view={view}
          setView={setView}
          activeQuery={activeQuery}
          onOpenFolder={() => void openRecordingsFolder()}
        />

        <HistoryFeed
          state={state}
          setQuery={setQuery}
          view={view}
          activeQuery={activeQuery}
          sentinelRef={sentinelRef}
          receiptsByHistoryId={receiptsByHistoryId}
          startingAudioImport={startingAudioImport}
          toggleSaved={toggleSaved}
          copyToClipboard={copyToClipboard}
          getAudioBlob={getAudioBlob}
          deleteEntry={deleteEntry}
          retryHistoryEntry={retryHistoryEntry}
          fetchPage={fetchPage}
          onStartAudioImport={() => void startAudioImport()}
        />
      </div>
    </SettingsPage>
  );
};
