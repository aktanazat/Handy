import React from "react";
import { Check, CircleAlert, CircleDashed, Pause, Radio } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CaptureCompleteness,
  MeetingPhase,
  MeetingSourceSnapshot,
  ProcessingStatus,
} from "@/bindings";
import {
  captureCompletenessKey,
  formatMeetingOffset,
  meetingPhaseKey,
  processingStatusKey,
  sourceAvailabilityKey,
  sourceHealthKey,
  sourceKey,
} from "./meetingUtils";

interface MeetingPhaseBadgeProps {
  phase: MeetingPhase;
}

export const MeetingPhaseBadge: React.FC<MeetingPhaseBadgeProps> = ({
  phase,
}) => {
  const { t } = useTranslation();

  return (
    <span className="meeting-status-badge" data-phase={phase}>
      <span className="meeting-status-badge-icon" aria-hidden="true">
        {phase === "capturing_recording" ? (
          <Radio size={13} />
        ) : phase === "capturing_paused" ? (
          <Pause size={12} />
        ) : phase === "review_ready" ? (
          <Check size={13} />
        ) : (
          <CircleDashed size={13} />
        )}
      </span>
      {t(meetingPhaseKey(phase))}
    </span>
  );
};

interface CaptureCompletenessBadgeProps {
  completeness: CaptureCompleteness;
}

export const CaptureCompletenessBadge: React.FC<
  CaptureCompletenessBadgeProps
> = ({ completeness }) => {
  const { t } = useTranslation();

  return (
    <span
      className="meeting-completeness-badge"
      data-completeness={completeness}
    >
      {t(captureCompletenessKey(completeness))}
    </span>
  );
};

interface ProcessingStatusLineProps {
  status: ProcessingStatus;
}

export const ProcessingStatusLine: React.FC<ProcessingStatusLineProps> = ({
  status,
}) => {
  const { t } = useTranslation();
  const failed = status.kind === "failed" || status.kind === "cancelled";

  return (
    <span
      className="meeting-processing-status"
      data-status={status.kind}
      role={failed ? "alert" : undefined}
    >
      {failed ? <CircleAlert size={14} aria-hidden="true" /> : null}
      {t(processingStatusKey(status))}
    </span>
  );
};

interface SourceHealthCardProps {
  source: MeetingSourceSnapshot;
  elapsedOffsetNs?: number | null;
  showTelemetry?: boolean;
}

export const SourceHealthCard: React.FC<SourceHealthCardProps> = ({
  source,
  elapsedOffsetNs = null,
  showTelemetry = false,
}) => {
  const { t } = useTranslation();
  const durableLagNs =
    source.last_durable_offset_ns === null || elapsedOffsetNs === null
      ? null
      : Math.max(0, elapsedOffsetNs - source.last_durable_offset_ns);

  return (
    <section
      className="meeting-source-card"
      data-source={source.source_kind}
      data-health={source.health}
    >
      <div className="meeting-source-card-heading">
        <div>
          <h3>{t(sourceKey(source.source_kind))}</h3>
          <p>{t(sourceAvailabilityKey(source.availability))}</p>
        </div>
        <span className="meeting-source-health">
          {t(sourceHealthKey(source.health))}
        </span>
      </div>
      {showTelemetry ? (
        <div className="meeting-source-telemetry">
          <div
            className="meeting-source-meter"
            aria-label={t("meetings.live.signalUnavailable", {
              source: t(sourceKey(source.source_kind)),
            })}
            data-telemetry="unavailable"
          >
            <span aria-hidden="true" />
          </div>
          <dl className="meeting-source-metrics">
            <div>
              <dt>{t("meetings.live.signal")}</dt>
              <dd>{t("meetings.live.notReported")}</dd>
            </div>
            <div>
              <dt>{t("meetings.live.durabilityLag")}</dt>
              <dd>
                {durableLagNs === null
                  ? t("meetings.live.notReported")
                  : t("meetings.live.behind", {
                      duration: formatMeetingOffset(durableLagNs),
                    })}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </section>
  );
};
