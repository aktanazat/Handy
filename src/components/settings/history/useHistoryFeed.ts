import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { commands } from "@/bindings";
import type { HistoryTextView } from "./HistoryEntry";
import { subscribeToHistoryUpdates } from "./historyEvents";
import { INITIAL_LIST_STATE, listReducer } from "./historyListReducer";

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 200;

/* The feed itself: one page of entries at a time, the search box that filters
 * them, the text view they are read in, and the typed events that keep the
 * visible page true while dictation writes to it. `onMutation` is called for
 * every history write the backend announces, so the totals above the feed can
 * follow it; it must be stable, since the subscription depends on it. */
export const useHistoryFeed = (onMutation: () => void) => {
  const [state, dispatch] = useReducer(listReducer, INITIAL_LIST_STATE);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [view, setView] = useState<HistoryTextView>("processed");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pagingRef = useRef(false);

  // Only the newest request may write results, so a slow page for an abandoned
  // query never overwrites the query the user is actually looking at.
  const requestRef = useRef(0);
  const activeQueryRef = useRef(activeQuery);
  const entriesRef = useRef(state.entries);

  useEffect(() => {
    activeQueryRef.current = activeQuery;
  }, [activeQuery]);

  useEffect(() => {
    entriesRef.current = state.entries;
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

  /* The first page again, under whichever query is on screen. An import that
   * finishes writes a row this page has never seen, and the search it must
   * appear under is the live one, not the one captured when the import
   * started. */
  const reloadFirstPage = useCallback(() => {
    void fetchPage(activeQueryRef.current, null);
  }, [fetchPage]);

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
      onMutation,
    );
    return () => {
      void subscription.then(
        (unlisten) => unlisten(),
        (error) => console.error("History event subscription failed:", error),
      );
    };
  }, [onMutation]);

  return {
    state,
    query,
    setQuery,
    view,
    setView,
    activeQuery,
    sentinelRef,
    fetchPage,
    reloadFirstPage,
  };
};
