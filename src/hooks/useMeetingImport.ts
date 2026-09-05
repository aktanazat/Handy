import { useCallback } from "react";
import {
  commands,
  type MeetingCommandError,
  type MeetingSessionSnapshot,
  type Result,
} from "@/bindings";
import { useImportDialogStore } from "@/components/import/importDialogStore";
import { importFileExtension } from "@/components/import/importQueue";
import { MEDIA_IMPORT_EXTENSIONS } from "./useAudioImport";

/* A transcript export is read as-is; everything else is decoded and
 * transcribed, so a meeting accepts every recording dictation does plus these.
 * One list, because the picker filter, the drop filter and the routing below
 * are its only readers and two copies of either is how a format becomes
 * choosable from the picker and refused by the backend. */
export const MEETING_TRANSCRIPT_EXTENSIONS = ["txt", "srt", "json", "md"];
export const MEETING_IMPORT_EXTENSIONS = [
  ...MEDIA_IMPORT_EXTENSIONS,
  ...MEETING_TRANSCRIPT_EXTENSIONS,
];

/** Hand one file to the owner that matches it. */
export const importMeetingPath = async (
  path: string,
): Promise<Result<MeetingSessionSnapshot, MeetingCommandError>> =>
  MEETING_TRANSCRIPT_EXTENSIONS.includes(importFileExtension(path))
    ? commands.meetingImportTranscript(path)
    : commands.meetingImportRecording({
        path,
        title: null,
        recorded_at_utc_ms: null,
        origin: { kind: "local_file" },
      });

export interface MeetingImportOptions {
  /** The imported meeting, to show once it exists. */
  onImported: (sessionId: string) => void;
}

export interface MeetingImport {
  start: () => void;
  importing: boolean;
}

/**
 * Offer to import recordings or transcript exports as meetings.
 *
 * Two surfaces offer this one action — the Meetings home and the command
 * palette — so `start` raises the app's one import dialog for both, and the
 * dialog runs `importMeetingPath` per file. `importing` is that dialog being
 * open on a meeting import, which is what both callers wanted the flag for.
 */
export const useMeetingImport = ({
  onImported,
}: MeetingImportOptions): MeetingImport => {
  const openImport = useImportDialogStore((state) => state.openImport);
  const importing = useImportDialogStore(
    (state) => state.open && state.request?.kind === "meeting",
  );

  const start = useCallback(() => {
    openImport({ kind: "meeting", onImported });
  }, [onImported, openImport]);

  return { start, importing };
};
