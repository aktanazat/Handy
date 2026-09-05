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
import { cn } from "@/lib/cn";
import { FactChip, Microlabel } from "@/components/settings/rows";
import {
  captureCompletenessKey,
  formatMeetingOffset,
  meetingPhaseKey,
  processingStatusKey,
  sourceAvailabilityKey,
  sourceKey,
} from "./meetingUtils";

/* Every meeting state reads as a word. The only second channel is a 6px
 * static mark beside "Recording", the one state where a misread costs the
 * person a meeting. Nothing here animates, so reduced motion has nothing to
 * switch off and the sentence still reads in greyscale. */

const STATUS_TONES = {
  neutral: "text-gray-1000",
  muted: "text-gray-800",
  warning: "text-amber-900",
  danger: "text-red-900",
} as const;

type StatusTone = keyof typeof STATUS_TONES;

interface StatusWordProps {
  tone?: StatusTone;
  /** Announce transitions on surfaces that own one meeting, never in lists. */
  live?: "off" | "polite";
  children: React.ReactNode;
  className?: string;
}

/* State as words. There is no green in the palette and none is wanted: a
 * settled state is type at full contrast, not a colour nobody can name. */
const StatusWord: React.FC<StatusWordProps> = ({
  tone = "muted",
  live = "off",
  children,
  className,
}) => (
  <span
    role={live === "off" ? undefined : "status"}
    aria-live={live === "off" ? undefined : live}
    className={cn("text-[13px] leading-[18px]", STATUS_TONES[tone], className)}
  >
    {children}
  </span>
);

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
  className,
}) => {
  const { t } = useTranslation();
  const capturing = phase === "capturing_recording";

  return (
    <StatusWord
      tone={PHASE_TONES[phase]}
      className={cn(
        "inline-flex items-center gap-1.5",
        capturing && "font-medium",
        className,
      )}
    >
      {capturing ? (
        <span
          aria-hidden="true"
          className="size-1.5 flex-none rounded-xs bg-red-700"
        />
      ) : null}
      {t(meetingPhaseKey(phase))}
    </StatusWord>
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
> = ({ completeness, className }) => {
  const { t } = useTranslation();

  return (
    <StatusWord tone={COMPLETENESS_TONES[completeness]} className={className}>
      {t(captureCompletenessKey(completeness))}
    </StatusWord>
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
  className,
}) => {
  const { t } = useTranslation();
  const failed = status.kind === "failed" || status.kind === "cancelled";

  return (
    <StatusWord
      tone={failed ? "danger" : "muted"}
      live={live}
      className={className}
    >
      {t(processingStatusKey(status))}
    </StatusWord>
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

export interface SourceAvailabilityTextProps {
  availability: SourceAvailability;
  /** Announce a refreshed preflight result without moving focus. */
  live?: "off" | "polite";
  className?: string;
}

export const SourceAvailabilityText: React.FC<SourceAvailabilityTextProps> = ({
  availability,
  live = "off",
  className,
}) => {
  const { t } = useTranslation();

  return (
    <StatusWord
      tone={AVAILABILITY_TONES[availability]}
      live={live}
      className={className}
    >
      {t(sourceAvailabilityKey(availability))}
    </StatusWord>
  );
};

const HEALTH_TONES = {
  not_started: "muted",
  starting: "muted",
  healthy: "muted",
  paused: "muted",
  degraded: "warning",
  failed: "danger",
  stopped: "muted",
} as const satisfies Record<SourceHealth, StatusTone>;

/** The one word a person reads for a source, out of the two states the
 * backend keeps: `health` is what it is doing, and it is only the answer when
 * `availability` says it is allowed to do anything at all.
 *
 * "Healthy" and "Not started" describe a subsystem; "Recording" and "Ready"
 * describe a recording. The three the wire has no human word for keep theirs:
 * a paused source is paused, a failed one failed, and both read as what
 * happened rather than as a status code. */
const SOURCE_STATE_KEYS = {
  not_started: "meetings.status.state.ready",
  starting: "meetings.health.starting",
  healthy: "meetings.status.state.recording",
  paused: "meetings.health.paused",
  degraded: "meetings.status.state.recording",
  failed: "meetings.health.failed",
  stopped: "meetings.status.state.recorded",
} as const satisfies Record<SourceHealth, string>;

interface MeetingSourceItemProps {
  source: MeetingSourceSnapshot;
  elapsedOffsetNs: number | null;
  showTelemetry: boolean;
}

/* One capture source per row, flat on a hairline: what it is, and one word
 * for how it went. Rows, not tiles — two cards side by side implied a
 * comparison that does not exist.
 *
 * What a gap count is worth saying: the store counts one row per interruption
 * on that track (`meeting_source_gaps`, `store.rs`), which is a number of
 * events and not a duration — 28,106 of them was the truest and least useful
 * sentence on the screen. What it proves is that audio is missing, so that is
 * what the row says; the moments themselves are listed underneath it, where
 * they carry the times and the measured loss.
 *
 * There is no level meter here and there cannot be one: capture publishes
 * availability, health, a durable offset and that gap count, and no signal
 * amplitude at any point in the pipeline. A moving bar would be drawn from
 * nothing. "SIGNAL Not reported" is the honest version of that fact, set as a
 * measurement pair on the live surface, which is why it stays. */
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
  const blocked = source.availability !== "available";

  return (
    <li
      data-slot="meeting-source"
      data-source={source.source_kind}
      className="flex flex-col gap-1 px-6 py-3.5"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[14px] leading-[21px] font-medium text-gray-1000">
            {t(sourceKey(source.source_kind))}
          </span>
          {source.required ? (
            <Microlabel className="flex-none">
              {t("meetings.status.required", "Required")}
            </Microlabel>
          ) : null}
        </h3>
        <StatusWord
          tone={
            blocked
              ? AVAILABILITY_TONES[source.availability]
              : HEALTH_TONES[source.health]
          }
          className="flex-none"
        >
          {blocked
            ? t(sourceAvailabilityKey(source.availability))
            : t(SOURCE_STATE_KEYS[source.health])}
        </StatusWord>
      </div>
      {source.gap_count > 0 ? (
        <StatusWord tone="warning">
          {t("meetings.status.someAudioMissing")}
        </StatusWord>
      ) : null}
      {showTelemetry ? (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <FactChip
            label={t("meetings.live.signal")}
            value={t("meetings.live.notReported")}
          />
          <FactChip
            label={t("meetings.live.durabilityLag")}
            value={
              durableLagNs === null
                ? t("meetings.live.notReported")
                : t("meetings.live.behind", {
                    duration: formatMeetingOffset(durableLagNs),
                  })
            }
          />
        </p>
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
  <ul role="list" aria-label={label} className="divide-y divide-gray-alpha-400">
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
