import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { HistoryEntry, HistoryRunReceipt } from "@/bindings";
import { emptyTranscriptLine } from "./emptyTranscriptLine";
import { historyRowActions } from "./historyRowActions";
import { HistoryAudioPlayer } from "./HistoryAudioPlayer";
import { HistoryCorrectionDialog } from "./HistoryCorrectionDialog";
import { HistoryReceiptInspector } from "./HistoryReceiptInspector";
import { HistoryRowControls } from "./HistoryRowControls";
import { HistoryRowMeta } from "./HistoryRowMeta";
import { ProcessAgainDialog } from "./ProcessAgainDialog";
import { useHistoryCorrection } from "./useHistoryCorrection";

export type HistoryTextView = "processed" | "raw";

/* The wait before the delete call, in JS. It must equal the CSS collapse below,
 * which reads `--duration-standard` (180ms) — the row does not get to pick its
 * own timing. Under prefers-reduced-motion App.css zeroes every transition
 * globally with `!important`, so the collapse is instant and this is just a
 * short pause. */
const ROW_COLLAPSE_MS = 180;

interface HistoryEntryComponentProps {
  entry: HistoryEntry;
  receipts: HistoryRunReceipt[] | null | undefined;
  view: HistoryTextView;
  onToggleSaved: (id: number) => Promise<void>;
  onCopyText: (text: string) => Promise<void>;
  getAudioBlob: (historyId: number) => Promise<Blob | null>;
  deleteAudio: (id: number) => Promise<void>;
  retryTranscription: (id: number) => Promise<void>;
}

