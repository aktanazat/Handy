import React, { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  commands,
  type HistoryEntry,
  type HistoryRunReceipt,
} from "@/bindings";
import { formatDateTime } from "@/utils/dateFormat";
import {
  AudioPlayer,
  Button,
  Dialog,
  IconButton,
  Input,
  StatusText,
} from "../../ui";

export type HistoryTextView = "processed" | "raw";

/* Mirrors --duration-standard, the row collapse in history.css. Under
 * prefers-reduced-motion the collapse is instant and this is just a short
 * pause before the delete call. */
const ROW_COLLAPSE_MS = 180;

type CorrectionScope = "global" | "current_mode";

interface HistoryCorrectionDialogProps {
  entryId: number;
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
  entryId,
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
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${fieldId}-spoken`}
            className="text-[13px] leading-[19px] font-medium text-text-primary"
          >
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
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${fieldId}-written`}
            className="text-[13px] leading-[19px] font-medium text-text-primary"
          >
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
        {ready && (
          <p className="rounded-control border border-border bg-subtle px-3 py-2 text-[13px] leading-5 text-text-primary">
            {t("settings.history.correction.preview", {
              spoken: spoken.trim(),
              written: written.trim(),
            })}
          </p>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] leading-[19px] font-medium text-text-primary">
            {t("settings.history.correction.scope")}
          </legend>
          <label className="flex items-center gap-2 text-[13px] leading-[19px] text-text-secondary">
            <input
              type="radio"
              name={`history-correction-scope-${entryId}`}
              checked={scope === "current_mode"}
              onChange={() => onScopeChange("current_mode")}
              disabled={saving}
            />
            {t("settings.history.correction.currentMode")}
          </label>
          <label className="flex items-center gap-2 text-[13px] leading-[19px] text-text-secondary">
            <input
              type="radio"
              name={`history-correction-scope-${entryId}`}
              checked={scope === "global"}
              onChange={() => onScopeChange("global")}
              disabled={saving}
            />
            {t("settings.history.correction.global")}
          </label>
        </fieldset>
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
  const [showCopied, setShowCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
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

  let duration: string | null = null;
  if (
    latestReceipt?.duration_ms !== null &&
    latestReceipt?.duration_ms !== undefined
  ) {
    const seconds = Math.floor(latestReceipt.duration_ms / 1000);
    duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

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

  return (
    <li
      className="history-row"
      data-removing={removing ? "true" : undefined}
      data-testid="history-entry"
    >
      <div className="history-row-clip">
        <div className="history-row-body">
          <HistoryEntrySummary
            entry={entry}
            latestReceipt={latestReceipt}
            duration={duration}
            noSpeechCaptured={noSpeechCaptured}
            hasText={hasText}
            busy={retrying || removing}
            retrying={retrying}
            showCopied={showCopied}
            onCopy={() => void handleCopyText()}
            onOpenCorrection={() => setCorrectionOpen(true)}
            onToggleSaved={() => void onToggleSaved(entry.id)}
            onRetry={() => void handleRetranscribe()}
            onDelete={handleDeleteEntry}
          />
          <HistoryEntryContent
            entry={entry}
            shownText={shownText}
            hasText={hasText}
            retrying={retrying}
            noSpeechCaptured={noSpeechCaptured}
            processedTextMissing={processedTextMissing}
            getAudioBlob={getAudioBlob}
            correctionOpen={correctionOpen}
            correctionSpoken={correctionSpoken}
            correctionWritten={correctionWritten}
            correctionScope={correctionScope}
            savingCorrection={savingCorrection}
            correctionReady={correctionReady}
            onCorrectionOpenChange={setCorrectionOpen}
            onSpokenChange={setCorrectionSpoken}
            onWrittenChange={setCorrectionWritten}
            onScopeChange={setCorrectionScope}
            onSaveCorrection={() => void saveCorrection()}
          />
          <HistoryReceiptDetails receipts={receipts} />
        </div>
      </div>
    </li>
  );
};

interface HistoryEntrySummaryProps {
  entry: HistoryEntry;
  latestReceipt: HistoryRunReceipt | null;
  duration: string | null;
  noSpeechCaptured: boolean;
  hasText: boolean;
  busy: boolean;
  retrying: boolean;
  showCopied: boolean;
  onCopy: () => void;
  onOpenCorrection: () => void;
  onToggleSaved: () => void;
  onRetry: () => void;
  onDelete: () => void;
}

const HistoryEntrySummary: React.FC<HistoryEntrySummaryProps> = ({
  entry,
  latestReceipt,
  duration,
  noSpeechCaptured,
  hasText,
  busy,
  retrying,
  showCopied,
  onCopy,
  onOpenCorrection,
  onToggleSaved,
  onRetry,
  onDelete,
}) => {
  const { t, i18n } = useTranslation();
  const formattedDate = formatDateTime(String(entry.timestamp), i18n.language);

  // Provenance reads as one sentence of text. Chips and colored dots would
  // say the same thing louder and survive greyscale worse.
  const metaParts: string[] = [];
  if (latestReceipt) {
    if (noSpeechCaptured) metaParts.push(t("errors.noSpeechDetectedTitle"));
    if (duration) {
      metaParts.push(t("settings.history.receipts.duration", { duration }));
    }
    if (latestReceipt.word_count !== null) {
      metaParts.push(
        t("settings.history.receipts.words", {
          count: latestReceipt.word_count,
        }),
      );
    }
    if (latestReceipt.source_kind) {
      metaParts.push(
        t("settings.history.receipts.source." + latestReceipt.source_kind),
      );
    }
    metaParts.push(
      t("settings.history.receipts.mode", {
        mode: latestReceipt.mode.mode_id,
      }),
      t(
        "settings.history.receipts.engine." +
          latestReceipt.mode.engine_requested,
      ),
    );
  }

  return (
    <div className="history-row-head">
      <div className="history-row-heading">
        <p className="history-row-time">{formattedDate}</p>
        {metaParts.length > 0 && (
          <p className="history-row-meta">{metaParts.join(" · ")}</p>
        )}
      </div>
      <div className="history-row-actions">
        <IconButton
          size="sm"
          label={t("settings.history.copyToClipboard")}
          onClick={onCopy}
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
          label={t("settings.history.correction.add")}
          onClick={onOpenCorrection}
          disabled={!hasText || busy}
          data-testid="history-entry-correct"
          icon={<Pencil aria-hidden="true" width={16} height={16} />}
        />
        <IconButton
          size="sm"
          label={
            entry.saved
              ? t("settings.history.unsave")
              : t("settings.history.save")
          }
          onClick={onToggleSaved}
          disabled={busy}
          aria-pressed={entry.saved}
          data-testid="history-entry-save"
          icon={
            <Star
              aria-hidden="true"
              width={16}
              height={16}
              fill={entry.saved ? "currentColor" : "none"}
            />
          }
        />
        <IconButton
          size="sm"
          label={t("settings.history.retranscribe")}
          onClick={onRetry}
          disabled={busy}
          data-testid="history-entry-retry"
          icon={
            <RotateCcw
              aria-hidden="true"
              width={16}
              height={16}
              className={retrying ? "history-retry-spin" : undefined}
            />
          }
        />
        <IconButton
          size="sm"
          className="history-action-danger"
          label={t("settings.history.delete")}
          onClick={onDelete}
          disabled={busy}
          data-testid="history-entry-delete"
          icon={<Trash2 aria-hidden="true" width={16} height={16} />}
        />
      </div>
    </div>
  );
};

interface HistoryEntryContentProps {
  entry: HistoryEntry;
  shownText: string;
  hasText: boolean;
  retrying: boolean;
  noSpeechCaptured: boolean;
  processedTextMissing: boolean;
  getAudioBlob: (historyId: number) => Promise<Blob | null>;
  correctionOpen: boolean;
  correctionSpoken: string;
  correctionWritten: string;
  correctionScope: CorrectionScope;
  savingCorrection: boolean;
  correctionReady: boolean;
  onCorrectionOpenChange: (open: boolean) => void;
  onSpokenChange: (value: string) => void;
  onWrittenChange: (value: string) => void;
  onScopeChange: (scope: CorrectionScope) => void;
  onSaveCorrection: () => void;
}

const HistoryEntryContent: React.FC<HistoryEntryContentProps> = ({
  entry,
  shownText,
  hasText,
  retrying,
  noSpeechCaptured,
  processedTextMissing,
  getAudioBlob,
  correctionOpen,
  correctionSpoken,
  correctionWritten,
  correctionScope,
  savingCorrection,
  correctionReady,
  onCorrectionOpenChange,
  onSpokenChange,
  onWrittenChange,
  onScopeChange,
  onSaveCorrection,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {retrying ? (
        <p className="history-transcript history-transcribing" role="status">
          {t("settings.history.transcribing")}
        </p>
      ) : (
        <p
          className="history-transcript"
          data-state={hasText ? "text" : "missing"}
        >
          {hasText
            ? shownText
            : noSpeechCaptured
              ? t("errors.noSpeechDetected")
              : t("settings.history.transcriptionFailed")}
        </p>
      )}

      {processedTextMissing && !retrying ? (
        <p className="history-transcript-note">
          {t("settings.history.postProcessEmpty")}
        </p>
      ) : null}

      <HistoryAudioPlayer historyId={entry.id} getAudioBlob={getAudioBlob} />

      <HistoryCorrectionDialog
        entryId={entry.id}
        open={correctionOpen}
        onOpenChange={onCorrectionOpenChange}
        spoken={correctionSpoken}
        written={correctionWritten}
        scope={correctionScope}
        saving={savingCorrection}
        ready={correctionReady}
        onSpokenChange={onSpokenChange}
        onWrittenChange={onWrittenChange}
        onScopeChange={onScopeChange}
        onSave={onSaveCorrection}
      />
    </>
  );
};

interface HistoryAudioPlayerProps {
  historyId: number;
  getAudioBlob: (historyId: number) => Promise<Blob | null>;
}

const HistoryAudioPlayer: React.FC<HistoryAudioPlayerProps> = ({
  historyId,
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

  return <AudioPlayer onLoadRequest={loadAudio} className="w-full" />;
};

interface HistoryReceiptDetailsProps {
  receipts: HistoryRunReceipt[] | null | undefined;
}

const HistoryReceiptDetails: React.FC<HistoryReceiptDetailsProps> = ({
  receipts,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="history-receipts">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="history-receipts-toggle"
        data-testid="history-receipts-toggle"
      >
        {open ? (
          <ChevronUp aria-hidden="true" className="h-4 w-4" />
        ) : (
          <ChevronDown aria-hidden="true" className="h-4 w-4" />
        )}
        {open
          ? t("settings.history.receipts.hideDetails")
          : t("settings.history.receipts.showDetails")}
      </button>
      {open ? <HistoryReceiptList receipts={receipts} /> : null}
    </div>
  );
};

const HistoryReceiptList: React.FC<HistoryReceiptDetailsProps> = ({
  receipts,
}) => {
  const { t } = useTranslation();

  if (receipts === undefined) {
    return (
      <div className="history-receipts-body py-3">
        <StatusText live="polite">
          {t("settings.history.receipts.loading")}
        </StatusText>
      </div>
    );
  }

  if (receipts === null) {
    return (
      <div className="history-receipts-body py-3">
        <StatusText>{t("settings.history.receipts.unavailable")}</StatusText>
      </div>
    );
  }

  if (receipts.length === 0) {
    return (
      <div className="history-receipts-body py-3">
        <StatusText>{t("settings.history.receipts.none")}</StatusText>
      </div>
    );
  }

  return (
    <div className="history-receipts-body">
      {receipts
        .slice()
        .sort((left, right) => right.completed_at_ms - left.completed_at_ms)
        .map((receipt) => (
          <HistoryReceiptCard key={receipt.id} receipt={receipt} />
        ))}
    </div>
  );
};

interface HistoryReceiptCardProps {
  receipt: HistoryRunReceipt;
}

const HistoryReceiptCard: React.FC<HistoryReceiptCardProps> = ({ receipt }) => {
  const { t } = useTranslation();

  const headline = [
    t("settings.history.receipts.mode", { mode: receipt.mode.mode_id }),
    t("settings.history.receipts.revision", {
      revision: receipt.mode.settings_revision,
    }),
    t("settings.history.receipts.engine." + receipt.mode.engine_requested),
  ];
  if (receipt.source_kind) {
    headline.push(t("settings.history.receipts.source." + receipt.source_kind));
  }

  return (
    <section className="history-receipt">
      <p className="history-receipt-meta">{headline.join(" · ")}</p>

      <dl className="history-receipt-grid">
        {receipt.duration_ms !== null ? (
          <>
            <dt>{t("settings.history.receipts.durationLabel")}</dt>
            <dd>
              {t("settings.history.receipts.duration", {
                duration:
                  Math.floor(receipt.duration_ms / 60000) +
                  ":" +
                  String(Math.floor(receipt.duration_ms / 1000) % 60).padStart(
                    2,
                    "0",
                  ),
              })}
            </dd>
          </>
        ) : null}
        {receipt.word_count !== null ? (
          <>
            <dt>{t("settings.history.receipts.wordsLabel")}</dt>
            <dd>{receipt.word_count}</dd>
          </>
        ) : null}
        <dt>{t("settings.history.receipts.presetLabel")}</dt>
        <dd>
          {t("settings.history.receipts.preset." + receipt.mode.prompt_preset)}
        </dd>
        <dt>{t("settings.history.receipts.contextPolicy")}</dt>
        <dd>
          {t(
            "settings.history.receipts.contextPolicyValues." +
              receipt.mode.context_policy,
          )}
        </dd>
        {receipt.mode.provider_id ? (
          <>
            <dt>{t("settings.history.receipts.provider")}</dt>
            <dd>
              {receipt.mode.provider_id}
              {receipt.mode.model_id ? " · " + receipt.mode.model_id : ""}
            </dd>
          </>
        ) : null}
      </dl>

      <div>
        <h4 className="history-receipt-subtitle">
          {t("settings.history.receipts.contextSources")}
        </h4>
        <ul className="history-receipt-list history-receipt-list--pairs">
          {Object.entries(receipt.context.sources).map(
            ([source, sourceStatus]) => (
              <li key={source}>
                <span>
                  {t("settings.history.receipts.contextSource." + source)}
                </span>
                <span>
                  {t("settings.history.receipts.contextStatus." + sourceStatus)}
                </span>
              </li>
            ),
          )}
        </ul>
      </div>

      <div>
        <h4 className="history-receipt-subtitle">
          {t("settings.history.receipts.deliveryAttempts")}
        </h4>
        {receipt.delivery_attempts.length === 0 ? (
          <p className="history-receipt-empty">
            {t("settings.history.receipts.noDeliveryAttempts")}
          </p>
        ) : (
          <ul className="history-receipt-list">
            {receipt.delivery_attempts.map((attempt) => (
              <li key={attempt.id}>
                <span>
                  {t(
                    "settings.history.receipts.deliveryMethod." +
                      attempt.delivery.method,
                  )}
                </span>
                <span>
                  {t(
                    "settings.history.receipts.deliveryOutcome." +
                      attempt.delivery.outcome,
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
