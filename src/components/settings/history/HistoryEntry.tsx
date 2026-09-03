import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { HistoryEntry, HistoryRunReceipt } from "@/bindings";
import { formatTimeOfDay } from "@/lib/utils/localDay";
import { emptyTranscriptLine } from "./emptyTranscriptLine";
import { historyRowActions } from "./historyRowActions";
import { HistoryAudioPlayer } from "./HistoryAudioPlayer";
import { HistoryCorrectionDialog } from "./HistoryCorrectionDialog";
import { HistoryReceiptInspector } from "./HistoryReceiptInspector";
import { HistoryRowControls } from "./HistoryRowControls";
import { ProcessAgainDialog } from "./ProcessAgainDialog";
import { useHistoryCorrection } from "./useHistoryCorrection";

export type HistoryTextView = "processed" | "raw";

/* The wait before the delete call, in JS. It must equal the CSS collapse below,
 * which reads `--duration-standard` (180ms) — the row does not get to pick its
 * own timing. Under prefers-reduced-motion App.css zeroes every transition
 * globally with `!important`, so the collapse is instant and this is just a
 * short pause. */
const ROW_COLLAPSE_MS = 180;

/* The whole collapsed row is the disclosure. Nothing else in it is clickable,
 * which is the point: a quiet log shows text, a count and a time, and grows the
 * controls only for the one row you asked about. */
const ROW_BUTTON =
  "flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none";

/* The row's two measured cells. `snap-measured` because a count and a clock
 * time are measurements: tweening either displays a value nothing reported. */
const ROW_MEASURE =
  "snap-measured flex-none text-[11px] tabular-nums text-gray-800";

interface HistoryEntryComponentProps {
  entry: HistoryEntry;
  receipts: HistoryRunReceipt[] | null | undefined;
  view: HistoryTextView;
  /**
   * Whether this row is the open one. The list owns it rather than the row:
   * exactly one recording is open at a time, because the window is a fixed
   * 900×680 and thirty rows each holding a player, an action bar and a receipt
   * table is not a log any more. It is the same grain `AudioPlayerGroup`
   * already enforces one level down — one thing playing, one thing open.
   */
  expanded: boolean;
  onToggleExpanded: (id: number) => void;
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
  expanded,
  onToggleExpanded,
  onToggleSaved,
  onCopyText,
  getAudioBlob,
  deleteAudio,
  retryTranscription,
}) => {
  const { t } = useTranslation();
  const detailsId = useId();
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

  /* The one line the collapsed row states, and the tier it reads at. Four
   * cases, in priority order: a retry in flight owns the line whatever the
   * last run concluded; a capture with no speech in it says so, because there
   * is no transcript to show the first words of; text is the text; and no text
   * names why there is none.
   *
   * Only the third case is the row's own content and reads at full contrast.
   * The other three are the app talking ABOUT the row, so they step back a
   * tier — and the tone is decided here, in the same branch that picks the
   * words, because a no-speech row usually has a transcript on it from the run
   * before the retry, and asking `hasText` separately would dress the app's
   * sentence up as that transcript.
   *
   * A two-line clamp keeps a complete-enough excerpt on the row. Expanded, the
   * same node wraps and shows the whole transcript — one text node, so the row
   * never prints its opening words twice. */
  let line: string;
  let lineTone: "text" | "stated" = "stated";
  if (retrying) {
    line = t("settings.history.transcribing");
  } else if (noSpeechCaptured) {
    line = t("errors.noSpeechDetectedTitle");
  } else if (hasText) {
    line = shownText;
    lineTone = "text";
  } else {
    line = emptyTranscriptLine(t, latestReceipt);
  }

  /* A capture with no speech in it is not credited with a word count, and a
   * row whose receipt has not arrived yet states no count rather than guessing
   * one from the text it happens to be showing. */
  const wordCount =
    !noSpeechCaptured && latestReceipt?.word_count != null
      ? latestReceipt.word_count
      : null;

  const menuActions = historyRowActions({
    t,
    saved: entry.saved,
    hasText,
    busy,
    onCorrect: () => correction.setOpen(true),
    onToggleSaved: () => void onToggleSaved(entry.id),
    onProcessAgain: () => setProcessAgainOpen(true),
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
        <button
          type="button"
          className={ROW_BUTTON}
          aria-expanded={expanded}
          aria-controls={expanded ? detailsId : undefined}
          onClick={() => onToggleExpanded(entry.id)}
          data-testid="history-entry-toggle"
        >
          <span
            /* 13px explicitly, not `text-sm`. This app sets
             * `:root { font-size: 14px }`, so text-sm renders 12.25px — the
             * legacy SECONDARY tier — and the transcript is the row's content,
             * not help text. 13px/19px is the row tier this list has always
             * used. */
            className="min-w-0 flex-1 text-pretty line-clamp-2 text-[13px] leading-[19px] text-gray-1000 select-text data-[expanded=true]:line-clamp-none data-[expanded=true]:overflow-visible data-[expanded=true]:break-words data-[expanded=true]:whitespace-pre-wrap data-[tone=stated]:text-gray-900"
            data-tone={lineTone}
            data-expanded={expanded ? "true" : undefined}
            data-testid="history-entry-transcript"
          >
            {line}
          </span>

          {/* Every row in a search result matched somehow, so "matched by text"
           * on all of them is chrome; the one fact worth a cell is that this
           * row's own words do NOT contain the query and it is here because its
           * meaning does. Outside a search `match_kind` is null. */}
          {entry.match_kind === "semantic" ? (
            <span className="flex-none text-[11px] text-gray-800">
              {t("libraryV2.byMeaning")}
            </span>
          ) : null}

          {wordCount !== null ? (
            <span className={ROW_MEASURE} data-testid="history-entry-words">
              {t("libraryV2.words", { count: wordCount })}
            </span>
          ) : null}

          {/* The clock only. The day heading above the group owns the date, so
           * the row printing it again would be the same fact twice. */}
          <span
            /* A floor, not a width: 62px lines every row's clock up in one
             * column, and a locale that spells the time longer ("12:00 a.m.")
             * widens its own cell instead of colliding with the word count. */
            className={`${ROW_MEASURE} min-w-[62px] text-end`}
            data-testid="history-entry-time"
          >
            {formatTimeOfDay(entry.timestamp * 1000)}
          </span>
        </button>

        {expanded ? (
          <div
            id={detailsId}
            className="flex flex-col gap-3 px-4 pb-3"
            data-testid="history-entry-details"
          >
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

            <HistoryRowControls
              menuActions={menuActions}
              hasText={hasText}
              busy={busy}
              showCopied={showCopied}
              onCopy={() => void handleCopyText()}
              onRetranscribe={() => void handleRetranscribe()}
              onDelete={handleDeleteEntry}
            />

            <HistoryReceiptInspector
              receipts={receipts}
              parentId={entry.parent_id}
            />
          </div>
        ) : null}

        {/* Both dialogs render nothing until they are open, and they sit outside
         * the details region on purpose: a dialog opened from the row's menu
         * must survive the row being collapsed behind it. */}
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