const HistoryEntryRow: React.FC<HistoryEntryComponentProps> = ({
  entry,
  receipts,
  view,
  onToggleSaved,
  onCopyText,
  getAudioBlob,
  deleteAudio,
  retryTranscription,
}) => {
  const { t } = useTranslation();
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [showCopied, setShowCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [processAgainOpen, setProcessAgainOpen] = useState(false);
  const correction = useHistoryCorrection();
  const copiedTimerRef = useRef<number | undefined>(undefined);
  const deleteTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(copiedTimerRef.current);
      window.clearTimeout(deleteTimerRef.current);
    },
    [],
  );

  const processedText = entry.post_processed_text?.trim() ?? "";
  const rawText = entry.transcription_text.trim();
  const shownText =
    view === "processed" && processedText !== "" ? processedText : rawText;
  const hasText = shownText !== "";
  const processedTextMissing =
    view === "processed" &&
    processedText === "" &&
    entry.post_process_requested;

  const latestReceipt =
    receipts?.reduce<HistoryRunReceipt | null>((latest, receipt) => {
      if (!latest || receipt.completed_at_ms > latest.completed_at_ms) {
        return receipt;
      }
      return latest;
    }, null) ?? null;
  const noSpeechCaptured =
    latestReceipt?.capture_status === "no_speech_detected";

  /* A receipt is the only thing that can prove a recording holds audio worth
   * playing, and a no-speech capture retains a sample that is worth hearing —
   * it is how you tell a dead microphone from a quiet room. So the player is
   * suppressed only when a receipt states there is nothing there: no audio, or
   * zero length. Rows written before receipts existed keep it, because taking
   * playback away from them on a guess is the larger error. */
  const playable = latestReceipt
    ? latestReceipt.has_audio && (latestReceipt.duration_ms ?? 0) > 0
    : true;
  const totalSeconds =
    latestReceipt?.duration_ms != null
      ? latestReceipt.duration_ms / 1000
      : undefined;

  const handleCopyText = async () => {
    if (!hasText) return;
    try {
      await onCopyText(shownText);
      setShowCopied(true);
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(
        () => setShowCopied(false),
        2000,
      );
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  // The row collapses to zero height first and only then asks the backend to
  // delete, so the removal event unmounts something that already takes no
  // space. Without the wait the list would jump by a row height. A failed
  // delete puts the row back rather than leaving a ghost.
  const handleDeleteEntry = () => {
    setRemoving(true);
    deleteTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          await deleteAudio(entry.id);
        } catch (error) {
          console.error("Failed to delete entry:", error);
          setRemoving(false);
          toast.error(t("settings.history.deleteError"));
        }
      })();
    }, ROW_COLLAPSE_MS);
  };

  const handleRetranscribe = async () => {
    try {
      setRetrying(true);
      await retryTranscription(entry.id);
    } catch (error) {
      console.error("Failed to re-transcribe:", error);
      toast.error(t("settings.history.retranscribeError"));
    } finally {
      setRetrying(false);
    }
  };

  const busy = retrying || removing;
  /* A no-speech capture has no transcript to truncate, so the row stops at
   * its one metadata line rather than spending a second line on the absence
   * of text. A retry in flight always gets its line, whatever the last run
   * concluded. */
  const showsTranscript = retrying || !noSpeechCaptured;

  const actions = historyRowActions({
    t,
    saved: entry.saved,
    hasText,
    busy,
    onCorrect: () => correction.setOpen(true),
    onToggleSaved: () => void onToggleSaved(entry.id),
    onRetranscribe: () => void handleRetranscribe(),
    onProcessAgain: () => setProcessAgainOpen(true),
    onDelete: handleDeleteEntry,
  });

  return (
    <li
      /* The grid-rows track is what lets a deleted row collapse to nothing
       * before it unmounts, instead of vanishing and yanking everything below
       * it upward. */
      className="grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-[var(--duration-standard)] ease-[var(--ease-out)] data-[removing=true]:pointer-events-none data-[removing=true]:grid-rows-[0fr] data-[removing=true]:opacity-0"
      data-removing={removing ? "true" : undefined}
      data-testid="history-entry"
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <HistoryRowMeta
                entry={entry}
                receipt={latestReceipt}
                noSpeechCaptured={noSpeechCaptured}
                showDuration={!playable}
              />
              {showsTranscript &&
                (retrying ? (
                  <p className="text-sm text-gray-900" role="status">
                    {t("settings.history.transcribing")}
                  </p>
                ) : (
                  <p
                    /* 13px explicitly, not `text-sm`. This app sets
                     * `:root { font-size: 14px }`, so text-sm renders 12.25px —
                     * the legacy SECONDARY tier — and the transcript is the
                     * row's content, not help text. 13px/19px is the row tier
                     * this list has always used. */
                    className="truncate text-[13px] leading-[19px] text-gray-1000 select-text data-[expanded=true]:overflow-visible data-[expanded=true]:break-words data-[expanded=true]:whitespace-pre-wrap data-[state=missing]:text-gray-900 data-[state=missing]:select-none"
                    data-state={hasText ? "text" : "missing"}
                    data-expanded={expanded ? "true" : undefined}
                    data-testid="history-entry-transcript"
                  >
                    {hasText
                      ? shownText
                      : emptyTranscriptLine(t, latestReceipt)}
                  </p>
                ))}
            </div>

            <HistoryRowControls
              actions={actions}
              hasText={hasText}
              busy={busy}
              showCopied={showCopied}
              expanded={expanded}
              detailsId={detailsId}
              onCopy={() => void handleCopyText()}
              onToggleExpanded={() => setExpanded((current) => !current)}
            />
          </div>

          {processedTextMissing && !retrying ? (
            <p className="text-sm text-gray-900">
              {t("settings.history.postProcessEmpty")}
            </p>
          ) : null}

          {playable ? (
            <HistoryAudioPlayer
              historyId={entry.id}
              totalSeconds={totalSeconds}
              getAudioBlob={getAudioBlob}
            />
          ) : null}

          {expanded ? (
            <HistoryReceiptInspector
              id={detailsId}
              receipts={receipts}
              parentId={entry.parent_id}
            />
          ) : null}

          <HistoryCorrectionDialog
            open={correction.open}
            onOpenChange={correction.setOpen}
            spoken={correction.spoken}
            written={correction.written}
            scope={correction.scope}
            saving={correction.saving}
            ready={correction.ready}
            onSpokenChange={correction.setSpoken}
            onWrittenChange={correction.setWritten}
            onScopeChange={correction.setScope}
            onSave={() => void correction.save()}
          />
          <ProcessAgainDialog
            historyId={entry.id}
            open={processAgainOpen}
            onOpenChange={setProcessAgainOpen}
          />
        </div>
      </div>
    </li>
  );
};

/* The row is the list's unit of cost, and its props are all identity-stable
 * while the row's own data is unchanged: `entry` objects come straight out of
 * the list reducer (which rebuilds only the entry it mutates), `receipts` is one
 * value out of the receipt record, `view` is a string, and every callback the
 * owner passes is wrapped in `useCallback`. Without this boundary one keystroke
 * in the Library search box re-rendered the whole page of rows, because the
 * search field's state lives in the component that owns the list. Every child
 * below is a plain component, so this one memo covers the row's whole subtree. */
export const HistoryEntryComponent = React.memo(HistoryEntryRow);
