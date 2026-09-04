import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FileAudio, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HistoryRunReceipt } from "@/bindings";
import { AudioPlayerGroup } from "@/components/audio/AudioPlayer";
import { SETTINGS_SURFACE, SettingsCard } from "../rows";
import { Button } from "@/components/vg/button";
import { Skeleton } from "@/components/vg/skeleton";
import { destinationIcons } from "@/lib/navIcons";
import { groupByLocalDay, localDayHeading } from "@/lib/utils/localDay";
import { HistoryEntryComponent, type HistoryTextView } from "./HistoryEntry";
import type { ListState } from "./historyListReducer";

const SKELETON_ROWS = [0, 1, 2, 3, 4];

/* The feed's own empty and failed states: one centred statement inside the
 * shape the rows would have taken, carrying at most one action. */
const HistoryFeedState: React.FC<{
  title: string;
  description?: string;
  tone?: "danger";
  icon?: LucideIcon;
  children?: React.ReactNode;
}> = ({ title, description, tone, icon: Icon, children }) => (
  <SettingsCard className="flex flex-col items-center gap-3 px-8 py-12 text-center">
    {Icon ? <Icon aria-hidden="true" className="size-4 text-gray-800" /> : null}
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
  /** The dictation a sona:// link named, including a nonce for repeat links. */
  focusRequest?: { historyId: number; nonce: number } | null;
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

/* How far a dictation link will page before it gives up: six pages, or 180
 * rows at the feed's page size. A `sona://dictation/<id>` link can name a row
 * that was deleted or swept by retention, and with no bound the walk mounts
 * the whole log looking for a row that is not there. */
const DEEP_LINK_PAGE_BUDGET = 6;

/** What the feed has already done for one dictation link. */
export type DeepLinkProgress = {
  nonce: number;
  satisfied: boolean;
  pagesLoaded: number;
};

/** The one thing the feed does next for a dictation link. */
export type DeepLinkStep =
  | { kind: "none" }
  | { kind: "clear-search" }
  | { kind: "expand"; historyId: number }
  | { kind: "load-page"; cursor: number };

/** That step, with the progress the feed stores back for this link. */
export type DeepLinkPlan = {
  step: DeepLinkStep;
  progress: DeepLinkProgress | null;
};

type DeepLinkPlanInput = {
  focusRequest: { historyId: number; nonce: number } | null;
  progress: DeepLinkProgress | null;
  activeQuery: string;
  entries: readonly { id: number }[];
  phase: ListState["phase"];
  hasMore: boolean;
};

/* The whole deep-link decision, kept out of the effect below so that what the
 * feed does for a link is one value rather than a sequence of renders.
 *
 * `App.tsx` sets the dictation request in its `queryLinkRequested` listener
 * and never clears it, so a request that has been served is spent. Acting on
 * it a second time cleared the History search box 200 ms after the user typed
 * into it, re-ran the expand on every return to the section, and re-expanded
 * the row on every history event. A later link carries a higher nonce, which
 * starts a fresh search clear and a fresh page walk. */
export const planDeepLinkStep = ({
  focusRequest,
  progress,
  activeQuery,
  entries,
  phase,
  hasMore,
}: DeepLinkPlanInput): DeepLinkPlan => {
  if (focusRequest === null) return { step: { kind: "none" }, progress };
  const served =
    progress !== null && progress.nonce === focusRequest.nonce
      ? progress
      : { nonce: focusRequest.nonce, satisfied: false, pagesLoaded: 0 };
  if (served.satisfied) return { step: { kind: "none" }, progress: served };
  // The row is looked for in the unfiltered log, so a search goes first and
  // the reload it triggers runs this decision again.
  if (activeQuery !== "") {
    return { step: { kind: "clear-search" }, progress: served };
  }
  const target = entries.find((entry) => entry.id === focusRequest.historyId);
  if (target) {
    return {
      step: { kind: "expand", historyId: target.id },
      progress: { ...served, satisfied: true },
    };
  }
  // A page is already in flight; its result runs this decision again.
  if (phase !== "ready") return { step: { kind: "none" }, progress: served };
  const last = entries[entries.length - 1];
  if (!hasMore || !last || served.pagesLoaded >= DEEP_LINK_PAGE_BUDGET) {
    // The row is not in the log, or is further back than the walk goes. The
    // link is spent here, so the next history event does not re-arm it.
    return { step: { kind: "none" }, progress: { ...served, satisfied: true } };
  }
  return {
    step: { kind: "load-page", cursor: last.id },
    progress: { ...served, pagesLoaded: served.pagesLoaded + 1 },
  };
};

/* The log, in day groups, and the four things the list can be instead of rows:
 * still loading, unreadable, empty, or empty because a search matched
 * nothing. */
export const HistoryFeed: React.FC<HistoryFeedProps> = ({
  state,
  setQuery,
  view,
  activeQuery,
  focusRequest = null,
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

  /* Grouping is cheap, but a keystroke in the search field re-renders this
   * component (the query lives with the list state), and rebuilding the group
   * arrays on each one would hand every row a new parent array for no reason. */
  const dayGroups = useMemo(
    () => groupByLocalDay(state.entries, (entry) => entry.timestamp * 1000),
    [state.entries],
  );

  /* Which recording is open. One at a time, and the list is what knows: a row
   * cannot close its neighbour. An id that leaves the page (a new search, a
   * deleted row) simply matches nothing, so there is nothing to clean up. */
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const toggleExpanded = useCallback(
    (id: number) => setExpandedId((current) => (current === id ? null : id)),
    [],
  );

  /* What has already been done for the link this feed was handed. A ref, not
   * state: the effect below both reads it and carries it forward, and none of
   * that is something to render. */
  const deepLinkRef = useRef<DeepLinkProgress | null>(null);

  useEffect(() => {
    const plan = planDeepLinkStep({
      focusRequest,
      progress: deepLinkRef.current,
      activeQuery,
      entries: state.entries,
      phase: state.phase,
      hasMore: state.hasMore,
    });
    deepLinkRef.current = plan.progress;
    switch (plan.step.kind) {
      case "clear-search":
        setQuery("");
        return;
      case "expand":
        setExpandedId(plan.step.historyId);
        return;
      case "load-page":
        void fetchPage("", plan.step.cursor);
        return;
      case "none":
        return;
    }
  }, [
    activeQuery,
    fetchPage,
    focusRequest,
    setQuery,
    state.entries,
    state.hasMore,
    state.phase,
  ]);

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
          <div key={row} className="flex items-center gap-3 px-4 py-2.5">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-3 w-12" />
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
        icon={destinationIcons.history}
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
        icon={destinationIcons.history}
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
      <div className="flex flex-col gap-6" data-testid="history-list">
        {dayGroups.map((group) => {
          /* One day, one section: a heading over one hairline surface, which is
           * the grammar `SettingsSection` is written in. It is restated here
           * rather than composed because the surface has to be the `<ul>`
           * itself — a list whose rows are separated by the surface's own
           * hairlines — which is why `SETTINGS_SURFACE` is exported as a class
           * string and not only as a component. */
          const heading = localDayHeading(group.startOfDayMs, t);
          return (
            <section
              key={group.startOfDayMs}
              className="flex flex-col gap-3"
              data-testid="history-day"
            >
              <h2
                className="text-[13px] leading-5 text-gray-900"
                data-testid="history-day-heading"
              >
                {heading}
              </h2>
              <ul role="list" aria-label={heading} className={SETTINGS_SURFACE}>
                {group.items.map((entry) => (
                  <HistoryEntryComponent
                    key={entry.id}
                    entry={entry}
                    receipts={receiptsByHistoryId[entry.id]}
                    view={view}
                    expanded={entry.id === expandedId}
                    focusNonce={
                      entry.id === focusRequest?.historyId
                        ? focusRequest.nonce
                        : undefined
                    }
                    onToggleExpanded={toggleExpanded}
                    onToggleSaved={toggleSaved}
                    onCopyText={copyToClipboard}
                    getAudioBlob={getAudioBlob}
                    deleteAudio={deleteEntry}
                    retryTranscription={retryHistoryEntry}
                  />
                ))}
              </ul>
            </section>
          );
        })}

        {/* The footer belongs to the feed, not to the last day: a page that
         * arrives while it is visible may open a new day group above it. */}
        {showFooter && (
          <div className="flex flex-wrap items-center justify-center gap-3">
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
          </div>
        )}
      </div>
    </AudioPlayerGroup>
  );
};
