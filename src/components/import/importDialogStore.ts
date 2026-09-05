import { create } from "zustand";
import type { AudioImportJob } from "@/bindings";

/** The two things a person can bring in from disk. */
export type ImportKind = "dictation" | "meeting";

/** What the surface that asked for the import wants back from it. */
export interface ImportRequest {
  kind: ImportKind;
  /** Dictation: the queued job, for a surface that lists imports while they run. */
  onQueued?: (job: AudioImportJob) => void;
  /** Meeting: the imported meeting, to show once it exists. */
  onImported?: (sessionId: string) => void;
  /**
   * Replaces the default failure toast. Only for a surface that already draws a
   * failure of its own — Library keeps a row inside its import panel, and one
   * failure reported twice is one report too many.
   */
  onError?: () => void;
}

interface ImportDialogState {
  request: ImportRequest | null;
  open: boolean;
  /** Bumped per opening, so the host can hand the dialog a fresh row list. */
  seq: number;
  openImport: (request: ImportRequest) => void;
  closeImport: () => void;
}

/**
 * Which import the app is currently showing, if any.
 *
 * A modal is a singleton by construction — two of them cannot be on screen at
 * once — and the surfaces that ask for one are spread across the shell: the
 * command palette, Capture's hero, Library's toolbar and empty state, and the
 * Meetings home. Threading a dialog element back out through each of those
 * would mean widening three typed controller contracts to carry a modal that
 * only one of them can show at a time. One store, one mount in the shell, and
 * every surface keeps the `start()` it already calls.
 *
 * `closeImport` leaves `request` in place: the dialog's exit animation still
 * has to render its title on the way out.
 */
export const useImportDialogStore = create<ImportDialogState>((set) => ({
  request: null,
  open: false,
  seq: 0,
  openImport: (request) =>
    set((state) => ({ request, open: true, seq: state.seq + 1 })),
  closeImport: () => set({ open: false }),
}));
