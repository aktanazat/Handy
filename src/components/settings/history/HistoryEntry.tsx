import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import {
  commands,
  type CaptureStatus,
  type HistoryEntry,
  type HistoryRunReceipt,
} from "@/bindings";
import {
  formatDurationShort,
  formatEntryTimestamp,
  formatRealtimeFactor,
  formatRelativeTime,
} from "@/lib/utils/format";
import { ProcessAgainDialog } from "./ProcessAgainDialog";
import { AudioPlayer } from "../../ui";
import { Microlabel } from "../rows";
import { Badge } from "@/components/vg/badge";
import { Button } from "@/components/vg/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/vg/dropdown-menu";
import { Input } from "@/components/vg/input";
import { Label } from "@/components/vg/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";

export type HistoryTextView = "processed" | "raw";

/* The wait before the delete call, in JS. It must equal the CSS collapse below,
 * which reads `--duration-standard` (180ms) — the row does not get to pick its
 * own timing. Under prefers-reduced-motion App.css zeroes every transition
 * globally with `!important`, so the collapse is instant and this is just a
 * short pause. */
const ROW_COLLAPSE_MS = 180;

/* The precision the backend itself reports on its capture-level log receipt
 * (`peak={:.4} rms={:.4}`). Fewer digits turn a dead input (0.0119) and a
 * quiet room (0.0024) into the same printed number. */
const AMPLITUDE_DIGITS = 4;

/* One quiet 28px control, the row's unit of chrome. Geist rows do not shout:
 * the icon sits at gray-800 and only reaches full contrast under the pointer. */
const ROW_CONTROL = "size-7 text-gray-800 hover:text-gray-1000";

type CorrectionScope = "global" | "current_mode";

const SCOPE_VALUES = ["current_mode", "global"] as const;

export interface HistoryRowAction {
  /** Stable id; also the row's `history-entry-<id>` test hook. */
  id: string;
  label: string;
  disabled: boolean;
  destructive?: boolean;
  onSelect: () => void;
}

/* Every operation that changes or destroys the entry, as data. The row renders
 * this list into one menu, so the set of operations is stated once instead of
 * five near-identical JSX blocks — and it can be read without opening a menu
 * that only exists in a portal. */
export const historyRowActions = ({
  t,
  saved,
  hasText,
  busy,
  onCorrect,
  onToggleSaved,
  onRetranscribe,
  onProcessAgain,
  onDelete,
}: {
  t: TFunction;
  saved: boolean;
  hasText: boolean;
  busy: boolean;
  onCorrect: () => void;
  onToggleSaved: () => void;
  onRetranscribe: () => void;
  onProcessAgain: () => void;
  onDelete: () => void;
}): HistoryRowAction[] => [
  {
    id: "correct",
    label: t("settings.history.correction.add"),
    disabled: !hasText || busy,
    onSelect: onCorrect,
  },
  {
    /* Named by what pressing it does, which is what a menu item is for: the
     * state it reflects needs no second marker. */
    id: "save",
    label: saved ? t("settings.history.unsave") : t("settings.history.save"),
    disabled: busy,
    onSelect: onToggleSaved,
  },
  {
    id: "retry",
    label: t("settings.history.retranscribe"),
    disabled: busy,
    onSelect: onRetranscribe,
  },
  {
    id: "process-again",
    label: t("settings.history.processAgain.action", "Process again"),
    disabled: busy,
    onSelect: onProcessAgain,
  },
  {
    id: "delete",
    label: t("settings.history.delete"),
    disabled: busy,
    destructive: true,
    onSelect: onDelete,
  },
];

interface HistoryCorrectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spoken: string;
  written: string;
  scope: CorrectionScope;
  saving: boolean;
  ready: boolean;
  onSpokenChange: (value: string) => void;
  onWrittenChange: (value: string) => void;
  onScopeChange: (scope: CorrectionScope) => void;
  onSave: () => void;
}

