import React, { useEffect, useRef, useState } from "react";
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
import { AudioPlayer } from "../../ui/AudioPlayer";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Input";

export type HistoryTextView = "processed" | "raw";

interface IconButtonProps {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  active?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}

const IconButton: React.FC<IconButtonProps> = ({
  onClick,
  title,
  disabled,
  active,
  pressed,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-pressed={pressed}
    aria-label={title}
    className={`flex cursor-pointer items-center justify-center rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:text-text-tertiary/50 ${
      active
        ? "text-accent hover:bg-hover"
        : "text-text-secondary hover:bg-hover hover:text-text-primary"
    }`}
    title={title}
  >
    {children}
  </button>
);

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
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={onSave} disabled={!ready || saving}>
            {t("settings.history.correction.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          value={spoken}
          onChange={(event) => onSpokenChange(event.target.value)}
          placeholder={t("settings.history.correction.spokenPlaceholder")}
          aria-label={t("settings.history.correction.spoken")}
          disabled={saving}
        />
        <Input
          value={written}
          onChange={(event) => onWrittenChange(event.target.value)}
          placeholder={t("settings.history.correction.writtenPlaceholder")}
          aria-label={t("settings.history.correction.written")}
          disabled={saving}
        />
        {ready && (
          <p className="rounded-md border border-border bg-subtle px-3 py-2 text-sm text-text-primary">
            {t("settings.history.correction.preview", {
              spoken: spoken.trim(),
              written: written.trim(),
            })}
          </p>
        )}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-text-primary">
            {t("settings.history.correction.scope")}
          </legend>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="radio"
              name={`history-correction-scope-${entryId}`}
              checked={scope === "current_mode"}
              onChange={() => onScopeChange("current_mode")}
              disabled={saving}
            />
            {t("settings.history.correction.currentMode")}
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
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
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionSpoken, setCorrectionSpoken] = useState("");
  const [correctionWritten, setCorrectionWritten] = useState("");
  const [correctionScope, setCorrectionScope] =
    useState<CorrectionScope>("current_mode");
  const [savingCorrection, setSavingCorrection] = useState(false);
  const copiedTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimerRef.current), []);

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

  const handleDeleteEntry = async () => {
    try {
      await deleteAudio(entry.id);
    } catch (error) {
      console.error("Failed to delete entry:", error);
      toast.error(t("settings.history.deleteError"));
    }
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
    <div className="flex flex-col gap-3 px-4 py-3">
      <HistoryEntrySummary
        entry={entry}
        latestReceipt={latestReceipt}
        duration={duration}
        noSpeechCaptured={noSpeechCaptured}
        hasText={hasText}
        retrying={retrying}
        showCopied={showCopied}
        onCopy={() => void handleCopyText()}
        onOpenCorrection={() => setCorrectionOpen(true)}
        onToggleSaved={() => void onToggleSaved(entry.id)}
        onRetry={() => void handleRetranscribe()}
        onDelete={() => void handleDeleteEntry()}
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
  );
};


