import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { commands, type AudioImportJob } from "@/bindings";

/* Everything the decoder accepts. One list, because the dialog filter is the
 * only thing that reads it and three copies of it is how a format ends up
 * importable from one surface and refused by another. */
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
  start: () => Promise<void>;
  importing: boolean;
}

/**
 * Import a recording from disk: pick a file, hand it to the backend, say what
 * happened.
 *
 * Three surfaces offer this one action — the command palette, Capture's hero and
 * Library's toolbar — and they used to be three copies of it that diverged
 * exactly where a user would feel it: the palette's had no busy flag and so was
 * double-invocable, Capture's was silent on failure and dropped the job it got
 * back, and only Library's did either properly. The busy flag and the failure
 * report are part of the action, not decoration around it, so they live here.
 */
export const useAudioImport = ({
  onQueued,
  onError,
}: AudioImportOptions = {}): AudioImport => {
  const { t } = useTranslation();
  const [importing, setImporting] = useState(false);
  /* The re-entrancy guard has to be readable in the same tick it is written —
   * two clicks inside one frame both see the state from the last render, so the
   * state below is the render signal and this is the lock. */
  const running = useRef(false);

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setImporting(true);
    const fail =
      onError ??
      (() => toast.error(t("settings.history.audioImport.errors.start")));
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
      // A dismissed dialog is not a failure, and `multiple: false` means an
      // array can only be a plugin contract change.
      if (selectedPath === null || Array.isArray(selectedPath)) return;

      const result = await commands.importAudioFile(selectedPath);
      if (result.status === "error") {
        fail();
        return;
      }
      onQueued?.(result.data);
    } catch {
      fail();
    } finally {
      running.current = false;
      setImporting(false);
    }
  }, [onError, onQueued, t]);

  return { start, importing };
};
