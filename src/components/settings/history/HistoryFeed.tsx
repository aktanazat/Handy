import React from "react";
import { FileAudio } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HistoryRunReceipt } from "@/bindings";
import { AudioPlayerGroup } from "@/components/audio/AudioPlayer";
import { SETTINGS_SURFACE, SettingsCard } from "../rows";
import { Button } from "@/components/vg/button";
import { Skeleton } from "@/components/vg/skeleton";
import { HistoryEntryComponent, type HistoryTextView } from "./HistoryEntry";
import type { ListState } from "./historyListReducer";

const SKELETON_ROWS = [0, 1, 2, 3, 4];

/* The feed's own empty and failed states: one centred statement inside the
 * shape the rows would have taken, carrying at most one action. */
const HistoryFeedState: React.FC<{
  title: string;
  description?: string;
  tone?: "danger";
  children?: React.ReactNode;
}> = ({ title, description, tone, children }) => (
  <SettingsCard className="flex flex-col items-center gap-3 px-8 py-12 text-center">
    <p
      className={`text-[13px] leading-[19px] ${tone === "danger" ? "text-red-900" : "text-gray-1000"}`}
      role={tone === "danger" ? "alert" : undefined}
    >
      {title}
    </p>
    {description ? (
      <p className="max-w-[46ch] text-sm text-gray-900">{description}</p>
    ) : null}
    {children}
  </SettingsCard>
);

interface HistoryFeedProps {
  state: ListState;
  setQuery: (query: string) => void;
  view: HistoryTextView;
  activeQuery: string;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  receiptsByHistoryId: Record<number, HistoryRunReceipt[] | null>;
  startingAudioImport: boolean;
  toggleSaved: (id: number) => Promise<void>;
  copyToClipboard: (text: string) => Promise<void>;
  getAudioBlob: (historyId: number) => Promise<Blob | null>;
  deleteEntry: (id: number) => Promise<void>;
  retryHistoryEntry: (id: number) => Promise<void>;
  fetchPage: (query: string, cursor: number | null) => Promise<void>;
  onStartAudioImport: () => void;
}

/* The rows themselves, and the four things the list can be instead of rows:
 * still loading, unreadable, empty, or empty because a search matched
 * nothing. */
export const HistoryFeed: React.FC<HistoryFeedProps> = ({
  state,
  setQuery,
  view,
  activeQuery,
  sentinelRef,
  receiptsByHistoryId,
  startingAudioImport,
  toggleSaved,
  copyToClipboard,
  getAudioBlob,
  deleteEntry,
  retryHistoryEntry,
  fetchPage,
  onStartAudioImport,
}) => {
  const { t } = useTranslation();
  const trimmedActiveQuery = activeQuery.trim();
  const searching = trimmedActiveQuery !== "";

  const loadNextPage = () => {
    const last = state.entries[state.entries.length - 1];
    if (last) void fetchPage(activeQuery, last.id);
  };

  if (state.phase === "loading") {
    return (
      <div
        role="status"
        aria-label={t("settings.history.loading")}
        className={SETTINGS_SURFACE}
        data-testid="history-loading"
      >
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="flex flex-col gap-2 px-4 py-3">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-5 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (state.phase === "error") {
    /* The feed is the page. When it cannot be read there is nothing else to
     * put a bar above, so the region says why it is empty and carries the
     * one action that refills it. */
    return (
      <HistoryFeedState title={t("settings.history.loadError")} tone="danger">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchPage(activeQuery, null)}
        >
          {t("settings.history.retry")}
        </Button>
      </HistoryFeedState>
    );
  }

  if (state.entries.length === 0) {
    return searching ? (
      <HistoryFeedState
        title={t("settings.history.noResults", { query: trimmedActiveQuery })}
        description={t(
          "settings.history.noResultsHint",
          "Search matches whole words in both the raw and the processed transcript.",
        )}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => setQuery("")}
          data-testid="history-empty-clear"
        >
          {t("settings.history.clearSearch", "Clear search")}
        </Button>
      </HistoryFeedState>
    ) : (
      <HistoryFeedState
        title={t("settings.history.empty")}
        description={t(
          "settings.history.emptyHint",
          "You can also transcribe an existing recording: WAV, MP3, M4A, AAC, FLAC, OGG, MOV, MP4 or M4V, up to 30 minutes.",
        )}
      >
        <Button
          size="sm"
          onClick={onStartAudioImport}
          disabled={startingAudioImport}
          data-testid="history-empty-import"
        >
          <FileAudio aria-hidden="true" className="size-4" />
          {t("settings.history.audioImport.start")}
        </Button>
      </HistoryFeedState>
    );
  }

  const showFooter =
    state.hasMore || state.phase === "paging" || state.phase === "paging-error";

  return (
    <AudioPlayerGroup>
      <ul
        role="list"
        aria-label={t("topNav.library")}
        className={SETTINGS_SURFACE}
        data-testid="history-list"
      >
        {state.entries.map((entry) => (
          <HistoryEntryComponent
            key={entry.id}
            entry={entry}
            receipts={receiptsByHistoryId[entry.id]}
            view={view}
            onToggleSaved={toggleSaved}
            onCopyText={copyToClipboard}
            getAudioBlob={getAudioBlob}
            deleteAudio={deleteEntry}
            retryTranscription={retryHistoryEntry}
          />
        ))}
        {showFooter && (
          <li className="flex flex-wrap items-center justify-center gap-3 px-4 py-3">
            {state.phase === "paging" && (
              <span className="text-sm text-gray-900" aria-live="polite">
                {t("settings.history.loading")}
              </span>
            )}
            {state.phase === "paging-error" && (
              <>
                <span className="text-sm text-red-900" role="alert">
                  {t("settings.history.loadError")}
                </span>
                <Button variant="outline" size="sm" onClick={loadNextPage}>
                  {t("settings.history.retry")}
                </Button>
              </>
            )}
            {state.phase === "ready" && state.hasMore && (
              <Button
                variant="outline"
                size="sm"
                onClick={loadNextPage}
                data-testid="history-load-more"
              >
                {t("settings.history.loadMore", "Load more")}
              </Button>
            )}
            {/* The infinite-scroll trip wire. Zero height, never focusable. */}
            <div ref={sentinelRef} className="h-px" />
          </li>
        )}
      </ul>
    </AudioPlayerGroup>
  );
};
