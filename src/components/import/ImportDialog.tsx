import React, { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Check, FileAudio, FileText, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { commands, type AudioImportJob } from "@/bindings";
import { Button } from "@/components/vg/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import { subscribeToAudioImportUpdates } from "@/components/settings/history/historyEvents";
import { meetingErrorKey } from "@/components/settings/meetings/meetingUtils";
import { MEDIA_IMPORT_EXTENSIONS } from "@/hooks/useAudioImport";
import {
  importMeetingPath,
  MEETING_IMPORT_EXTENSIONS,
  MEETING_TRANSCRIPT_EXTENSIONS,
} from "@/hooks/useMeetingImport";
import { cn } from "@/lib/cn";
import {
  addImportPaths,
  audioJobRowState,
  importFileExtension,
  readyImportPaths,
  setImportRow,
  type ImportRow,
} from "./importQueue";
import { useImportDialogStore, type ImportKind } from "./importDialogStore";

export interface ImportDialogProps {
  kind: ImportKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dictation: the queued job, for a surface that lists imports while they run. */
  onQueued?: (job: AudioImportJob) => void;
  /** Meeting: the imported meeting, to show once it exists. */
  onImported?: (sessionId: string) => void;
  /** Replaces the default failure toast, for a surface that draws its own. */
  onError?: () => void;
}

const EXTENSIONS_BY_KIND = {
  dictation: MEDIA_IMPORT_EXTENSIONS,
  meeting: MEETING_IMPORT_EXTENSIONS,
} satisfies Record<ImportKind, string[]>;

/**
 * Middle truncation without measuring anything: the head shrinks and
 * ellipsizes, the tail never does, so the extension and the digits before it
 * survive at any width. Two spans beat a `ResizeObserver` and a font metric.
 */
const MiddleTruncated: React.FC<{ text: string }> = ({ text }) => {
  const cut = Math.max(text.length - 7, 0);
  return (
    <span className="flex min-w-0 flex-1">
      <span className="truncate">{text.slice(0, cut)}</span>
      <span className="shrink-0">{text.slice(cut)}</span>
    </span>
  );
};

const ImportRowStatus: React.FC<{ row: ImportRow }> = ({ row }) => {
  const { t } = useTranslation();

  if (row.state === "running") {
    return (
      <>
        <Loader2
          aria-hidden="true"
          className="size-4 animate-spin text-gray-800 motion-reduce:animate-none"
        />
        <span className="sr-only">{t("import.fileStatus.running")}</span>
      </>
    );
  }
  if (row.state === "failed" || row.state === "cancelled") {
    return (
      <span
        className={cn(
          "shrink-0 text-[13px] leading-[18px]",
          row.state === "failed" ? "text-red-900" : "text-gray-900",
        )}
      >
        {t(`import.fileStatus.${row.state}`)}
      </span>
    );
  }
  return (
    <>
      <Check
        aria-hidden="true"
        className={cn(
          "size-4",
          row.state === "done" ? "text-gray-1000" : "text-gray-800",
        )}
      />
      <span className="sr-only">{t(`import.fileStatus.${row.state}`)}</span>
    </>
  );
};

/**
 * Bring recordings — or, for a meeting, transcript exports — in from disk.
 *
 * The native picker on its own was the whole import surface: one file, no
 * sight of it after the click, and the only place a person could watch the
 * work was a list on another page. This is that action given a room. Files
 * arrive from the picker or from an OS drag, each one becomes a row, and the
 * rows keep reporting after the button is pressed.
 *
 * Dictation imports are handed over one at a time and then run in the
 * backend's own queue, so the dialog stays open over them and can be closed
 * without stopping anything — Library's import list is the same jobs, still
 * running. A meeting import returns its meeting from the command itself, so
 * the run ends by showing the first one.
 */
export const ImportDialog: React.FC<ImportDialogProps> = ({
  kind,
  open,
  onOpenChange,
  onQueued,
  onImported,
  onError,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  /* The re-entrancy guard has to be readable in the same tick it is written —
   * two clicks inside one frame both see the state from the last render, so
   * the state above is the render signal and this is the lock. */
  const runLock = useRef(false);
  const extensions = EXTENSIONS_BY_KIND[kind];

  const addPaths = useCallback(
    (paths: string[]) => {
      setRows((current) => addImportPaths(current, paths, extensions));
    },
    [extensions],
  );

  const choose = useCallback(async () => {
    const filters =
      kind === "dictation"
        ? [
            {
              name: t("settings.history.audioImport.fileFilter"),
              extensions: MEDIA_IMPORT_EXTENSIONS,
            },
          ]
        : [
            {
              name: t("meetings.import.recordingFilter"),
              extensions: MEDIA_IMPORT_EXTENSIONS,
            },
            {
              name: t("meetings.import.transcriptFilter"),
              extensions: MEETING_TRANSCRIPT_EXTENSIONS,
            },
          ];
    const selected = await openFilePicker({
      directory: false,
      multiple: true,
      filters,
    });
    // A dismissed picker is the person changing their mind, not a failure.
    if (selected === null) return;
    addPaths(Array.isArray(selected) ? selected : [selected]);
  }, [addPaths, kind, t]);

  /* An OS file drop reaches a Tauri window as a webview event, never as a DOM
   * `drop`, so the zone is a listener rather than a drop target. Playwright
   * runs in a plain Chromium with no `metadata` on the Tauri globals and no OS
   * drag source behind it, so `getCurrentWebview()` throws there and there is
   * genuinely nothing to listen to; that is the one thing the catch swallows. */
  useEffect(() => {
    if (!open) return;
    let active = true;
    let unlisten: UnlistenFn | undefined;

    const subscribe = async () => {
      try {
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (!active) return;
          if (event.payload.type === "drop") {
            setDragging(false);
            addPaths(event.payload.paths);
            return;
          }
          setDragging(event.payload.type !== "leave");
        });
      } catch {
        // No webview behind this document: no drag source to listen to.
      }
      if (!active) unlisten?.();
    };
    void subscribe();

    return () => {
      active = false;
      unlisten?.();
    };
  }, [addPaths, open]);

  /* Dictation rows follow the backend's own job stream — the same subscription
   * Library's import list reads, so the two lists never disagree about a job. */
  useEffect(() => {
    if (kind !== "dictation" || !open) return;
    let active = true;
    const subscription = subscribeToAudioImportUpdates((job) => {
      if (!active) return;
      setRows((current) => {
        const row = current.find((candidate) => candidate.jobId === job.id);
        return row === undefined
          ? current
          : setImportRow(current, row.path, audioJobRowState(job));
      });
    });

    return () => {
      active = false;
      void subscription.then(
        (unlisten) => unlisten(),
        () => undefined,
      );
    };
  }, [kind, open]);

  const runImport = useCallback(async () => {
    if (runLock.current) return;
    const paths = readyImportPaths(rows);
    if (paths.length === 0) return;
    runLock.current = true;
    setRunning(true);
    let refused = false;
    let firstSession: string | null = null;

    for (const path of paths) {
      try {
        if (kind === "dictation") {
          const result = await commands.importAudioFile(path);
          if (result.status === "error") {
            refused = true;
            setRows((current) =>
              setImportRow(current, path, {
                state: "failed",
                failure: "settings.history.audioImport.errors.start",
              }),
            );
            continue;
          }
          setRows((current) =>
            setImportRow(current, path, {
              state: "queued",
              jobId: result.data.id,
            }),
          );
          onQueued?.(result.data);
          continue;
        }

        const result = await importMeetingPath(path);
        if (result.status === "error") {
          refused = true;
          setRows((current) =>
            setImportRow(current, path, {
              state: "failed",
              failure: meetingErrorKey(result.error),
            }),
          );
          continue;
        }
        firstSession ??= result.data.session_id;
        setRows((current) => setImportRow(current, path, { state: "done" }));
      } catch {
        refused = true;
        setRows((current) =>
          setImportRow(current, path, { state: "failed", failure: null }),
        );
      }
    }

    runLock.current = false;
    setRunning(false);
    /* One report per run, not one per file: the rows already name which file
     * was refused, and a toast per file is the same news four times. */
    if (refused) {
      const fail =
        onError ??
        (() =>
          toast.error(
            kind === "dictation"
              ? t("settings.history.audioImport.errors.start")
              : t("meetings.errors.operation"),
          ));
      fail();
    }
    /* A meeting is finished the moment its command returns, so the run ends by
     * showing it. A dictation is only queued, and its rows keep reporting. */
    if (firstSession !== null) {
      onOpenChange(false);
      onImported?.(firstSession);
    }
  }, [kind, onError, onImported, onOpenChange, onQueued, rows, t]);

  const pending = readyImportPaths(rows).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`import.title.${kind}`)}</DialogTitle>
        </DialogHeader>

        {/* `data-dragging` is the state, and the wash reads off it rather than
         * off a second conditional class: one source of truth, and a drag the
         * OS owns becomes something a person can see in the DOM. */}
        <div
          data-testid="import-drop-zone"
          data-dragging={dragging}
          className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-card border border-dashed border-gray-alpha-500 bg-surface-raised px-6 text-center transition-colors data-[dragging=true]:border-gray-alpha-600 data-[dragging=true]:bg-hover motion-reduce:transition-none"
        >
          <FileUp aria-hidden="true" className="size-6 text-gray-800" />
          <p className="text-[14px] leading-[21px] text-gray-900 text-balance">
            <Trans
              i18nKey="import.dropZone.prompt"
              components={{
                choose: (
                  <button
                    type="button"
                    onClick={() => void choose()}
                    className="rounded-xs font-medium text-gray-1000 underline underline-offset-2 transition-colors hover:text-accent-strong motion-reduce:transition-none"
                    data-testid="import-choose"
                  />
                ),
              }}
            />
          </p>
        </div>

        {rows.length > 0 && (
          <ul
            className="flex max-h-[180px] flex-col gap-2 overflow-y-auto"
            data-testid="import-rows"
            aria-live="polite"
          >
            {rows.map((row) => {
              /* A row's glyph names how the file will be read, which is the
               * one thing about it a person cannot get from the name: in a
               * meeting import a .srt is taken as-is and a .m4a is
               * transcribed first. 16px, under the 14px name beside it. */
              const Glyph = MEETING_TRANSCRIPT_EXTENSIONS.includes(
                importFileExtension(row.path),
              )
                ? FileText
                : FileAudio;
              return (
                <li
                  key={row.path}
                  tabIndex={0}
                  /* The name is truncated in the middle, so focusing the row is
                   * how a keyboard reader gets the whole path, and a failure's
                   * sentence hangs here rather than pushing the row to two
                   * lines for the one row in ten that fails. */
                  title={
                    row.failure === null
                      ? row.path
                      : `${row.path} — ${t(row.failure)}`
                  }
                  className="flex items-center gap-3 rounded-md bg-surface-sunken px-4 py-3 text-[14px] leading-[21px] text-gray-1000"
                >
                  <Glyph
                    aria-hidden="true"
                    className="size-4 shrink-0 text-gray-800"
                  />
                  <MiddleTruncated text={row.name} />
                  <ImportRowStatus row={row} />
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button
            className="w-full"
            disabled={pending === 0 || running}
            onClick={() => void runImport()}
            data-testid="import-submit"
          >
            {t("import.importFiles", { count: pending })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * The app's one import dialog, mounted in the shell.
 *
 * Every surface that offers an import calls `useAudioImport`/`useMeetingImport`
 * and gets a `start()` that writes to the store this reads. Nothing renders
 * until the first import is asked for; `seq` as the key is what makes each
 * opening a fresh list rather than the last import's leftovers.
 */
export const ImportDialogHost: React.FC = () => {
  const { request, open, seq, closeImport } = useImportDialogStore();
  if (request === null) return null;

  return (
    <ImportDialog
      key={seq}
      kind={request.kind}
      open={open}
      onOpenChange={(next) => {
        if (!next) closeImport();
      }}
      onQueued={request.onQueued}
      onImported={request.onImported}
      onError={request.onError}
    />
  );
};
