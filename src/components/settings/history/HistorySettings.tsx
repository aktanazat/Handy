import React, {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileAudio, FolderOpen, Search, X } from "lucide-react";
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
import { AudioPlayerGroup } from "../../ui";
import {
  Microlabel,
  SETTINGS_CARD,
  SETTINGS_SURFACE,
  SettingsCard,
  SettingsPage,
} from "../rows";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import { Skeleton } from "@/components/vg/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/vg/tabs";
import { useAudioImport } from "@/hooks/useAudioImport";
import { formatDurationShort } from "@/lib/utils/format";
import { cn } from "@/lib/cn";
import { HistoryEntryComponent, type HistoryTextView } from "./HistoryEntry";

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 200;
const SKELETON_ROWS = [0, 1, 2, 3, 4];
const NUMBER_FORMATTER = new Intl.NumberFormat();
const TEXT_VIEWS = [
  { value: "processed", labelKey: "settings.history.textView.processed" },
  { value: "raw", labelKey: "settings.history.textView.raw" },
] as const satisfies ReadonlyArray<{
  value: HistoryTextView;
  labelKey: string;
}>;

// A job is still cancellable while it is in one of these states.
const IMPORT_RUNNING = {
  queued: true,
  decoding: true,
  transcribing: true,
} satisfies Partial<Record<AudioImportJob["status"], true>>;

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

