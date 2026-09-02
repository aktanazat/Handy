import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { commands } from "@/bindings";
import { meetingErrorKey } from "@/components/settings/meetings/meetingUtils";

/* Everything the meeting importer accepts, split the way the file picker asks
 * for it. A recording is decoded and transcribed; a transcript export is read
 * as-is. One list each, because the picker's filters and the routing below are
 * the only readers and two copies of either is how a format becomes importable
 * from the picker and refused by the backend. */
const RECORDING_EXTENSIONS = [
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
const TRANSCRIPT_EXTENSIONS = ["txt", "srt", "json", "md"];

export interface MeetingImportOptions {
  /** The imported meeting, to show once it exists. */
  onImported: (sessionId: string) => void;
}

export interface MeetingImport {
  start: () => Promise<void>;
  importing: boolean;
}

/**
 * Import a recording or a transcript export as a meeting: pick a file, hand it
 * to the owner that matches it, show the meeting that came back.
 *
 * Two surfaces offer this one action — the Meetings home and the command
 * palette — so the busy flag and the failure report live here rather than being
 * reimplemented, and diverging, at each of them.
 */
export const useMeetingImport = ({
  onImported,
}: MeetingImportOptions): MeetingImport => {
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
    try {
      const selectedPath = await open({
        directory: false,
        multiple: false,
        filters: [
          {
            name: t("meetings.import.recordingFilter"),
            extensions: RECORDING_EXTENSIONS,
          },
          {
            name: t("meetings.import.transcriptFilter"),
            extensions: TRANSCRIPT_EXTENSIONS,
          },
        ],
      });
      // A dismissed dialog is the person changing their mind, not a failure,
      // and `multiple: false` means an array can only be a plugin change.
      if (selectedPath === null || Array.isArray(selectedPath)) return;

      const extension = selectedPath.split(".").pop()?.toLowerCase() ?? "";
      const result = TRANSCRIPT_EXTENSIONS.includes(extension)
        ? await commands.meetingImportTranscript(selectedPath)
        : await commands.meetingImportRecording({
            path: selectedPath,
            title: null,
            recorded_at_utc_ms: null,
            origin: { kind: "local_file" },
          });
      if (result.status === "error") {
        toast.error(t(meetingErrorKey(result.error)));
        return;
      }
      onImported(result.data.session_id);
    } catch {
      toast.error(t("meetings.errors.operation"));
    } finally {
      running.current = false;
      setImporting(false);
    }
  }, [onImported, t]);

  return { start, importing };
};
