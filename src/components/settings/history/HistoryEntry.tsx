import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  commands,
  type CaptureStatus,
  type HistoryEntry,
  type HistoryRunReceipt,
} from "@/bindings";
import { formatDurationShort, formatEntryTimestamp } from "@/lib/utils/format";
import { ProcessAgainDialog } from "./ProcessAgainDialog";
import {
  AudioPlayer,
  Button,
  Dialog,
  Dropdown,
  IconButton,
  Input,
  StatusText,
} from "../../ui";

export type HistoryTextView = "processed" | "raw";

/* Mirrors --duration-standard, the row collapse in history.css. Under
 * prefers-reduced-motion the collapse is instant and this is just a short
 * pause before the delete call. */
const ROW_COLLAPSE_MS = 180;

/* The precision the backend itself reports on its capture-level log receipt
 * (`peak={:.4} rms={:.4}`). Fewer digits turn a dead input (0.0119) and a
 * quiet room (0.0024) into the same printed number. */
const AMPLITUDE_DIGITS = 4;

type CorrectionScope = "global" | "current_mode";

const SCOPE_VALUES = ["current_mode", "global"] as const;

/* Every row action lives in one `details` menu, so closing it after a choice
 * is the same two lines at five call sites. */
const closeMenu = (target: HTMLElement) => {
  const menu = target.closest("details");
  if (menu) menu.open = false;
};

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
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("settings.history.correction.title")}
      description={t("settings.history.correction.description")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button
            variant="ghost"
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
        </>
      }
    >
      <div className="history-correction">
        <div className="history-field">
          <label className="history-field-label" htmlFor={`${fieldId}-spoken`}>
            {t("settings.history.correction.spoken")}
          </label>
          <Input
            id={`${fieldId}-spoken`}
            value={spoken}
            onChange={(event) => onSpokenChange(event.target.value)}
            placeholder={t("settings.history.correction.spokenPlaceholder")}
            disabled={saving}
          />
        </div>
        <div className="history-field">
          <label className="history-field-label" htmlFor={`${fieldId}-written`}>
            {t("settings.history.correction.written")}
          </label>
          <Input
            id={`${fieldId}-written`}
            value={written}
            onChange={(event) => onWrittenChange(event.target.value)}
            placeholder={t("settings.history.correction.writtenPlaceholder")}
            disabled={saving}
          />
        </div>
        {/* The rule that is about to be written, quoted back. An inset panel
         * rather than a card: it belongs to the form around it. */}
        {ready && (
          <p className="inset-panel history-correction-preview">
            {t("settings.history.correction.preview", {
              spoken: spoken.trim(),
              written: written.trim(),
            })}
          </p>
        )}
        {/* One value, shown as text. The segmented control this used to draw
         * was a third copy of the Processed/Raw chrome for something that is
         * a form field, not a view switch. */}
        <div className="history-field" role="group" aria-labelledby={fieldId}>
          <span className="history-field-label" id={fieldId}>
            {t("settings.history.correction.scope")}
          </span>
          <Dropdown
            options={SCOPE_VALUES.map((value) => ({
              value,
              label: t(
                value === "global"
                  ? "settings.history.correction.global"
                  : "settings.history.correction.currentMode",
              ),
            }))}
            selectedValue={scope}
            onSelect={(value) =>
              onScopeChange(value === "global" ? "global" : "current_mode")
            }
            disabled={saving}
            className="history-mode-picker"
          />
        </div>
      </div>
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

