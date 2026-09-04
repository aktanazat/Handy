import React from "react";
import { FileAudio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageTitle, SettingsPage } from "../rows";
import { Button } from "@/components/vg/button";
import { HistoryAudioImportSection } from "./HistoryAudioImportSection";
import { HistoryImportLive } from "./HistoryImportLive";
import { HistoryFeed } from "./HistoryFeed";
import { HistoryToolbar } from "./HistoryToolbar";
import { HistorySummary } from "./HistorySummary";
import { useHistoryData } from "./useHistoryData";

/* The `sona://dictation/<id>` address the shell was asked to open. The shell
 * holds one of these and this page consumes it, so the shape has one name. */
export interface DictationRequest {
  historyId: number;
  nonce: number;
}

export const HistorySettings: React.FC<{
  dictationRequest?: DictationRequest | null;
}> = ({ dictationRequest = null }) => {
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
    /* The column and the type still come from the shared primitive, so Library
     * cannot drift from every other settings page. The title line takes the
     * primitive's `header` slot rather than its `title`/`actions` pair for one
     * reason: the totals are a single line now, and a line that describes what
     * the page holds belongs against the title it describes, not a page gap
     * below it. The folder button stays on the list toolbar with the other
     * quiet list controls, so the title row can never crowd it. */
    <SettingsPage
      header={
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4">
            {/* The rail names this destination Library, so the page answers to
             * the same word — one destination, one name. `settings.history.*`
             * keys keep their address; only the visible values moved to the
             * rail's term. */}
            <PageTitle>{t("topNav.library")}</PageTitle>
            <Button
              size="sm"
              onClick={() => void startAudioImport()}
              disabled={startingAudioImport}
              data-testid="history-import"
            >
              <FileAudio aria-hidden="true" className="size-4" />
              {t("overview.hero.importAudio")}
            </Button>
          </div>
          <HistorySummary
            stats={historyStats}
            loading={statsLoading}
            error={statsError}
            onRetry={() => void refreshHistoryStats()}
          />
          {/* Always mounted, and empty it takes no space: a live region that
           * appears with its first message loses that message. */}
          <HistoryImportLive jobs={audioImportJobs} />
        </div>
      }
    >
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
          focusRequest={dictationRequest}
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
