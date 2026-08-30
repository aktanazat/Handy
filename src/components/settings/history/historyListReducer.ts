import type { HistoryEntry } from "@/bindings";

export interface ListState {
  entries: HistoryEntry[];
  hasMore: boolean;
  phase: "loading" | "paging" | "paging-error" | "ready" | "error";
}

// Failures carry no message. The backend logs the cause and the pane shows one
// translated state, so no SQLite text or transport detail reaches the user.
export type ListAction =
  | { type: "first-page-request" }
  | { type: "next-page-request" }
  | { type: "page"; entries: HistoryEntry[]; hasMore: boolean; append: boolean }
  | { type: "failed"; append: boolean }
  | { type: "added"; entry: HistoryEntry }
  | { type: "replaced"; entry: HistoryEntry }
  | { type: "removed"; id: number }
  | { type: "saved-toggled"; id: number };

export const INITIAL_LIST_STATE: ListState = {
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

export const listReducer = (
  state: ListState,
  action: ListAction,
): ListState => {
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
