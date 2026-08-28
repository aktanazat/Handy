import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FileAudio, FolderOpen, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  commands,
  events,
  type AudioImportJob,
  type HistoryEntry,
  type HistoryRunReceipt,
  type HistoryStats,
  type HistoryUpdatePayload,
} from "@/bindings";
import { AudioPlayerGroup } from "../../ui/AudioPlayer";
import { Button } from "../../ui/Button";
import { CloudSyncPanel } from "../../cloud-sync/CloudSyncPanel";
import { Input } from "../../ui/Input";
import "../settings-density.css";
import { HistoryEntryComponent, type HistoryTextView } from "./HistoryEntry";
type HistoryMetric = "recordings" | "duration" | "words";

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 200;
const NUMBER_FORMATTER = new Intl.NumberFormat();
const DURATION_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
const TEXT_VIEWS = [
  { value: "processed", labelKey: "settings.history.textView.processed" },
  { value: "raw", labelKey: "settings.history.textView.raw" },
] as const satisfies ReadonlyArray<{
  value: HistoryTextView;
  labelKey: string;
}>;

const MEDIA_IMPORT_EXTENSIONS = [
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "mov",
  "mp4",
  "m4v",
];

type HistoryAudioChunk = {
  bytes: number[];
  eof: boolean;
};

const loadHistoryAudioBlob = async (
  historyId: number,
): Promise<Blob | null> => {
  let offset = 0;
  let receivedBytes = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await invoke<HistoryAudioChunk>(
          "read_history_audio_chunk",
          { historyId, offset },
        );
        const bytes = new Uint8Array(chunk.bytes);
        if (bytes.byteLength > 0) {
          receivedBytes = true;
          offset += bytes.byteLength;
          controller.enqueue(bytes);
        }
        if (chunk.eof) {
          controller.close();
        } else if (bytes.byteLength === 0) {
          controller.error(
            new Error("History audio ended before the next chunk"),
          );
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
  const blob = await new Response(stream, {
    headers: { "Content-Type": "audio/wav" },
  }).blob();

  return receivedBytes ? blob : null;
};

const upsertAudioImportJob = (
  jobs: AudioImportJob[],
  next: AudioImportJob,
): AudioImportJob[] =>
  [...jobs.filter((job) => job.id !== next.id), next].sort(
    (left, right) => left.id - right.id,
  );

type ReceiptLoad = readonly [number, HistoryRunReceipt[] | null];

const loadRunReceipts = async (
  historyIds: number[],
): Promise<ReceiptLoad[]> => {
  const receipts: ReceiptLoad[] = [];
  const batchSize = 4;

  for (let start = 0; start < historyIds.length; start += batchSize) {
    const batch = historyIds.slice(start, start + batchSize);
    const batchReceipts = await Promise.all(
      batch.map(async (historyId) => {
        try {
          const result = await commands.getHistoryRunReceipts(historyId);
          return [
            historyId,
            result.status === "ok" ? result.data : null,
          ] as const;
        } catch {
          return [historyId, null] as const;
        }
      }),
    );
    receipts.push(...batchReceipts);
  }

  return receipts;
};

interface ListState {
  entries: HistoryEntry[];
  hasMore: boolean;
  phase: "loading" | "paging" | "paging-error" | "ready" | "error";
}

// Failures carry no message. The backend logs the cause and the pane shows one
// translated state, so no SQLite text or transport detail reaches the user.
type ListAction =
  | { type: "first-page-request" }
  | { type: "next-page-request" }
  | { type: "page"; entries: HistoryEntry[]; hasMore: boolean; append: boolean }
  | { type: "failed"; append: boolean }
  | { type: "added"; entry: HistoryEntry }
  | { type: "replaced"; entry: HistoryEntry }
  | { type: "removed"; id: number }
  | { type: "saved-toggled"; id: number };

const INITIAL_LIST_STATE: ListState = {
  entries: [],
  hasMore: false,
  phase: "loading",
};

const appendUniqueEntries = (
  entries: HistoryEntry[],
  incoming: HistoryEntry[],
): HistoryEntry[] => {
  const seen = new Set(entries.map((entry) => entry.id));
  return [...entries, ...incoming.filter((entry) => !seen.has(entry.id))];
};

const listReducer = (state: ListState, action: ListAction): ListState => {
  switch (action.type) {
    case "first-page-request":
      return INITIAL_LIST_STATE;
    case "next-page-request":
      return state.phase === "ready" || state.phase === "paging-error"
        ? { ...state, phase: "paging" }
        : state;
    case "page":
      return {
        entries: action.append
          ? appendUniqueEntries(state.entries, action.entries)
          : action.entries,
        hasMore: action.hasMore,
        phase: "ready",
      };
    case "failed":
      return { ...state, phase: action.append ? "paging-error" : "error" };
    case "added":
      return {
        ...state,
        entries: [
          action.entry,
          ...state.entries.filter((entry) => entry.id !== action.entry.id),
        ],
      };
    case "replaced":
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.id === action.entry.id ? action.entry : entry,
        ),
      };
    case "removed":
      return {
        ...state,
        entries: state.entries.filter((entry) => entry.id !== action.id),
      };
    case "saved-toggled":
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.id === action.id ? { ...entry, saved: !entry.saved } : entry,
        ),
      };
  }
};