const useHistoryData = () => {
  const { t } = useTranslation();
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
  /* Library is the surface that lists imports while they run and keeps its own
   * failure row inside the import panel, so it hands the shared action both:
   * the job to register, and somewhere to put the error other than a toast. */
  const { start: runAudioImport, importing: startingAudioImport } =
    useAudioImport({
      onQueued: (job) =>
        setAudioImportJobs((current) => upsertAudioImportJob(current, job)),
      onError: () => setAudioImportError("start"),
    });
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

  // All-time stats follow the same discipline as the list: only the newest
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

  const startAudioImport = () => {
    // A fresh attempt clears the last one's failure. The hook owns the rest.
    setAudioImportError(null);
    void runAudioImport();
  };

  const cancelAudioImport = async (job: AudioImportJob) => {
    if (job.cancel_requested || !(job.status in IMPORT_RUNNING)) {
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

interface HistorySummaryProps {
  stats: HistoryStats | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

/* The three base totals every library reports, in card order. The loading
 * state renders these same labels over skeleton figures — the labels are
 * known before the numbers are, and a zero the backend never reported would
 * be a lie. */
const SUMMARY_KEYS = ["entries", "duration", "words"] as const;

/* All-time usage: exactly three flat cards, mono microlabel over a tabular
 * figure. No sublabel under any figure — "5 all time" under "5" states the
 * same number twice — and no per-source split: provenance is a property of a
 * recording, and the row that owns it states it on its receipt.
 *
 * Exported because the band is the page's one derived readout and the whole
 * page cannot be rendered without its data effects. */
export const HistorySummary: React.FC<HistorySummaryProps> = ({
  stats,
  loading,
  error,
  onRetry,
}) => {
  const { t } = useTranslation();

  if (error) {
    return (
      <div className="flex min-h-5 flex-wrap items-center gap-3">
        <p className="text-sm text-red-900">
          {t("settings.history.stats.unavailable")}
        </p>
        {/* Bordered, not a text ghost: this line has no banner surface of its
         * own, so a ghost label would read as the tail of the sentence beside
         * it rather than as the control that refills the band. */}
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("settings.history.retry")}
        </Button>
      </div>
    );
  }

  if (stats === null) {
    if (!loading) {
      return (
        <div className="flex min-h-5 flex-wrap items-center gap-3">
          <p className="text-sm text-gray-900">
            {t("settings.history.stats.unavailable")}
          </p>
        </div>
      );
    }
    return (
      <dl
        className="grid grid-cols-3 gap-3"
        data-testid="history-summary-loading"
      >
        {SUMMARY_KEYS.map((key) => (
          <div
            className={cn(
              SETTINGS_CARD,
              "flex min-w-0 flex-col gap-1.5 px-4 py-3",
            )}
            key={key}
            data-testid="history-stat"
          >
            <dt>
              <Microlabel>{t(`settings.history.stats.${key}`)}</Microlabel>
            </dt>
            <dd className="m-0">
              <Skeleton className="h-8 w-16" />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  const totals = [
    {
      key: "entries",
      label: t("settings.history.stats.entries"),
      value: NUMBER_FORMATTER.format(stats.entries),
    },
    {
      key: "duration",
      label: t("settings.history.stats.duration"),
      value: formatDurationShort(stats.total_duration_ms / 1000),
    },
    {
      key: "words",
      label: t("settings.history.stats.words"),
      value: NUMBER_FORMATTER.format(stats.total_words),
    },
  ];

  return (
    <dl className="grid grid-cols-3 gap-3" data-testid="history-summary">
      {totals.map((total) => (
        <div
          className={cn(
            SETTINGS_CARD,
            "flex min-w-0 flex-col gap-1.5 px-4 py-3",
          )}
          key={total.key}
          data-testid="history-stat"
        >
          <dt>
            <Microlabel>{total.label}</Microlabel>
          </dt>
          <dd className="m-0 text-2xl text-gray-1000 tabular-nums">
            {total.value}
          </dd>
        </div>
      ))}
    </dl>
  );
};

/* The one sentence a screen reader hears while a file import runs. Always
 * mounted, so a status transition is never lost to the region appearing at
 * the same moment as its first message. Empty it takes no space. */
const HistoryImportLive: React.FC<{ jobs: AudioImportJob[] }> = ({ jobs }) => {
  const { t } = useTranslation();
  const running = jobs.filter(
    (job) => !job.cancel_requested && job.status in IMPORT_RUNNING,
  );
  const first = running[0];

  let message = "";
  if (running.length > 1) {
    message = t(
      "settings.history.audioImport.running",
      "Transcribing {{count}} files",
      { count: running.length },
    );
  } else if (first) {
    message = `${first.file_name} · ${t(`settings.history.audioImport.status.${first.status}`)}`;
  }

  return (
    <p
      className="text-xs break-words text-gray-900 empty:hidden"
      aria-live="polite"
      data-testid="history-import-live"
    >
      {message}
    </p>
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

  if (jobs.length === 0 && error === null) return null;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p
          role="alert"
          className={cn(SETTINGS_CARD, "px-4 py-3 text-sm text-red-900")}
        >
          {t(`settings.history.audioImport.errors.${error}`)}
        </p>
      )}

      {jobs.length > 0 && (
        <section
          aria-labelledby="audio-import-jobs-title"
          data-testid="history-imports"
          className="flex flex-col gap-2"
        >
          <h2 id="audio-import-jobs-title">
            <Microlabel>{t("settings.history.audioImport.jobs")}</Microlabel>
          </h2>
          <ol className={SETTINGS_SURFACE}>
            {jobs.map((job) => {
              const canCancel =
                !job.cancel_requested && job.status in IMPORT_RUNNING;
              const failure =
                job.result?.kind === "failed" ? job.result.code : null;
              return (
                <li
                  key={job.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-[13px] leading-[19px] text-gray-1000"
                      title={job.file_name}
                    >
                      {job.file_name}
                    </p>
                    <p
                      className={`mt-0.5 text-sm ${failure ? "text-red-900" : "text-gray-900"}`}
                      role={failure ? "alert" : undefined}
                    >
                      {failure
                        ? t(`settings.history.audioImport.failure.${failure}`)
                        : job.cancel_requested
                          ? t("settings.history.audioImport.status.cancelling")
                          : t(
                              `settings.history.audioImport.status.${job.status}`,
                            )}
                    </p>
                    {job.status === "decoding" && (
                      <p className="mt-0.5 font-mono text-[11px] text-gray-800 tabular-nums">
                        {t("settings.history.audioImport.decodedSamples", {
                          count: job.decoded_samples,
                        })}
                      </p>
                    )}
                  </div>
                  {canCancel && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onCancel(job)}
                      data-testid="history-import-cancel"
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
    </div>
  );
};

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

interface HistoryListSectionProps {
  state: ListState;
  query: string;
  setQuery: (query: string) => void;
  view: HistoryTextView;
  setView: (view: HistoryTextView) => void;
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
  onOpenFolder: () => void;
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
  startingAudioImport,
  toggleSaved,
  copyToClipboard,
  getAudioBlob,
  deleteEntry,
  retryHistoryEntry,
  fetchPage,
  onStartAudioImport,
  onOpenFolder,
}) => {
  const { t } = useTranslation();
  const countId = useId();
  const trimmedActiveQuery = activeQuery.trim();
  const searching = trimmedActiveQuery !== "";
  const settled = state.phase !== "loading" && state.phase !== "error";
  const count = state.entries.length;

  const loadNextPage = () => {
    const last = state.entries[state.entries.length - 1];
    if (last) void fetchPage(activeQuery, last.id);
  };

  // Only the search result count is announced. A running total that changes
  // on every scroll tick would turn the live region into noise.
  let resultCount = "";
  if (searching && settled) {
    if (count === 0) {
      resultCount = t("settings.history.resultsNone", "No matches");
    } else if (state.hasMore) {
      resultCount = t("settings.history.resultsMore", "{{count}}+ matches", {
        count,
      });
    } else {
      resultCount = t("settings.history.results", "{{count}} matches", {
        count,
      });
    }
  }

  let content: React.ReactNode;

  if (state.phase === "loading") {
    content = (
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
  } else if (state.phase === "error") {
    /* The feed is the page. When it cannot be read there is nothing else to
     * put a bar above, so the region says why it is empty and carries the
     * one action that refills it. */
    content = (
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
  } else if (count === 0) {
    content = searching ? (
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
  } else {
    const showFooter =
      state.hasMore ||
      state.phase === "paging" ||
      state.phase === "paging-error";
    content = (
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
  }

  return (
    <div className="flex flex-col gap-3">
      {/* One honest wrap row: the search field grows, everything after it is
       * flex-none in DOM order — count, view switch, folder button — so at
       * width the controls sit on one line and under it they wrap whole, last
       * first. Nothing is absolutely positioned; nothing can overlap. */}
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="history-toolbar"
      >
        <div className="relative min-w-[200px] flex-[1_1_240px]">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-gray-800"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.history.searchPlaceholder")}
            aria-label={t("settings.history.search")}
            aria-describedby={countId}
            data-testid="history-search"
            className="h-8 pl-8"
          />
          {query === "" ? null : (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-1 size-6 -translate-y-1/2 text-gray-800 hover:text-gray-1000"
              aria-label={t("settings.history.clearSearch", "Clear search")}
              onClick={() => setQuery("")}
              data-testid="history-search-clear"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          )}
        </div>

        <p
          id={countId}
          className="flex-none font-mono text-[11px] text-gray-800 tabular-nums"
          aria-live="polite"
          data-testid="history-result-count"
        >
          {resultCount}
        </p>

        <Tabs
          value={view}
          onValueChange={(value) =>
            setView(value === "raw" ? "raw" : "processed")
          }
          className="flex-none"
        >
          <TabsList aria-label={t("settings.history.textView.label")}>
            {TEXT_VIEWS.map((option) => (
              <TabsTrigger key={option.value} value={option.value}>
                {t(option.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenFolder}
          data-testid="history-open-folder"
        >
          <FolderOpen aria-hidden="true" className="size-4" />
          {t("settings.history.openFolder")}
        </Button>
      </div>

      {content}
    </div>
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

      <HistoryListSection
        state={state}
        query={query}
        setQuery={setQuery}
        view={view}
        setView={setView}
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
        onOpenFolder={() => void openRecordingsFolder()}
      />
    </SettingsPage>
  );
};