const HistoryCorrectionDialog = ({
  open,
  onOpenChange,
  spoken,
  written,
  scope,
  saving,
  ready,
  onSpokenChange,
  onWrittenChange,
  onScopeChange,
  onSave,
}: HistoryCorrectionDialogProps) => {
  const { t } = useTranslation();
  const fieldId = useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t("settings.history.correction.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.history.correction.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-spoken`}>
              {t("settings.history.correction.spoken")}
            </Label>
            <Input
              id={`${fieldId}-spoken`}
              value={spoken}
              onChange={(event) => onSpokenChange(event.target.value)}
              placeholder={t("settings.history.correction.spokenPlaceholder")}
              disabled={saving}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-written`}>
              {t("settings.history.correction.written")}
            </Label>
            <Input
              id={`${fieldId}-written`}
              value={written}
              onChange={(event) => onWrittenChange(event.target.value)}
              placeholder={t("settings.history.correction.writtenPlaceholder")}
              disabled={saving}
            />
          </div>
          {/* The rule that is about to be written, quoted back. Recessed
           * against the dialog rather than another card: it belongs to the
           * form around it. */}
          {ready && (
            <p className="rounded-md bg-background-200 px-3 py-2 text-sm break-words text-gray-1000">
              {t("settings.history.correction.preview", {
                spoken: spoken.trim(),
                written: written.trim(),
              })}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-scope`}>
              {t("settings.history.correction.scope")}
            </Label>
            <Select
              value={scope}
              onValueChange={(value) =>
                onScopeChange(value === "global" ? "global" : "current_mode")
              }
              disabled={saving}
            >
              <SelectTrigger id={`${fieldId}-scope`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(
                      value === "global"
                        ? "settings.history.correction.global"
                        : "settings.history.correction.currentMode",
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={!ready || saving}
            data-testid="history-correction-save"
          >
            {t("settings.history.correction.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

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
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [processAgainOpen, setProcessAgainOpen] = useState(false);
  const [correctionSpoken, setCorrectionSpoken] = useState("");
  const [correctionWritten, setCorrectionWritten] = useState("");
  const [correctionScope, setCorrectionScope] =
    useState<CorrectionScope>("current_mode");
  const [savingCorrection, setSavingCorrection] = useState(false);
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

  const correctionReady =
    correctionSpoken.trim() !== "" && correctionWritten.trim() !== "";

  const saveCorrection = async () => {
    if (!correctionReady) return;
    setSavingCorrection(true);
    try {
      const result = await commands.addVocabularyCorrection(
        correctionSpoken,
        correctionWritten,
        { kind: correctionScope },
      );
      if (result.status !== "ok") throw new Error(String(result.error));
      setCorrectionOpen(false);
      setCorrectionSpoken("");
      setCorrectionWritten("");
      toast.success(t("settings.history.correction.saved"));
    } catch (correctionError) {
      console.error("Failed to save vocabulary correction:", correctionError);
      toast.error(t("settings.history.correction.saveError"));
    } finally {
      setSavingCorrection(false);
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
    onCorrect: () => setCorrectionOpen(true),
    onToggleSaved: () => void onToggleSaved(entry.id),
    onRetranscribe: () => void handleRetranscribe(),
    onProcessAgain: () => setProcessAgainOpen(true),
    onDelete: handleDeleteEntry,
  });

  /* Why an empty transcript is empty. The copy that used to sit here called
   * every case a failure and told the reader to press a retry icon that no
   * longer exists — retry is a named item in this row's menu now.
   *
   * The gate is `capture_status === "complete"`, and it is load-bearing rather
   * than incidental. Only three run outcomes reach Complete with no text, and
   * they are the only three worth distinguishing. Everything else that lands
   * here also carries no `engine_used` and would otherwise be misread as a
   * failure: all three no-speech provenances, a truncated capture (whose prefix
   * is forbidden from being auto-transcribed, so there was never a
   * transcription to fail), and every legacy row, since `capture_status`
   * arrived in a later migration and retries and imports keep it NULL. Those
   * all get the neutral statement, which is true for each of them.
   *
   * Within Complete, the discriminators are already on the receipt (actions.rs,
   * verified by DictationTrust): the held path sets `cloud_status` explicitly,
   * and the failure path builds its receipt from `mode_receipt()` and so
   * carries no `engine_used`, while a real decode always names the engine it
   * ran on. The held case ALSO has no `engine_used`, so the order of these two
   * branches is the thing that keeps a held run off the failure line. Anything
   * else is a run the model heard and post-processing then emptied — "scratch
   * that", or a filler-only clip with filler removal on, which is the default.
   * Nothing in the schema keeps the pre-post-processing output, so for that
   * last case the app states what it can observe instead of guessing. */
  let emptyTextLine = t(
    "settings.history.noTextRecorded",
    "No text was recorded for this entry.",
  );
  if (latestReceipt?.capture_status === "complete") {
    if (latestReceipt.mode.cloud_status === "held_cloud_unavailable") {
      emptyTextLine = t(
        "settings.history.cloudHeld",
        "The cloud run was held: no trustworthy result arrived and no local model was available.",
      );
    } else if (latestReceipt.mode.engine_used == null) {
      emptyTextLine = t(
        "settings.history.transcriptionEngineFailed",
        "Transcription failed, so nothing was recorded.",
      );
    }
  }

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
                    {hasText ? shownText : emptyTextLine}
                  </p>
                ))}
            </div>

            {/* Copy, expand and one menu. Everything that changes or destroys
             * the entry is inside the menu, so the row carries three controls
             * rather than six of three different weights. */}
            <div className="flex flex-none items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className={ROW_CONTROL}
                aria-label={t("settings.history.copyToClipboard")}
                onClick={() => void handleCopyText()}
                disabled={!hasText || busy}
                data-testid="history-entry-copy"
              >
                {showCopied ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : (
                  <Copy aria-hidden="true" className="size-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={ROW_CONTROL}
                aria-label={
                  expanded
                    ? t("settings.history.collapseEntry", "Hide full entry")
                    : t("settings.history.expandEntry", "Show full entry")
                }
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
                aria-controls={expanded ? detailsId : undefined}
                data-testid="history-entry-expand"
              >
                {expanded ? (
                  <ChevronUp aria-hidden="true" className="size-4" />
                ) : (
                  <ChevronDown aria-hidden="true" className="size-4" />
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={ROW_CONTROL}
                    aria-label={t(
                      "settings.history.moreActions",
                      "More actions",
                    )}
                    data-testid="history-entry-actions"
                  >
                    <Ellipsis aria-hidden="true" className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                {/* No fixed width. The kit's content ships `min-w-[8rem]` and
                 * `overflow-x-hidden`, so a pinned `w-48` (168px of text
                 * budget) would CLIP, not ellipsize, the longest of these five
                 * labels: "Aus Gespeicherten entfernen" (de, 27 chars) and
                 * "फेरि ट्रान्सक्राइब गर्नुहोस्" (ne, 28) both need well over 200px, and SF —
                 * which is what actually paints today — is ~18% wider than
                 * Geist. Sizing to content cannot clip in any of the 24
                 * locales. */}
                <DropdownMenuContent align="end">
                  {actions.map((action) => (
                    <DropdownMenuItem
                      key={action.id}
                      disabled={action.disabled}
                      variant={action.destructive ? "destructive" : "default"}
                      onSelect={action.onSelect}
                      data-testid={`history-entry-${action.id}`}
                    >
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {processedTextMissing && !retrying ? (
            <p className="text-sm text-gray-900">
              {t("settings.history.postProcessEmpty")}
            </p>
          ) : null}

          {/* The player's anatomy belongs to the primitive; the row only spans
           * it and quiets it: gray-900 control, the one duration in mono. */}
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
            open={correctionOpen}
            onOpenChange={setCorrectionOpen}
            spoken={correctionSpoken}
            written={correctionWritten}
            scope={correctionScope}
            saving={savingCorrection}
            ready={correctionReady}
            onSpokenChange={setCorrectionSpoken}
            onWrittenChange={setCorrectionWritten}
            onScopeChange={setCorrectionScope}
            onSave={() => void saveCorrection()}
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

interface HistoryRowMetaProps {
  entry: HistoryEntry;
  receipt: HistoryRunReceipt | null;
  noSpeechCaptured: boolean;
  /* True when the row renders no audio player; the meta line then carries the
   * duration the player's right edge would otherwise state. */
  showDuration: boolean;
}

/* Line 1 of the row: when it happened, how long, how many words, which mode.
 * Four cells and nothing else. The measured detail this line used to shout —
 * peak/rms, engine, source, reprocess parentage — lives on the expanded
 * receipt, where it reads as a table instead of seven mono fragments. The
 * date is relative while that is meaningful and absolute past two weeks,
 * through the shared formatter. */
const HistoryRowMeta: React.FC<HistoryRowMetaProps> = ({
  entry,
  receipt,
  noSpeechCaptured,
  showDuration,
}) => {
  const { t } = useTranslation();

  const cells: Array<{ id: string; content: React.ReactNode }> = [
    {
      id: "time",
      content: formatRelativeTime(entry.timestamp * 1000),
    },
  ];

  if (noSpeechCaptured) {
    /* True for all three ways a run reaches this state: the model examined the
     * clip and returned nothing, or the clip ran long enough that the voice
     * detector's answer stands, or no local decoder existed to ask. The claim
     * is about the recording, not about who checked it.
     *
     * No length here on purpose. A silent capture is zero-padded before it is
     * saved, so its stored length describes the padded clip while peak and rms
     * describe what the microphone actually delivered. The saved clip's length
     * is stated by the thing it belongs to — the player's total. */
    cells.push({
      id: "reason",
      content: (
        /* The one part of line 1 that is a sentence rather than a machine
         * value, so it keeps the sans face and the reading colour. */
        <span className="font-sans text-gray-1000">
          {t("errors.noSpeechDetectedTitle")}
        </span>
      ),
    });
  } else {
    /* The row states its length exactly once. When the audio row renders, its
     * right edge is the duration (it doubles as the scrubber's total); only a
     * row with no player left — a receipt proved the clip empty, or retention
     * removed the file — says it here. */
    if (showDuration && receipt?.duration_ms) {
      cells.push({
        id: "duration",
        content: formatDurationShort(receipt.duration_ms / 1000),
      });
    }
    if (receipt && receipt.word_count !== null) {
      cells.push({
        id: "words",
        content: t("settings.history.receipts.words", {
          count: receipt.word_count,
        }),
      });
    }
  }

  /* Only the semantic case is marked. Every row in a search result matched
   * somehow, so "matched by text" on all of them is chrome; the one fact worth
   * a cell is that this row's own words do NOT contain the query and it is here
   * because its meaning does. Outside a search `match_kind` is null and no cell
   * appears at all. */
  if (entry.match_kind === "semantic") {
    cells.push({
      id: "match",
      content: t("settings.history.recalledByMeaning", "by meaning"),
    });
  }

  return (
    /* One mono run of measured values. It truncates rather than wrapping,
     * because a metadata line that wraps changes the row's height and the list
     * stops being a grid. */
    <p
      className="truncate font-mono text-[11px] tabular-nums text-gray-800"
      data-testid="history-entry-meta"
    >
      {cells.map((cell, index) => (
        <React.Fragment key={cell.id}>
          {index > 0 ? (
            <span aria-hidden="true" className="px-1 text-gray-800">
              ·
            </span>
          ) : null}
          {cell.content}
        </React.Fragment>
      ))}
      {/* The mode is a categorical identity, not a measurement, so it is the
       * line's one chip rather than another mono fragment. */}
      {receipt ? (
        <Badge
          variant="secondary"
          className="ml-2 align-middle font-mono text-[10px]"
          data-testid="history-entry-mode"
        >
          {receipt.mode.mode_id}
        </Badge>
      ) : null}
    </p>
  );
};

interface HistoryAudioPlayerProps {
  historyId: number;
  totalSeconds: number | undefined;
  getAudioBlob: (historyId: number) => Promise<Blob | null>;
}

const HistoryAudioPlayer: React.FC<HistoryAudioPlayerProps> = ({
  historyId,
  totalSeconds,
  getAudioBlob,
}) => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const loadAudio = async () => {
    if (audioUrl) return audioUrl;

    const blob = await getAudioBlob(historyId);
    if (!blob) return null;

    // react-doctor-disable-next-line no-create-object-url-without-revoke
    const url = URL.createObjectURL(blob);
    if (!mountedRef.current) {
      URL.revokeObjectURL(url);
      return null;
    }
    setAudioUrl(url);
    return url;
  };

  return (
    <AudioPlayer
      onLoadRequest={loadAudio}
      totalSeconds={totalSeconds}
      /* Capped rather than full-bleed: the primitive's native range track is
       * the loudest thing it draws, and stretched across the row it outweighed
       * the transcript above it. At 420px it reads as a control under the text
       * instead of a rule through the row, and the mono total sits beside the
       * scrubber instead of floating at the row's far edge. */
      className="w-full max-w-[420px] [&_button]:text-gray-900 [&_span]:font-mono [&_span]:text-gray-800"
    />
  );
};

interface HistoryReceiptInspectorProps {
  id: string;
  receipts: HistoryRunReceipt[] | null | undefined;
  /** The row this entry was reprocessed or retried from, when it has one. */
  parentId: number | null;
}

/* The full receipt, as an inset panel of key/value pairs: quoted machine
 * output, not a card. There is no second disclosure inside it — the row's own
 * expander is the only toggle, and everything the run recorded is plain text
 * underneath it. */
const HistoryReceiptInspector: React.FC<HistoryReceiptInspectorProps> = ({
  id,
  receipts,
  parentId,
}) => {
  const { t } = useTranslation();

  /* Three ways to have no receipt to show, and they are not the same thing:
   * the read is still running, the read failed, or the run genuinely recorded
   * none. The panel says which. */
  let body: React.ReactNode;
  if (receipts === undefined) {
    body = (
      <p className="text-sm text-gray-900" aria-live="polite">
        {t("settings.history.receipts.loading")}
      </p>
    );
  } else if (receipts === null) {
    body = (
      <p className="text-sm text-gray-900">
        {t("settings.history.receipts.unavailable")}
      </p>
    );
  } else if (receipts.length === 0) {
    body = (
      <p className="text-sm text-gray-900">
        {t("settings.history.receipts.none")}
      </p>
    );
  } else {
    body = receipts
      .slice()
      .sort((left, right) => right.completed_at_ms - left.completed_at_ms)
      .map((receipt) => (
        <HistoryReceiptCard key={receipt.id} receipt={receipt} />
      ));
  }

  return (
    <div
      id={id}
      className="flex flex-col rounded-md bg-background-200 px-3 py-2.5"
      data-testid="history-receipts"
    >
      {/* A reprocess and a retry both write a new row pointing at the one they
       * came from. Naming the id says which row, which is what someone looking
       * at two near-identical transcripts actually needs. It reads here with
       * the rest of the provenance instead of spending a metadata cell on
       * every collapsed row. */}
      {parentId !== null ? (
        <p className="mb-2 font-mono text-[11px] text-gray-800">
          {t("settings.history.derivedFromId", "from #{{id}}", {
            id: parentId,
          })}
        </p>
      ) : null}
      {body}
    </div>
  );
};

interface HistoryReceiptCardProps {
  receipt: HistoryRunReceipt;
}

/* The four-state semaphore, on the state word and nowhere else. A no-speech
 * capture is deliberately neither red nor amber — it is a real outcome of a
 * real capture, and colouring it as a failure would claim one the app cannot
 * name. The peak/rms rows above it are the evidence. */
const CAPTURE_STATUS_TONE = {
  complete: "text-blue-900",
  truncated: "text-amber-900",
  no_speech_detected: "text-gray-800",
} satisfies Record<CaptureStatus, string>;

const HistoryReceiptCard: React.FC<HistoryReceiptCardProps> = ({ receipt }) => {
  const { t } = useTranslation();

  const pairs: Array<{
    id: string;
    label: string;
    value: React.ReactNode;
    status?: CaptureStatus;
  }> = [
    {
      id: "mode",
      label: t("settings.history.receipts.modeLabel", "Mode"),
      value: receipt.mode.mode_id,
    },
    {
      id: "revision",
      label: t("settings.history.receipts.revisionLabel", "Revision"),
      value: receipt.mode.settings_revision,
    },
    {
      id: "engine",
      label: t("settings.history.receipts.engineLabel", "Engine"),
      value: t(
        "settings.history.receipts.engine." + receipt.mode.engine_requested,
      ),
    },
  ];

  if (receipt.source_kind) {
    pairs.push({
      id: "source",
      label: t("settings.history.receipts.sourceLabel", "Source"),
      value: t("settings.history.receipts.source." + receipt.source_kind),
    });
  }
  if (receipt.capture_status) {
    pairs.push({
      id: "capture",
      label: t("settings.history.receipts.captureStatusLabel", "Capture"),
      value: t(
        "settings.history.receipts.captureStatus." + receipt.capture_status,
      ),
      status: receipt.capture_status,
    });
  }
  if (receipt.duration_ms !== null) {
    pairs.push({
      id: "duration",
      label: t("settings.history.receipts.durationLabel"),
      value: formatDurationShort(receipt.duration_ms / 1000),
    });
  }
  if (receipt.word_count !== null) {
    pairs.push({
      id: "words",
      label: t("settings.history.receipts.wordsLabel"),
      value: receipt.word_count,
    });
  }
  if (receipt.mode.input_peak != null) {
    pairs.push({
      id: "peak",
      label: t("settings.history.level.peak", "peak"),
      value: receipt.mode.input_peak.toFixed(AMPLITUDE_DIGITS),
    });
  }
  if (receipt.mode.input_rms != null) {
    pairs.push({
      id: "rms",
      label: t("settings.history.level.rms", "rms"),
      value: receipt.mode.input_rms.toFixed(AMPLITUDE_DIGITS),
    });
  }
  /* The engine's throughput on this machine for this decode. The label says
   * DECODE rather than "realtime" on purpose: the field is audio ÷ decode span
   * and excludes model load. The measurement behind the doc comment's 13.8 was
   * 1.05 s of audio in 76 ms of decode after 286 ms of load — 2.9x by wall
   * clock. Labelled "Realtime" a reader takes it for how fast the dictation
   * was; labelled "Decode" it says the thing it measured.
   *
   * The figure itself goes through Capture's formatter, which is the only one:
   * a fixed one decimal here would print a 0.043x decode as `0.0x`, which is a
   * measurement rounded to a lying zero. Absent means no timed local batch
   * decode was involved. */
  const throughput = formatRealtimeFactor(receipt.mode.realtime_factor ?? null);
  if (throughput !== null) {
    pairs.push({
      id: "rtf",
      label: t("settings.history.receipts.realtimeFactorLabel", "Decode"),
      value: throughput,
    });
  }
  pairs.push(
    {
      id: "preset",
      label: t("settings.history.receipts.presetLabel"),
      value: t(
        "settings.history.receipts.preset." + receipt.mode.prompt_preset,
      ),
    },
    {
      id: "context",
      label: t("settings.history.receipts.contextPolicy"),
      value: t(
        "settings.history.receipts.contextPolicyValues." +
          receipt.mode.context_policy,
      ),
    },
    {
      id: "completed",
      label: t("settings.history.receipts.completedLabel", "Completed"),
      value: formatEntryTimestamp(receipt.completed_at_ms),
    },
  );
  if (receipt.mode.provider_id) {
    pairs.push({
      id: "provider",
      label: t("settings.history.receipts.provider"),
      value:
        receipt.mode.provider_id +
        (receipt.mode.model_id ? " · " + receipt.mode.model_id : ""),
    });
  }

  return (
    <section className="flex flex-col gap-3 not-first:mt-3 not-first:border-t not-first:border-gray-alpha-400 not-first:pt-3">
      {/* Two columns sharing one hairline per pair: microlabel key left,
       * measured value right. The key/value inspector, not a paragraph of
       * provenance. */}
      {/* No column gap: the hairline is drawn per cell, so a gap between the
       * key and value columns breaks each rule into two floating segments.
       * The key cell pads its own right edge instead. */}
      <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)]">
        {pairs.map((pair) => (
          <React.Fragment key={pair.id}>
            <dt className="border-t border-gray-alpha-400 py-1 pr-4 first-of-type:border-t-0">
              <Microlabel>{pair.label}</Microlabel>
            </dt>
            <dd
              className={`border-t border-gray-alpha-400 py-1 text-end font-mono text-[11px] break-words first-of-type:border-t-0 ${
                pair.status ? CAPTURE_STATUS_TONE[pair.status] : "text-gray-900"
              }`}
            >
              {pair.value}
            </dd>
          </React.Fragment>
        ))}
      </dl>

      {/* Both of these were a list of two spans pushed apart, which is a
       * table drawn by hand and reads to a screen reader as pairs of
       * floating words. As a real table each column is named once. */}
      <div>
        <h4 className="mb-1.5">
          <Microlabel>
            {t("settings.history.receipts.contextSources")}
          </Microlabel>
        </h4>
        <HistoryReceiptTable
          columns={[
            t("settings.history.receipts.columns.source", "Source"),
            t("settings.history.receipts.columns.status", "Status"),
          ]}
          rows={Object.entries(receipt.context.sources).map(
            ([source, sourceStatus]) => ({
              id: source,
              header: t("settings.history.receipts.contextSource." + source),
              value: t(
                "settings.history.receipts.contextStatus." + sourceStatus,
              ),
            }),
          )}
        />
      </div>

      <div>
        <h4 className="mb-1.5">
          <Microlabel>
            {t("settings.history.receipts.deliveryAttempts")}
          </Microlabel>
        </h4>
        {receipt.delivery_attempts.length === 0 ? (
          <p className="text-sm text-gray-900">
            {t("settings.history.receipts.noDeliveryAttempts")}
          </p>
        ) : (
          <HistoryReceiptTable
            columns={[
              t("settings.history.receipts.columns.method", "Method"),
              t("settings.history.receipts.columns.outcome", "Outcome"),
            ]}
            rows={receipt.delivery_attempts.map((attempt) => ({
              id: String(attempt.id),
              header: t(
                "settings.history.receipts.deliveryMethod." +
                  attempt.delivery.method,
              ),
              value: t(
                "settings.history.receipts.deliveryOutcome." +
                  attempt.delivery.outcome,
              ),
            }))}
          />
        )}
      </div>
    </section>
  );
};

/* The receipt's two named-column tables, at inspector density: row header
 * left, value right, one hairline per pair. Both callers hand it the same
 * shape, so the markup is stated once. */
const HistoryReceiptTable: React.FC<{
  columns: [string, string];
  rows: Array<{ id: string; header: string; value: string }>;
}> = ({ columns, rows }) => (
  <table className="w-full table-fixed border-collapse text-left">
    <thead>
      <tr>
        {columns.map((column) => (
          <th
            key={column}
            scope="col"
            /* `font-normal` stays on the cell: a <th> is bold by default and
             * the label voice inside it inherits that weight. */
            className="py-1 pr-3 font-normal"
          >
            <Microlabel>{column}</Microlabel>
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr
          key={row.id}
          className="not-last:border-b not-last:border-gray-alpha-400"
        >
          <th
            scope="row"
            className="py-1 pr-3 text-[11px] font-normal text-gray-900"
          >
            {row.header}
          </th>
          <td className="py-1 pr-3 font-mono text-[11px] text-gray-900">
            {row.value}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);