export const HistoryEntryComponent: React.FC<HistoryEntryComponentProps> = ({
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

  return (
    <li
      className="history-row"
      data-removing={removing ? "true" : undefined}
      data-testid="history-entry"
    >
      <div className="history-row-clip">
        <div className="history-row-body">
          <div className="history-row-head">
            <div className="history-row-lines">
              <HistoryRowMeta
                entry={entry}
                receipt={latestReceipt}
                noSpeechCaptured={noSpeechCaptured}
              />
              {showsTranscript &&
                (retrying ? (
                  <p className="history-transcript type-body" role="status">
                    {t("settings.history.transcribing")}
                  </p>
                ) : (
                  <p
                    className="history-transcript type-body"
                    data-state={hasText ? "text" : "missing"}
                    data-expanded={expanded ? "true" : undefined}
                  >
                    {hasText
                      ? shownText
                      : t("settings.history.transcriptionFailed")}
                  </p>
                ))}
            </div>

            <div className="history-row-actions">
              <IconButton
                size="sm"
                label={t("settings.history.copyToClipboard")}
                onClick={() => void handleCopyText()}
                disabled={!hasText || busy}
                data-testid="history-entry-copy"
                icon={
                  showCopied ? (
                    <Check aria-hidden="true" width={16} height={16} />
                  ) : (
                    <Copy aria-hidden="true" width={16} height={16} />
                  )
                }
              />
              <IconButton
                size="sm"
                label={
                  expanded
                    ? t("settings.history.collapseEntry", "Hide full entry")
                    : t("settings.history.expandEntry", "Show full entry")
                }
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
                aria-controls={expanded ? detailsId : undefined}
                data-testid="history-entry-expand"
                icon={
                  expanded ? (
                    <ChevronUp aria-hidden="true" width={16} height={16} />
                  ) : (
                    <ChevronDown aria-hidden="true" width={16} height={16} />
                  )
                }
              />
              {/* Everything that changes or destroys the entry sits behind one
               * summary, so the row carries two icon buttons and a menu
               * instead of six controls of three different weights. */}
              <details className="history-actions-menu">
                <summary
                  aria-label={t("settings.history.moreActions", "More actions")}
                  title={t("settings.history.moreActions", "More actions")}
                  data-testid="history-entry-actions"
                >
                  <Ellipsis aria-hidden="true" width={16} height={16} />
                </summary>
                <div role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!hasText || busy}
                    onClick={(event) => {
                      setCorrectionOpen(true);
                      closeMenu(event.currentTarget);
                    }}
                    data-testid="history-entry-correct"
                  >
                    {t("settings.history.correction.add")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    aria-pressed={entry.saved}
                    onClick={(event) => {
                      void onToggleSaved(entry.id);
                      closeMenu(event.currentTarget);
                    }}
                    data-testid="history-entry-save"
                  >
                    {entry.saved
                      ? t("settings.history.unsave")
                      : t("settings.history.save")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={(event) => {
                      void handleRetranscribe();
                      closeMenu(event.currentTarget);
                    }}
                    data-testid="history-entry-retry"
                  >
                    {t("settings.history.retranscribe")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={(event) => {
                      setProcessAgainOpen(true);
                      closeMenu(event.currentTarget);
                    }}
                    data-testid="history-entry-process-again"
                  >
                    {t("settings.history.processAgain.action", "Process again")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="danger-menu-item"
                    disabled={busy}
                    onClick={(event) => {
                      handleDeleteEntry();
                      closeMenu(event.currentTarget);
                    }}
                    data-testid="history-entry-delete"
                  >
                    {t("settings.history.delete")}
                  </button>
                </div>
              </details>
            </div>
          </div>

          {processedTextMissing && !retrying ? (
            <p className="history-transcript-note type-secondary">
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
            <HistoryReceiptInspector id={detailsId} receipts={receipts} />
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

interface HistoryRowMetaProps {
  entry: HistoryEntry;
  receipt: HistoryRunReceipt | null;
  noSpeechCaptured: boolean;
}

/* Line 1 of the row: one mono run of measured values, separated by middots,
 * no badges. Word count, duration, mode and engine are numbers and
 * identifiers, so they read as text at data weight; a pill around each would
 * add five borders and no information. */
const HistoryRowMeta: React.FC<HistoryRowMetaProps> = ({
  entry,
  receipt,
  noSpeechCaptured,
}) => {
  const { t } = useTranslation();

  const cells: Array<{ id: string; content: React.ReactNode }> = [
    {
      id: "time",
      content: formatEntryTimestamp(entry.timestamp * 1000),
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
     * describe what the microphone actually delivered; printing both in one run
     * of middots would assert they measure the same window. The saved clip's
     * length is stated by the thing it belongs to — the player's total. */
    cells.push({
      id: "reason",
      content: (
        <span className="history-meta-reason">
          {t("errors.noSpeechDetectedTitle")}
        </span>
      ),
    });
  } else if (receipt?.duration_ms != null) {
    cells.push({
      id: "duration",
      content: formatDurationShort(receipt.duration_ms / 1000),
    });
  }

  /* The two numbers that separate a dead input from a quiet room: 0.0119 peak
   * over 1.14 s of room noise against 0.1456 over a real utterance. Absent
   * means the run never measured them — imports, reprocesses, truncated
   * captures and every row older than this field — so the cell disappears
   * rather than printing a zero nobody recorded. */
  if (receipt?.mode.input_peak != null) {
    cells.push({
      id: "peak",
      content: (
        <>
          <span className="microlabel">
            {t("settings.history.level.peak", "peak")}
          </span>
          {` ${receipt.mode.input_peak.toFixed(AMPLITUDE_DIGITS)}`}
        </>
      ),
    });
  }
  if (receipt?.mode.input_rms != null) {
    cells.push({
      id: "rms",
      content: (
        <>
          <span className="microlabel">
            {t("settings.history.level.rms", "rms")}
          </span>
          {` ${receipt.mode.input_rms.toFixed(AMPLITUDE_DIGITS)}`}
        </>
      ),
    });
  }

  if (receipt) {
    if (!noSpeechCaptured && receipt.word_count !== null) {
      cells.push({
        id: "words",
        content: t("settings.history.receipts.words", {
          count: receipt.word_count,
        }),
      });
    }
    cells.push({ id: "mode", content: receipt.mode.mode_id });
    cells.push({
      id: "engine",
      content: t(
        "settings.history.receipts.engine." + receipt.mode.engine_requested,
      ),
    });
    if (receipt.source_kind) {
      cells.push({
        id: "source",
        content: t("settings.history.receipts.source." + receipt.source_kind),
      });
    }
  }

  /* A reprocess and a retry both write a new row pointing at the one they came
   * from. Naming the id says which row, which is what someone looking at two
   * near-identical transcripts actually needs. */
  if (entry.parent_id !== null) {
    cells.push({
      id: "parent",
      content: t("settings.history.derivedFromId", "from #{{id}}", {
        id: entry.parent_id,
      }),
    });
  }

  return (
    <p className="history-row-meta type-data" data-testid="history-entry-meta">
      {cells.map((cell, index) => (
        <React.Fragment key={cell.id}>
          {index > 0 ? (
            <span aria-hidden="true" className="history-meta-sep">
              ·
            </span>
          ) : null}
          {cell.content}
        </React.Fragment>
      ))}
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
      className="history-audio"
    />
  );
};

interface HistoryReceiptInspectorProps {
  id: string;
  receipts: HistoryRunReceipt[] | null | undefined;
}

/* The full receipt, as an inset panel of key/value pairs: quoted machine
 * output, not a card. There is no second disclosure inside it — the row's own
 * expander is the only toggle, and everything the run recorded is plain text
 * underneath it. */
const HistoryReceiptInspector: React.FC<HistoryReceiptInspectorProps> = ({
  id,
  receipts,
}) => {
  const { t } = useTranslation();

  /* Three ways to have no receipt to show, and they are not the same thing:
   * the read is still running, the read failed, or the run genuinely recorded
   * none. The panel says which. */
  let body: React.ReactNode;
  if (receipts === undefined) {
    body = (
      <StatusText live="polite">
        {t("settings.history.receipts.loading")}
      </StatusText>
    );
  } else if (receipts === null) {
    body = (
      <StatusText>{t("settings.history.receipts.unavailable")}</StatusText>
    );
  } else if (receipts.length === 0) {
    body = <StatusText>{t("settings.history.receipts.none")}</StatusText>;
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
      className="inset-panel history-receipts"
      data-testid="history-receipts"
    >
      {body}
    </div>
  );
};

interface HistoryReceiptCardProps {
  receipt: HistoryRunReceipt;
}

const HistoryReceiptCard: React.FC<HistoryReceiptCardProps> = ({ receipt }) => {
  const { t } = useTranslation();

  /* `status` paints the state word itself and nothing else: the one place in
   * Library the four-state semaphore is allowed. `no_speech_detected` is
   * deliberately not red or amber — it is a real outcome of a real capture,
   * and colouring it as a failure would claim one the app cannot name. */
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
    <section className="history-receipt">
      <dl className="history-receipt-grid">
        {pairs.map((pair) => (
          <React.Fragment key={pair.id}>
            <dt className="microlabel">{pair.label}</dt>
            <dd className="type-data" data-status={pair.status}>
              {pair.value}
            </dd>
          </React.Fragment>
        ))}
      </dl>

      {/* Both of these were a list of two spans pushed apart, which is a
       * table drawn by hand and reads to a screen reader as pairs of
       * floating words. On the real primitive each column is named once. */}
      <div>
        <h4 className="history-receipt-subtitle microlabel">
          {t("settings.history.receipts.contextSources")}
        </h4>
        <table className="data-table history-receipt-table">
          <thead>
            <tr>
              <th scope="col">
                {t("settings.history.receipts.columns.source", "Source")}
              </th>
              <th scope="col">
                {t("settings.history.receipts.columns.status", "Status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(receipt.context.sources).map(
              ([source, sourceStatus]) => (
                <tr key={source}>
                  <th scope="row">
                    {t("settings.history.receipts.contextSource." + source)}
                  </th>
                  <td>
                    {t(
                      "settings.history.receipts.contextStatus." + sourceStatus,
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h4 className="history-receipt-subtitle microlabel">
          {t("settings.history.receipts.deliveryAttempts")}
        </h4>
        {receipt.delivery_attempts.length === 0 ? (
          <p className="history-receipt-empty type-secondary">
            {t("settings.history.receipts.noDeliveryAttempts")}
          </p>
        ) : (
          <table className="data-table history-receipt-table">
            <thead>
              <tr>
                <th scope="col">
                  {t("settings.history.receipts.columns.method", "Method")}
                </th>
                <th scope="col">
                  {t("settings.history.receipts.columns.outcome", "Outcome")}
                </th>
              </tr>
            </thead>
            <tbody>
              {receipt.delivery_attempts.map((attempt) => (
                <tr key={attempt.id}>
                  <th scope="row">
                    {t(
                      "settings.history.receipts.deliveryMethod." +
                        attempt.delivery.method,
                    )}
                  </th>
                  <td>
                    {t(
                      "settings.history.receipts.deliveryOutcome." +
                        attempt.delivery.outcome,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
