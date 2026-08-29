import type {
  CaptureCompleteness,
  MeetingCommandError,
  MeetingListFilter,
  MeetingPhase,
  MeetingProvider,
  MeetingReasonCode,
  MeetingStatusFilter,
  MeetingTimeWindow,
  ProcessingStatus,
  SourceAvailability,
  SourceHealth,
  SourceKind,
} from "@/bindings";

export const MEETING_SOURCES: SourceKind[] = ["microphone", "system_audio"];

const MEETING_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatMeetingOffset = (offsetNs: number | null | undefined) => {
  if (offsetNs === null || offsetNs === undefined) {
    return "—";
  }

  const seconds = Math.max(0, Math.floor(offsetNs / 1_000_000_000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
};

export const formatMeetingDate = (timestamp: number) =>
  MEETING_DATE_FORMATTER.format(timestamp);

export const meetingProviderKey = (provider: MeetingProvider) =>
  `meetings.providers.${provider}`;

export const meetingPhaseKey = (phase: MeetingPhase) =>
  `meetings.phases.${phase}`;

export const sourceKey = (source: SourceKind) => `meetings.sources.${source}`;

export const sourceAvailabilityKey = (availability: SourceAvailability) =>
  `meetings.availability.${availability}`;

export const sourceHealthKey = (health: SourceHealth) =>
  `meetings.health.${health}`;

export const captureCompletenessKey = (completeness: CaptureCompleteness) =>
  `meetings.completeness.${completeness}`;

export const processingStatusKey = (status: ProcessingStatus) => {
  if (status.kind === "failed") {
    return `meetings.processing.failed.${status.reason}`;
  }

  return `meetings.processing.${status.kind}`;
};

const MEETING_ERROR_KEYS = {
  consent_required: "meetings.errors.consent_required",
  consent_stale: "meetings.errors.consent_stale",
  invalid_transition: "meetings.errors.invalid_transition",
  stale_revision: "meetings.errors.stale_revision",
  capture_lease_busy: "meetings.errors.capture_lease_busy",
  no_source_started: "meetings.errors.no_source_started",
  source_unavailable: "meetings.errors.source_unavailable",
  storage_unavailable: "meetings.errors.storage_unavailable",
  recovery_required: "meetings.errors.recovery_required",
  deletion_in_progress: "meetings.errors.deletion_in_progress",
  not_found: "meetings.errors.not_found",
  invalid_request: "meetings.errors.invalid_request",
  export_cancelled: "meetings.errors.export_cancelled",
  export_failed: "meetings.errors.export_failed",
  local_model_unavailable: "meetings.errors.local_model_unavailable",
  remote_unavailable: "meetings.errors.remote_unavailable",
} as const satisfies Record<MeetingCommandError, string>;

export const meetingErrorKey = (error: MeetingCommandError) =>
  MEETING_ERROR_KEYS[error];

const MEETING_REASON_KEYS = {
  consent_missing: "meetings.reasons.consent_missing",
  consent_stale: "meetings.reasons.consent_stale",
  stale_revision: "meetings.reasons.stale_revision",
  capture_lease_busy: "meetings.reasons.capture_lease_busy",
  source_unavailable: "meetings.reasons.source_unavailable",
  source_start_failed: "meetings.reasons.source_start_failed",
  source_gap: "meetings.reasons.source_gap",
  storage_unavailable: "meetings.reasons.storage_unavailable",
  storage_failure: "meetings.reasons.storage_failure",
  local_model_unavailable: "meetings.reasons.local_model_unavailable",
  recovery_required: "meetings.reasons.recovery_required",
  deleted: "meetings.reasons.deleted",
  invalid_transition: "meetings.reasons.invalid_transition",
  duplicate_operation: "meetings.reasons.duplicate_operation",
} as const satisfies Record<MeetingReasonCode, string>;

export const meetingReasonKey = (reason: MeetingReasonCode) =>
  MEETING_REASON_KEYS[reason];

export const isActiveMeetingPhase = (phase: MeetingPhase) =>
  phase === "capturing_recording" ||
  phase === "capturing_pausing" ||
  phase === "capturing_paused" ||
  phase === "capturing_resuming" ||
  phase === "starting" ||
  phase === "stopping";

export const isPreflightMeetingPhase = (phase: MeetingPhase) =>
  phase === "preflight";

/* ------------------------------------------------------- meetings list row */

/** The one state a list row's chip reports, and the semaphore it reads in. */
export type MeetingRowStatus =
  | "recording"
  | "processing"
  | "ready"
  | "failed"
  | "pending";

/* A row carries one chip, so the chip has to answer the one question a reader
 * is asking: can I read this meeting yet? Precedence runs from the state that
 * costs most to misread down to the state that costs least — live capture,
 * then a run that needs a hand, then a run still going. A partial capture is
 * NOT in here: it is a fact about the sources, and it rides beside them on the
 * row's own source run rather than displacing the chip. */
export const meetingRowStatus = (
  phase: MeetingPhase,
  processing: ProcessingStatus,
): MeetingRowStatus => {
  if (
    phase === "capturing_recording" ||
    phase === "capturing_pausing" ||
    phase === "capturing_paused" ||
    phase === "capturing_resuming"
  ) {
    return "recording";
  }
  if (
    phase === "recovery_required" ||
    processing.kind === "failed" ||
    processing.kind === "cancelled"
  ) {
    return "failed";
  }
  if (
    phase === "processing" ||
    phase === "stopping" ||
    processing.kind === "pending" ||
    processing.kind === "running"
  ) {
    return "processing";
  }
  if (phase === "review_ready") {
    return "ready";
  }
  return "pending";
};

/* The chip's word comes from the state the chip is reading, not from a second
 * label table: a failed run says which failure, and recovery says recovery. */
export const meetingRowStatusKey = (
  status: MeetingRowStatus,
  phase: MeetingPhase,
  processing: ProcessingStatus,
) => {
  if (status === "failed") {
    return phase === "recovery_required"
      ? meetingPhaseKey(phase)
      : processingStatusKey(processing);
  }
  if (status === "recording" || status === "pending") {
    return meetingPhaseKey(phase);
  }
  return `meetings.list.status.${status}`;
};

/** Every status a list filter can ask the store for, in menu order. */
export const MEETING_STATUS_FILTERS: MeetingStatusFilter[] = [
  "any",
  "ready",
  "processing",
  "failed",
];

/** Every window a list filter can ask the store for, in menu order. */
export const MEETING_TIME_WINDOWS: MeetingTimeWindow[] = [
  "any",
  "today",
  "last_7_days",
  "last_30_days",
];

export const meetingStatusFilterKey = (status: MeetingStatusFilter) =>
  `meetings.list.filters.status.${status}`;

export const meetingTimeWindowKey = (window: MeetingTimeWindow) =>
  `meetings.list.filters.time.${window}`;

/** No filter at all: the whole list, newest first. */
export const NO_MEETING_FILTER: MeetingListFilter = {
  status: "any",
  window: "any",
  title_query: "",
};

/** True when `filter` narrows nothing, which is what the Clear control needs
 *  to know and what an empty result has to explain. */
export const isUnfilteredMeetingList = (filter: MeetingListFilter) =>
  (filter.status ?? "any") === "any" &&
  (filter.window ?? "any") === "any" &&
  (filter.title_query ?? "").trim().length === 0;
