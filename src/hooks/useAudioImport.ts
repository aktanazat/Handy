import { useCallback } from "react";
import type { AudioImportJob } from "@/bindings";
import { useImportDialogStore } from "@/components/import/importDialogStore";

/* Everything the decoder accepts. One list, because the picker filter, the
 * drop filter and the dialog's sentence are the only things that read it and
 * three copies of it is how a format ends up importable from one surface and
 * refused by another. */
export const MEDIA_IMPORT_EXTENSIONS = [
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

export interface AudioImportOptions {
  /** The queued job, for a surface that lists imports while they run. */
  onQueued?: (job: AudioImportJob) => void;
  /**
   * Replaces the default toast. Only for a surface that already draws a failure
   * of its own — Library keeps a row inside its import panel, and one failure
   * reported twice is one report too many.
   */
  onError?: () => void;
}

export interface AudioImport {
  start: () => void;
  importing: boolean;
}

/**
 * Offer to import recordings from disk.
 *
 * Four surfaces offer this one action — the command palette, Capture's hero,
 * Library's toolbar and Library's empty state — and they used to be copies of
 * it that diverged exactly where a user would feel it. What they share is now
 * the whole action: `start` raises the app's one import dialog, which is where
 * files are chosen, dropped, handed to the backend one at a time, and watched.
 *
 * `importing` is that dialog being open on this kind of import, which is what
 * every caller wanted the flag for: it disables the control that opened it.
 * The re-entrancy guard on the command calls themselves lives with the calls,
 * inside the dialog.
 */
export const useAudioImport = ({
  onQueued,
  onError,
}: AudioImportOptions = {}): AudioImport => {
  const openImport = useImportDialogStore((state) => state.openImport);
  const importing = useImportDialogStore(
    (state) => state.open && state.request?.kind === "dictation",
  );

  const start = useCallback(() => {
    openImport({ kind: "dictation", onQueued, onError });
  }, [onError, onQueued, openImport]);

  return { start, importing };
};