const subscribeToHistoryUpdates = (
  activeQueryRef: React.MutableRefObject<string>,
  dispatch: React.Dispatch<ListAction>,
  onMutation: () => void,
) =>
  events.historyUpdatePayload.listen((event) => {
    const payload: HistoryUpdatePayload = event.payload;
    switch (payload.action) {
      case "added":
        // A new entry has not been evaluated against an active FTS query, so it
        // joins only the unfiltered list. The next search asks SQLite itself.
        if (activeQueryRef.current.trim() === "") {
          dispatch({ type: "added", entry: payload.entry });
        }
        break;
      case "updated":
        dispatch({ type: "replaced", entry: payload.entry });
        break;
      case "deleted":
        dispatch({ type: "removed", id: payload.id });
        break;
      case "toggled":
        dispatch({ type: "saved-toggled", id: payload.id });
        break;
    }
    onMutation();
  });
const subscribeToAudioImportUpdates = (
  onUpdate: (job: AudioImportJob) => void,
) =>
  events.audioImportUpdateEvent.listen((event) => onUpdate(event.payload.job));

interface OpenRecordingsButtonProps {
  onClick: () => void;
  label: string;
}

const OpenRecordingsButton: React.FC<OpenRecordingsButtonProps> = ({
  onClick,
  label,
}) => (
  <Button
    onClick={onClick}
    variant="secondary"
    size="sm"
    className="flex items-center gap-2"
    title={label}
  >
    <FolderOpen aria-hidden="true" className="h-4 w-4" />
    <span>{label}</span>
  </Button>
);

