import React from "react";
import { useTranslation } from "react-i18next";
import type { MeetingPhase, ProcessingStatus } from "@/bindings";
import { cn } from "@/lib/cn";

export type MeetingCardStatus =
  | "live"
  | "processing"
  | "ready"
  | "needs_attention";

/* The chip is a hairline, never a fill: four filled pills on a list of
 * meetings is four blocks of colour competing with the titles they annotate.
 * Colour survives only where the state is exceptional, and the dot survives
 * only on `live`, which is the one state that is happening right now. */
const STATUS_CLASSES = {
  live: "border-accent-strong text-accent-strong",
  processing: "border-gray-alpha-400 text-gray-900",
  ready: "border-gray-alpha-400 text-gray-900",
  needs_attention: "border-[var(--red-400)] text-red-900",
} as const satisfies Record<MeetingCardStatus, string>;

/**
 * One meeting's state, read from its phase and its recorded processing status
 * and from nothing else.
 *
 * A non-terminal status is never evidence that work is happening: `pending` is
 * what a meeting is born with and what it keeps when the launch that was
 * processing it ends, which is how interrupted meetings used to read
 * "Processing" for days. So the only thing a status decides here is whether
 * processing ended badly; everything else is the phase, which is the one owner
 * of whether a job exists. Startup reconciliation is what makes that reading
 * true: it moves an abandoned meeting to `recovery_required` and gives it a
 * terminal status in the same transaction.
 *
 * The phase mapping is exhaustive on purpose. A catch-all returning
 * "processing" is the shape of the original bug — anything unrecognised read
 * as work in flight — so a new phase has to be classified here rather than
 * inheriting that answer.
 */
export const meetingCardStatus = (
  phase: MeetingPhase,
  processing: ProcessingStatus,
): MeetingCardStatus => {
  if (processing.kind === "failed" || processing.kind === "cancelled") {
    return "needs_attention";
  }
  switch (phase) {
    case "starting":
    case "capturing_recording":
    case "capturing_pausing":
    case "capturing_paused":
    case "capturing_resuming":
      return "live";
    case "preflight":
    case "stopping":
    case "processing":
    case "deleting":
      return "processing";
    case "review_ready":
      return "ready";
    case "recovery_required":
      return "needs_attention";
  }
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
        "inline-flex flex-none items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] leading-4 uppercase",
        "tracking-[0.08em]",
        STATUS_CLASSES[status],
      )}
    >
      {status === "live" && (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      )}
      {t(`meetings.list.status.${status}`)}
    </span>
  );
};
