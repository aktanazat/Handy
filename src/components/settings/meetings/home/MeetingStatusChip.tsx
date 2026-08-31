import React from "react";
import { useTranslation } from "react-i18next";
import type { MeetingPhase, ProcessingStatus } from "@/bindings";
import { cn } from "@/lib/cn";

export type MeetingCardStatus =
  | "live"
  | "processing"
  | "ready"
  | "needs_attention";

const STATUS_CLASSES = {
  live: "bg-blue-100 text-blue-900",
  processing: "bg-amber-100 text-amber-900",
  ready: "bg-[var(--green-100)] text-[var(--green-900)]",
  needs_attention: "bg-red-100 text-red-900",
} as const satisfies Record<MeetingCardStatus, string>;

export const meetingCardStatus = (
  phase: MeetingPhase,
  processing: ProcessingStatus,
): MeetingCardStatus => {
  if (
    phase === "recovery_required" ||
    processing.kind === "failed" ||
    processing.kind === "cancelled"
  ) {
    return "needs_attention";
  }
  if (
    phase === "starting" ||
    phase === "capturing_recording" ||
    phase === "capturing_pausing" ||
    phase === "capturing_paused" ||
    phase === "capturing_resuming"
  ) {
    return "live";
  }
  if (phase === "review_ready" && processing.kind === "succeeded") {
    return "ready";
  }
  return "processing";
};

interface MeetingStatusChipProps {
  phase: MeetingPhase;
  processing: ProcessingStatus;
}

export const MeetingStatusChip: React.FC<MeetingStatusChipProps> = ({
  phase,
  processing,
}) => {
  const { t } = useTranslation();
  const status = meetingCardStatus(phase, processing);

  return (
    <span
      data-slot="meeting-status"
      data-status={status}
      className={cn(
        "inline-flex flex-none items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] leading-4",
        STATUS_CLASSES[status],
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {t(`meetings.list.status.${status}`)}
    </span>
  );
};