interface HistoryEntrySummaryProps {
  entry: HistoryEntry;
  latestReceipt: HistoryRunReceipt | null;
  duration: string | null;
  noSpeechCaptured: boolean;
  hasText: boolean;
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

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{formattedDate}</p>
        {latestReceipt ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {noSpeechCaptured ? (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary">
                {t("errors.noSpeechDetectedTitle")}
              </span>
            ) : null}
            {duration ? (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary">
                {t("settings.history.receipts.duration", { duration })}
              </span>
            ) : null}
            {latestReceipt.word_count !== null ? (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary">
                {t("settings.history.receipts.words", {
                  count: latestReceipt.word_count,
                })}
              </span>
            ) : null}
            {latestReceipt.source_kind ? (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary">
                {t(
                  "settings.history.receipts.source." + latestReceipt.source_kind,
                )}
              </span>
            ) : null}
            <span className="max-w-full truncate rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary">
              {t("settings.history.receipts.mode", {
                mode: latestReceipt.mode.mode_id,
              })}
            </span>
            <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary">
              {t(
                "settings.history.receipts.engine." +
                  latestReceipt.mode.engine_requested,
              )}
            </span>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">
        <IconButton
          onClick={onCopy}
          disabled={!hasText || retrying}
          title={t("settings.history.copyToClipboard")}
        >
          {showCopied ? (
            <Check width={16} height={16} />
          ) : (
            <Copy width={16} height={16} />
          )}
        </IconButton>
        <IconButton
          onClick={onOpenCorrection}
          disabled={!hasText || retrying}
          title={t("settings.history.correction.add")}
        >
          <Pencil width={16} height={16} />
        </IconButton>
        <IconButton
          onClick={onToggleSaved}
          disabled={retrying}
          active={entry.saved}
          pressed={entry.saved}
          title={
            entry.saved
              ? t("settings.history.unsave")
              : t("settings.history.save")
          }
        >
          <Star
            width={16}
            height={16}
            fill={entry.saved ? "currentColor" : "none"}
          />
        </IconButton>
        <IconButton
          onClick={onRetry}
          disabled={retrying}
          title={t("settings.history.retranscribe")}
        >
          <RotateCcw
            width={16}
            height={16}
            className={retrying ? "history-retry-spin" : undefined}
          />
        </IconButton>
        <IconButton
          onClick={onDelete}
          disabled={retrying}
          title={t("settings.history.delete")}
        >
          <Trash2 width={16} height={16} />
        </IconButton>
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
      <p
        className={"pb-1 text-sm " +
          (retrying
            ? "history-transcribing"
            : hasText
              ? "cursor-text break-words whitespace-pre-wrap text-text-primary select-text"
              : "text-text-tertiary")}
      >
        {retrying
          ? t("settings.history.transcribing")
          : hasText
            ? shownText
            : noSpeechCaptured
              ? t("errors.noSpeechDetected")
              : t("settings.history.transcriptionFailed")}
      </p>

      {processedTextMissing && !retrying ? (
        <p className="text-xs text-text-tertiary">
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
    <div className="border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-8 items-center gap-1 rounded-md px-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
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
      <div className="mt-2 divide-y divide-border border-t border-border text-sm">
        <p role="status" className="py-3 text-text-secondary">
          {t("settings.history.receipts.loading")}
        </p>
      </div>
    );
  }

  if (receipts === null) {
    return (
      <div className="mt-2 divide-y divide-border border-t border-border text-sm">
        <p className="py-3 text-text-secondary">
          {t("settings.history.receipts.unavailable")}
        </p>
      </div>
    );
  }

  if (receipts.length === 0) {
    return (
      <div className="mt-2 divide-y divide-border border-t border-border text-sm">
        <p className="py-3 text-text-secondary">
          {t("settings.history.receipts.none")}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 divide-y divide-border border-t border-border text-sm">
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

  return (
    <section className="space-y-3 py-3">
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary">
          {t("settings.history.receipts.mode", {
            mode: receipt.mode.mode_id,
          })}
        </span>
        <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary">
          {t("settings.history.receipts.revision", {
            revision: receipt.mode.settings_revision,
          })}
        </span>
        <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary">
          {t(
            "settings.history.receipts.engine." + receipt.mode.engine_requested,
          )}
        </span>
        {receipt.source_kind ? (
          <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary">
            {t("settings.history.receipts.source." + receipt.source_kind)}
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
        {receipt.duration_ms !== null ? (
          <>
            <dt className="text-text-tertiary">
              {t("settings.history.receipts.durationLabel")}
            </dt>
            <dd className="text-text-primary">
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
            <dt className="text-text-tertiary">
              {t("settings.history.receipts.wordsLabel")}
            </dt>
            <dd className="text-text-primary">{receipt.word_count}</dd>
          </>
        ) : null}
        <dt className="text-text-tertiary">
          {t("settings.history.receipts.presetLabel")}
        </dt>
        <dd className="text-text-primary">
          {t(
            "settings.history.receipts.preset." + receipt.mode.prompt_preset,
          )}
        </dd>
        <dt className="text-text-tertiary">
          {t("settings.history.receipts.contextPolicy")}
        </dt>
        <dd className="text-text-primary">
          {t(
            "settings.history.receipts.contextPolicyValues." +
              receipt.mode.context_policy,
          )}
        </dd>
        {receipt.mode.provider_id ? (
          <>
            <dt className="text-text-tertiary">
              {t("settings.history.receipts.provider")}
            </dt>
            <dd className="break-words text-text-primary">
              {receipt.mode.provider_id}
              {receipt.mode.model_id
                ? " · " + receipt.mode.model_id
                : ""}
            </dd>
          </>
        ) : null}
      </dl>

      <div>
        <h4 className="text-xs font-medium text-text-primary">
          {t("settings.history.receipts.contextSources")}
        </h4>
        <ul className="mt-2 grid grid-cols-1 gap-1 text-xs text-text-secondary sm:grid-cols-2">
          {Object.entries(receipt.context.sources).map(
            ([source, sourceStatus]) => (
              <li key={source} className="flex justify-between gap-2">
                <span>
                  {t("settings.history.receipts.contextSource." + source)}
                </span>
                <span className="text-text-primary">
                  {t("settings.history.receipts.contextStatus." + sourceStatus)}
                </span>
              </li>
            ),
          )}
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-medium text-text-primary">
          {t("settings.history.receipts.deliveryAttempts")}
        </h4>
        {receipt.delivery_attempts.length === 0 ? (
          <p className="mt-1 text-xs text-text-secondary">
            {t("settings.history.receipts.noDeliveryAttempts")}
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-text-secondary">
            {receipt.delivery_attempts.map((attempt) => (
              <li key={attempt.id} className="flex flex-wrap gap-x-1">
                <span>
                  {t(
                    "settings.history.receipts.deliveryMethod." +
                      attempt.delivery.method,
                  )}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-text-primary">
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
