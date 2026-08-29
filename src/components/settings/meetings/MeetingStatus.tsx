import React from "react";
import { useTranslation } from "react-i18next";
import type {
  CaptureCompleteness,
  MeetingPhase,
  MeetingSourceSnapshot,
  ProcessingStatus,
  SourceAvailability,
  SourceHealth,
} from "@/bindings";
import { StatusText, type StatusTone } from "../../ui";
import {
  captureCompletenessKey,
  formatMeetingOffset,
  meetingPhaseKey,
  meetingRowStatus,
  meetingRowStatusKey,
  processingStatusKey,
  sourceAvailabilityKey,
  sourceHealthKey,
  sourceKey,
} from "./meetingUtils";

/* Every meeting state reads as a word. The only second channel is a 6px
 * static mark beside "Recording", the one state where a misread costs the
 * person a meeting. Nothing here animates, so reduced motion has nothing to
 * switch off and the sentence still reads in greyscale. */

const PHASE_TONES = {
  preflight: "muted",
  starting: "muted",
  capturing_recording: "danger",
  capturing_pausing: "muted",
  capturing_paused: "muted",
  capturing_resuming: "muted",
  stopping: "muted",
  processing: "muted",
  review_ready: "neutral",
  recovery_required: "warning",
  deleting: "muted",
} as const satisfies Record<MeetingPhase, StatusTone>;

export interface MeetingPhaseTextProps {
  phase: MeetingPhase;
  className?: string;
}

export const MeetingPhaseText: React.FC<MeetingPhaseTextProps> = ({
  phase,
  className = "",
}) => {
  const { t } = useTranslation();
  const capturing = phase === "capturing_recording";

  return (
    <StatusText
      tone={PHASE_TONES[phase]}
      className={`inline-flex items-center gap-1.5 ${capturing ? "font-semibold" : ""} ${className}`}
    >
      {capturing ? (
        <span
          aria-hidden="true"
          className="size-1.5 flex-none rounded-xs bg-danger"
        />
      ) : null}
      {t(meetingPhaseKey(phase))}
    </StatusText>
  );
};

const COMPLETENESS_TONES = {
  not_started: "muted",
  complete: "muted",
  partial: "warning",
} as const satisfies Record<CaptureCompleteness, StatusTone>;

export interface CaptureCompletenessTextProps {
  completeness: CaptureCompleteness;
  className?: string;
}

export const CaptureCompletenessText: React.FC<
  CaptureCompletenessTextProps
> = ({ completeness, className = "" }) => {
  const { t } = useTranslation();

  return (
    <StatusText tone={COMPLETENESS_TONES[completeness]} className={className}>
      {t(captureCompletenessKey(completeness))}
    </StatusText>
  );
};

export interface ProcessingStatusTextProps {
  status: ProcessingStatus;
  /** Announce transitions on surfaces that own one meeting, never in lists. */
  live?: "off" | "polite";
  className?: string;
}

export const ProcessingStatusText: React.FC<ProcessingStatusTextProps> = ({
  status,
  live = "off",
  className = "",
}) => {
  const { t } = useTranslation();
  const failed = status.kind === "failed" || status.kind === "cancelled";

  return (
    <StatusText
      tone={failed ? "danger" : "muted"}
      live={live}
      className={className}
    >
      {t(processingStatusKey(status))}
    </StatusText>
  );
};

const AVAILABILITY_TONES = {
  available: "muted",
  permission_required: "warning",
  permission_denied: "danger",
  device_unavailable: "danger",
  unsupported_platform: "warning",
  storage_unavailable: "danger",
  unknown: "muted",
} as const satisfies Record<SourceAvailability, StatusTone>;

const HEALTH_TONES = {
  not_started: "muted",
  starting: "muted",
  healthy: "muted",
  paused: "muted",
  degraded: "warning",
  failed: "danger",
  stopped: "muted",
} as const satisfies Record<SourceHealth, StatusTone>;

interface MeetingSourceItemProps {
  source: MeetingSourceSnapshot;
  elapsedOffsetNs: number | null;
  showTelemetry: boolean;
}

