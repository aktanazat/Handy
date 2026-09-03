import React from "react";
import { useTranslation } from "react-i18next";
import type { CaptureStatus, HistoryRunReceipt } from "@/bindings";
import {
  formatDurationShort,
  formatEntryTimestamp,
  formatRealtimeFactor,
} from "@/lib/utils/format";
import { Microlabel } from "../rows";
import { HistoryReceiptTable } from "./HistoryReceiptTable";

/* The precision the backend itself reports on its capture-level log receipt
 * (`peak={:.4} rms={:.4}`). Fewer digits turn a dead input (0.0119) and a
 * quiet room (0.0024) into the same printed number. */
const AMPLITUDE_DIGITS = 4;

/* The state word carries the only colour, and only when the state is not the
 * ordinary one. A completed capture is what every capture is meant to be, so
 * it reads in plain ink; tinting it would spend the reader's attention on the
 * outcome that needs none. A no-speech capture is deliberately neither red nor
 * amber — it is a real outcome of a real capture, and colouring it as a
 * failure would claim one the app cannot name. The peak/rms rows above it are
 * the evidence. */
const CAPTURE_STATUS_TONE = {
  complete: "text-gray-1000",
  truncated: "text-amber-900",
  no_speech_detected: "text-gray-800",
} satisfies Record<CaptureStatus, string>;

interface HistoryReceiptCardProps {
  receipt: HistoryRunReceipt;
}

export const HistoryReceiptCard: React.FC<HistoryReceiptCardProps> = ({
  receipt,
}) => {
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
      label: t("settings.history.receipts.revisionLabel", "Settings version"),
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
      label: t("settings.history.level.rms", "average"),
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
              className={`border-t border-gray-alpha-400 py-1 text-end text-[11px] break-words tabular-nums first-of-type:border-t-0 ${
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