const useHistoryData = () => {
  const { t, i18n } = useTranslation();
  const [state, dispatch] = useReducer(listReducer, INITIAL_LIST_STATE);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [view, setView] = useState<HistoryTextView>("processed");
  const [receiptsByHistoryId, setReceiptsByHistoryId] = useState<
    Record<number, HistoryRunReceipt[] | null>
  >({});
  const [audioImportJobs, setAudioImportJobs] = useState<AudioImportJob[]>([]);
  const [audioImportError, setAudioImportError] = useState<
    "start" | "cancel" | "load" | null
  >(null);
  const [startingAudioImport, setStartingAudioImport] = useState(false);
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pagingRef = useRef(false);
  const statsRequestRef = useRef(0);

  // Receipt data is intentionally separate from transcript rows. It is derived
  // from the typed receipt command and can be discarded whenever this page closes.
  const receiptRequestsRef = useRef(new Set<number>());

  // Only the newest request may write results, so a slow page for an abandoned
  // query never overwrites the query the user is actually looking at.
  const requestRef = useRef(0);
  const activeQueryRef = useRef(activeQuery);
  const entriesRef = useRef(state.entries);
  const completedAudioImportIdsRef = useRef(new Set<number>());


  // All-time stats follow the same discipline as the trend: only the newest
  // request may write, an error clears stale data, and late responses are
  // ignored so a slow read never overwrites a fresh one.
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

  useEffect(() => {
    let active = true;
    void commands
      .listAudioImportJobs()
      .then((jobs) => {
        if (active) setAudioImportJobs(jobs);
      })
      .catch(() => {
        if (active) setAudioImportError("load");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    activeQueryRef.current = activeQuery;
  }, [activeQuery]);

  useEffect(() => {
    entriesRef.current = state.entries;
  }, [state.entries]);

  // Receipts follow the visible page: rows that left the list drop their cache
  // and request marks, then the rows that arrived are fetched. The resolved
  // receipts are deliberately not an input — `receiptRequestsRef` already
  // records what was asked for, so this runs once per page, not once per batch
  // it resolves.
  useEffect(() => {
    let cancelled = false;
    const visibleIds = new Set(state.entries.map((entry) => entry.id));

    for (const requestedId of receiptRequestsRef.current) {
      if (!visibleIds.has(requestedId)) {
        receiptRequestsRef.current.delete(requestedId);
      }
    }
    setReceiptsByHistoryId((current) => {
      const kept = Object.entries(current).filter(([historyId]) =>
        visibleIds.has(Number(historyId)),
      );
      return kept.length === Object.keys(current).length
        ? current
        : Object.fromEntries(kept);
    });

    const missingIds: number[] = [];
    for (const entry of state.entries) {
      if (!receiptRequestsRef.current.has(entry.id)) missingIds.push(entry.id);
    }
    if (missingIds.length === 0) return;

    for (const id of missingIds) receiptRequestsRef.current.add(id);

    void loadRunReceipts(missingIds).then((loaded) => {
      if (cancelled) return;
      setReceiptsByHistoryId((current) => ({
        ...current,
        ...Object.fromEntries(loaded),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [state.entries]);

  const fetchPage = useCallback(
    async (searchQuery: string, cursor: number | null) => {
      const append = cursor !== null;
      if (append && pagingRef.current) return;

      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      pagingRef.current = true;
      dispatch({ type: append ? "next-page-request" : "first-page-request" });

      const trimmed = searchQuery.trim();
      try {
        const result = trimmed
          ? await commands.searchHistoryEntries(trimmed, cursor, PAGE_SIZE)
          : await commands.getHistoryEntries(cursor, PAGE_SIZE);
        if (requestRef.current !== requestId) return;
        if (result.status === "ok") {
          dispatch({
            type: "page",
            entries: result.data.entries,
            hasMore: result.data.has_more,
            append,
          });
        } else {
          dispatch({ type: "failed", append });
        }
      } catch (error) {
        if (requestRef.current !== requestId) return;
        // Only a transport failure lands here; the backend never saw it.
        console.error("Failed to load history page:", error);
        dispatch({ type: "failed", append });
      } finally {
        if (requestRef.current === requestId) pagingRef.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const subscription = subscribeToAudioImportUpdates((job) => {
      if (!active) return;
      setAudioImportJobs((current) => upsertAudioImportJob(current, job));
      if (
        job.status === "done" &&
        !completedAudioImportIdsRef.current.has(job.id)
      ) {
        completedAudioImportIdsRef.current.add(job.id);
        void fetchPage(activeQueryRef.current, null);
        void refreshHistoryStats();
      }
    });

    return () => {
      active = false;
      void subscription.then(
        (unlisten) => unlisten(),
        () => undefined,
      );
    };
  }, [fetchPage, refreshHistoryStats]);

  useEffect(() => {
    if (query === activeQuery) return;
    const timer = window.setTimeout(
      () => setActiveQuery(query),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [query, activeQuery]);

  useEffect(() => {
    void fetchPage(activeQuery, null);
  }, [activeQuery, fetchPage]);

  useEffect(() => {
    if (state.phase !== "ready" || !state.hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (observed) => {
        if (!observed[0]?.isIntersecting) return;
        const last = entriesRef.current[entriesRef.current.length - 1];
        if (last) void fetchPage(activeQueryRef.current, last.id);
      },
      { threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [state.phase, state.hasMore, fetchPage]);

  // The transcription pipeline owns history writes; this effect only mirrors
  // its typed events into the currently visible page.
  useEffect(() => {
    const subscription = subscribeToHistoryUpdates(
      activeQueryRef,
      dispatch,
      () => {
        void refreshHistoryStats();
      },
    );
    return () => {
      void subscription.then(
        (unlisten) => unlisten(),
        (error) => console.error("History event subscription failed:", error),
      );
    };
  }, [refreshHistoryStats]);

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

  const startAudioImport = async () => {
    if (startingAudioImport) return;
    setStartingAudioImport(true);
    setAudioImportError(null);
    try {
      const selectedPath = await open({
        directory: false,
        multiple: false,
        filters: [
          {
            name: t("settings.history.audioImport.fileFilter"),
            extensions: MEDIA_IMPORT_EXTENSIONS,
          },
        ],
      });
      if (selectedPath === null || Array.isArray(selectedPath)) return;

      const result = await commands.importAudioFile(selectedPath);
      if (result.status === "error") {
        setAudioImportError("start");
        return;
      }
      setAudioImportJobs((current) =>
        upsertAudioImportJob(current, result.data),
      );
    } catch {
      setAudioImportError("start");
    } finally {
      setStartingAudioImport(false);
    }
  };

  const cancelAudioImport = async (job: AudioImportJob) => {
    if (
      job.cancel_requested ||
      (job.status !== "queued" &&
        job.status !== "decoding" &&
        job.status !== "transcribing")
    ) {
      return;
    }
    setAudioImportError(null);
    try {
      const result = await commands.cancelAudioImport(job.id);
      if (result.status === "error") {
        setAudioImportError("cancel");
        return;
      }
      setAudioImportJobs((current) =>
        upsertAudioImportJob(current, result.data),
      );
    } catch {
      setAudioImportError("cancel");
    }
  };

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

interface HistoryStatsSectionProps {
  stats: HistoryStats | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

const HistoryStatsSection: React.FC<HistoryStatsSectionProps> = ({
  stats,
  loading,
  error,
  onRetry,
}) => {
  const { t } = useTranslation();
  return (
    <section className="history-stats" aria-labelledby="history-stats-title">
      <div className="section-heading-inline">
        <div>
          <h2 id="history-stats-title">{t("settings.history.stats.title")}</h2>
        </div>
      </div>
      {error ? (
        <div className="inline-error" role="alert">
          <span>{t("settings.history.stats.unavailable")}</span>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {t("settings.history.retry")}
          </Button>
        </div>
      ) : loading && stats === null ? (
        <div className="data-status-row" role="status">
          {t("settings.history.stats.loading")}
        </div>
      ) : stats ? (
        <div className="history-stats-grid">
          <dl className="history-stats-values">
            <div>
              <dt>{t("settings.history.stats.entries")}</dt>
              <dd>{NUMBER_FORMATTER.format(stats.entries)}</dd>
            </div>
            <div>
              <dt>{t("settings.history.stats.duration")}</dt>
              <dd>
                {t("settings.history.stats.durationValue", {
                  hours: Math.floor(stats.total_duration_ms / 3_600_000),
                  minutes: Math.round(
                    (stats.total_duration_ms % 3_600_000) / 60_000,
                  ),
                })}
              </dd>
            </div>
            <div>
              <dt>{t("settings.history.stats.words")}</dt>
              <dd>{NUMBER_FORMATTER.format(stats.total_words)}</dd>
            </div>
          </dl>
          {stats.entries > 0 ? (
            <ul className="history-stats-sources">
              {stats.by_source.map((source) => (
                <li key={source.source_kind ?? "legacy"}>
                  <span>
                    {t(
                      `settings.history.stats.source.${source.source_kind ?? "legacy"}`,
                    )}
                  </span>
                  <strong>{NUMBER_FORMATTER.format(source.entries)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="compact-empty-row">{t("settings.history.empty")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
};

interface HistoryAudioImportSectionProps {
  jobs: AudioImportJob[];
  error: "start" | "cancel" | "load" | null;
  onCancel: (job: AudioImportJob) => void;
}

const HistoryAudioImportSection: React.FC<HistoryAudioImportSectionProps> = ({
  jobs,
  error,
  onCancel,
}) => {
  const { t } = useTranslation();
  return (
    <>
      {error && (
        <p role="alert" className="px-4 text-sm text-danger">
          {t(`settings.history.audioImport.errors.${error}`)}
        </p>
      )}
      {jobs.length > 0 && (
        <section
          aria-labelledby="audio-import-jobs-title"
          className="border-y border-border bg-surface"
        >
          <div className="px-4 py-2">
            <h3
              id="audio-import-jobs-title"
              className="text-xs font-medium tracking-wide text-text-secondary uppercase"
            >
              {t("settings.history.audioImport.jobs")}
            </h3>
          </div>
          <ol className="divide-y divide-border">
            {jobs.map((job) => {
              const canCancel =
                !job.cancel_requested &&
                (job.status === "queued" ||
                  job.status === "decoding" ||
                  job.status === "transcribing");
              const failure =
                job.result?.kind === "failed" ? job.result.code : null;
              return (
                <li
                  key={job.id}
                  className="flex flex-wrap items-start justify-between gap-2 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {job.file_name}
                    </p>
                    <p
                      role={failure ? "alert" : "status"}
                      className={
                        failure
                          ? "mt-1 text-xs text-danger"
                          : "mt-1 text-xs text-text-secondary"
                      }
                    >
                      {failure
                        ? t(`settings.history.audioImport.failure.${failure}`)
                        : job.cancel_requested
                          ? t("settings.history.audioImport.status.cancelling")
                          : t(`settings.history.audioImport.status.${job.status}`)}
                    </p>
                    {job.status === "decoding" && (
                      <p className="mt-1 text-xs text-text-tertiary">
                        {t("settings.history.audioImport.decodedSamples", {
                          count: job.decoded_samples,
                        })}
                      </p>
                    )}
                  </div>
                  {canCancel && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onCancel(job)}
                    >
                      {t("settings.history.audioImport.cancel")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </>
  );
};

interface HistoryListSectionProps {
  state: ListState;
  query: string;
  setQuery: (query: string) => void;
  view: HistoryTextView;
  setView: (view: HistoryTextView) => void;
  activeQuery: string;
  sentinelRef: React.RefObject<HTMLDivElement>;
  receiptsByHistoryId: Record<number, HistoryRunReceipt[] | null>;
  toggleSaved: (id: number) => Promise<void>;
  copyToClipboard: (text: string) => Promise<void>;
  getAudioBlob: (historyId: number) => Promise<Blob | null>;
  deleteEntry: (id: number) => Promise<void>;
  retryHistoryEntry: (id: number) => Promise<void>;
  fetchPage: (query: string, cursor: number | null) => Promise<void>;
}

const HistoryListSection: React.FC<HistoryListSectionProps> = ({
  state,
  query,
  setQuery,
  view,
  setView,
  activeQuery,
  sentinelRef,
  receiptsByHistoryId,
  toggleSaved,
  copyToClipboard,
  getAudioBlob,
  deleteEntry,
  retryHistoryEntry,
  fetchPage,
}) => {
  const { t } = useTranslation();
  const trimmedActiveQuery = activeQuery.trim();
  let content: React.ReactNode;

  if (state.phase === "loading") {
    content = (
      <div
        role="status"
        className="px-4 py-3 text-center text-sm text-text-secondary"
      >
        {t("settings.history.loading")}
      </div>
    );
  } else if (state.phase === "error") {
    content = (
      <div
        role="alert"
        className="flex flex-col items-center gap-2 px-4 py-3 text-center"
      >
        <p className="text-sm text-text-primary">
          {t("settings.history.loadError")}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void fetchPage(activeQuery, null)}
        >
          {t("settings.history.retry")}
        </Button>
      </div>
    );
  } else if (state.entries.length === 0) {
    content = (
      <div
        role="status"
        className="px-4 py-3 text-center text-sm text-text-secondary"
      >
        {trimmedActiveQuery === ""
          ? t("settings.history.empty")
          : t("settings.history.noResults", { query: trimmedActiveQuery })}
      </div>
    );
  } else {
    content = (
      <>
        <AudioPlayerGroup>
          <div className="divide-y divide-border">
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
          </div>
        </AudioPlayerGroup>
        <div ref={sentinelRef} className="h-1" />
        {state.phase === "paging" && (
          <div
            role="status"
            className="px-4 py-2 text-center text-xs text-text-tertiary"
          >
            {t("settings.history.loading")}
          </div>
        )}
        {state.phase === "paging-error" && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-center gap-2 border-t border-border px-4 py-3 text-center"
          >
            <span className="text-xs text-text-secondary">
              {t("settings.history.loadError")}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const last = state.entries[state.entries.length - 1];
                if (last) void fetchPage(activeQuery, last.id);
              }}
            >
              {t("settings.history.retry")}
            </Button>
          </div>
        )}
      </>
    );
  }


  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4">
        <div className="relative min-w-40 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
          />
          <Input
            type="search"
            variant="compact"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.history.searchPlaceholder")}
            aria-label={t("settings.history.search")}
            className="w-full ps-8"
          />
        </div>

        <fieldset className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
          <legend className="sr-only">
            {t("settings.history.textView.label")}
          </legend>
          {TEXT_VIEWS.map((option) => (
            <label key={option.value} className="cursor-pointer">
              <input
                type="radio"
                name="history-text-view"
                value={option.value}
                checked={view === option.value}
                onChange={() => setView(option.value)}
                className="peer sr-only"
              />
              <span className="flex min-h-7 items-center rounded-[5px] px-2.5 text-xs font-medium text-text-secondary transition-colors peer-checked:bg-subtle peer-checked:text-text-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-strong">
                {t(option.labelKey)}
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="rounded-lg border border-border bg-canvas">
        {content}
      </div>
    </>
  );
};

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
    <div className="settings-page history-page density-page space-y-4">
      <header className="settings-page-header flex flex-wrap items-end justify-between gap-3">
        <h1 className="settings-page-title">{t("settings.history.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => void startAudioImport()}
            disabled={startingAudioImport}
          >
            <FileAudio aria-hidden="true" className="h-4 w-4" />
            {t("settings.history.audioImport.start")}
          </Button>
          <OpenRecordingsButton
            onClick={() => void openRecordingsFolder()}
            label={t("settings.history.openFolder")}
          />
        </div>
      </header>
      <div className="space-y-2">
        <CloudSyncPanel />
        <HistoryStatsSection
          stats={historyStats}
          loading={statsLoading}
          error={statsError}
          onRetry={() => void refreshHistoryStats()}
        />
        <HistoryAudioImportSection
          jobs={audioImportJobs}
          error={audioImportError}
          onCancel={cancelAudioImport}
        />
        <HistoryListSection
          state={state}
          query={query}
          setQuery={setQuery}
          view={view}
          setView={setView}
          activeQuery={activeQuery}
          sentinelRef={sentinelRef}
          receiptsByHistoryId={receiptsByHistoryId}
          toggleSaved={toggleSaved}
          copyToClipboard={copyToClipboard}
          getAudioBlob={getAudioBlob}
          deleteEntry={deleteEntry}
          retryHistoryEntry={retryHistoryEntry}
          fetchPage={fetchPage}
        />
      </div>
    </div>
  );
};