/* One capture source per row, flat on a hairline: name, what the backend
 * reports about it, and its health. Rows, not tiles — two cards side by side
 * implied a comparison that does not exist.
 *
 * There is no level meter here and there cannot be one: capture publishes
 * availability, health, a durable offset and a gap count, and no signal
 * amplitude at any point in the pipeline. A moving bar would be drawn from
 * nothing. "Signal — Not reported" is the honest version of that fact and is
 * why it stays. */
const MeetingSourceItem: React.FC<MeetingSourceItemProps> = ({
  source,
  elapsedOffsetNs,
  showTelemetry,
}) => {
  const { t } = useTranslation();
  const durableLagNs =
    source.last_durable_offset_ns === null || elapsedOffsetNs === null
      ? null
      : Math.max(0, elapsedOffsetNs - source.last_durable_offset_ns);

  return (
    <li className="meeting-row-stacked" data-source={source.source_kind}>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="meeting-row-label">
          {t(sourceKey(source.source_kind))}
        </h3>
        <StatusText tone={HEALTH_TONES[source.health]} className="flex-none">
          {t(sourceHealthKey(source.health))}
        </StatusText>
      </div>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <StatusText tone={AVAILABILITY_TONES[source.availability]}>
          {t(sourceAvailabilityKey(source.availability))}
        </StatusText>
        {source.required ? (
          <span className="microlabel">
            {t("meetings.status.required", "Required")}
          </span>
        ) : null}
        {source.gap_count > 0 ? (
          <StatusText tone="warning" className="tabular-nums">
            {t("meetings.status.gapCount", "Gaps: {{total}}", {
              total: source.gap_count,
            })}
          </StatusText>
        ) : null}
      </p>
      {showTelemetry ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          <div>
            <dt className="microlabel">{t("meetings.live.signal")}</dt>
            <dd className="text-[12.5px] leading-[18px] text-text-secondary">
              {t("meetings.live.notReported")}
            </dd>
          </div>
          <div>
            <dt className="microlabel">{t("meetings.live.durabilityLag")}</dt>
            <dd className="text-[12.5px] leading-[18px] text-text-secondary tabular-nums">
              {durableLagNs === null
                ? t("meetings.live.notReported")
                : t("meetings.live.behind", {
                    duration: formatMeetingOffset(durableLagNs),
                  })}
            </dd>
          </div>
        </dl>
      ) : null}
    </li>
  );
};

export interface MeetingSourceListProps {
  sources: MeetingSourceSnapshot[];
  label: string;
  elapsedOffsetNs?: number | null;
  showTelemetry?: boolean;
}

export const MeetingSourceList: React.FC<MeetingSourceListProps> = ({
  sources,
  label,
  elapsedOffsetNs = null,
  showTelemetry = false,
}) => (
  <ul role="list" aria-label={label} className="meeting-rows">
    {sources.map((source) => (
      <MeetingSourceItem
        key={source.source_kind}
        source={source}
        elapsedOffsetNs={elapsedOffsetNs}
        showTelemetry={showTelemetry}
      />
    ))}
  </ul>
);

/* The one chip a meetings-list row carries. Four of the five states get a
 * semaphore colour because each one changes what a person does next: live
 * capture is the only state where walking away loses the meeting, a failed run
 * is the only state that needs a decision, a running one is the only state
 * worth waiting on, and ready is the only state worth opening. The fifth,
 * `pending`, is a phase nobody acts on from a list, so it stays greyscale.
 *
 * Recording is filled, the rest are outlined: a filled chip on every row would
 * make a page of finished meetings read as urgent. */
export interface MeetingStatusChipProps {
  phase: MeetingPhase;
  processing: ProcessingStatus;
}

export const MeetingStatusChip: React.FC<MeetingStatusChipProps> = ({
  phase,
  processing,
}) => {
  const { t } = useTranslation();
  const status = meetingRowStatus(phase, processing);

  return (
    <span
      className="meeting-status-chip"
      data-status={status}
      data-fill={status === "recording" ? "solid" : "outline"}
    >
      {t(meetingRowStatusKey(status, phase, processing))}
    </span>
  );
};
