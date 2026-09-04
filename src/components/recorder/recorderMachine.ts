import type {
  RecorderFailureCode,
  RecorderPhase,
  RecorderPreflight,
  RecorderSnapshot,
} from "@/bindings";

export type RecorderPermission = "screen" | "camera" | "microphone";

export interface RecorderUiState {
  snapshot: RecorderSnapshot;
  preflight: RecorderPreflight | null;
  permission: RecorderPermission | null;
  permissionRequested: boolean;
  revealFailed: boolean;
}

const emptySnapshot = (): RecorderSnapshot => ({
  phase: "checking",
  elapsedMs: 0,
  screenSelected: false,
  droppedVideoFrames: 0,
  outputPath: null,
  width: null,
  height: null,
  failure: null,
});

export const initialRecorderState = (): RecorderUiState => ({
  snapshot: emptySnapshot(),
  preflight: null,
  permission: null,
  permissionRequested: false,
  revealFailed: false,
});

export type RecorderAction =
  | { type: "checking" }
  | { type: "preflight"; preflight: RecorderPreflight }
  | { type: "permission"; permission: RecorderPermission; requested: boolean }
  | { type: "snapshot"; snapshot: RecorderSnapshot }
  | { type: "failure"; failure: RecorderFailureCode }
  | { type: "phase"; phase: RecorderPhase }
  | { type: "reveal-failed" }
  | { type: "clear-failure" }
  | { type: "reset" };

const failureSnapshot = (
  snapshot: RecorderSnapshot,
  failure: RecorderFailureCode,
): RecorderSnapshot => ({ ...snapshot, phase: "failed", failure });

const idleSnapshot = (snapshot: RecorderSnapshot): RecorderSnapshot => ({
  ...snapshot,
  phase: "idle",
  failure: null,
  elapsedMs: 0,
  screenSelected: false,
});

const stateFromSnapshot = (
  state: RecorderUiState,
  snapshot: RecorderSnapshot,
): RecorderUiState => {
  if (snapshot.failure === "sourceSelectionCancelled") {
    return {
      ...state,
      snapshot: idleSnapshot(snapshot),
      permission: null,
      permissionRequested: false,
      revealFailed: false,
    };
  }

  /* The backend routes every permission code to the Permission phase, so a
   * denied permission arrives as the snapshot's failure rather than a separate
   * field. Deriving it here is what makes the notice, the grant button and the
   * Settings pane name the permission the user actually has to grant. */
  return {
    ...state,
    snapshot,
    permission: permissionForFailure(snapshot.failure),
    permissionRequested: false,
    revealFailed: false,
  };
};

export const recorderReducer = (
  state: RecorderUiState,
  action: RecorderAction,
): RecorderUiState => {
  switch (action.type) {
    case "checking":
      return {
        ...state,
        snapshot: { ...state.snapshot, phase: "checking", failure: null },
        permission: null,
        permissionRequested: false,
        revealFailed: false,
      };
    case "preflight": {
      if (action.preflight.availability === "unsupported") {
        return {
          ...state,
          preflight: action.preflight,
          snapshot: failureSnapshot(state.snapshot, "unsupported"),
          permission: null,
          permissionRequested: false,
          revealFailed: false,
        };
      }
      if (action.preflight.startAvailability === "captureBusy") {
        return {
          ...state,
          preflight: action.preflight,
          snapshot: failureSnapshot(state.snapshot, "captureBusy"),
          permission: null,
          permissionRequested: false,
          revealFailed: false,
        };
      }
      return {
        ...state,
        preflight: action.preflight,
        snapshot: idleSnapshot(state.snapshot),
        permission: null,
        permissionRequested: false,
        revealFailed: false,
      };
    }
    case "permission":
      return {
        ...state,
        snapshot: { ...state.snapshot, phase: "permission", failure: null },
        permission: action.permission,
        permissionRequested: action.requested,
      };
    case "snapshot":
      return stateFromSnapshot(state, action.snapshot);
    case "failure":
      return {
        ...state,
        snapshot: failureSnapshot(state.snapshot, action.failure),
        permission: null,
        permissionRequested: false,
      };
    case "phase":
      return {
        ...state,
        snapshot: { ...state.snapshot, phase: action.phase, failure: null },
      };
    case "reveal-failed":
      return { ...state, revealFailed: true };
    case "clear-failure":
      return {
        ...state,
        snapshot: idleSnapshot(state.snapshot),
        permission: null,
        permissionRequested: false,
        revealFailed: false,
      };
    case "reset":
      return initialRecorderState();
  }
};

export const recorderFailureKey = {
  unsupported: "recorder.error.unsupported",
  captureBusy: "recorder.error.captureBusy",
  screenPermissionDenied: "recorder.error.screenPermissionDenied",
  cameraPermissionDenied: "recorder.error.cameraPermissionDenied",
  microphonePermissionDenied: "recorder.error.microphonePermissionDenied",
  sourceSelectionCancelled: "recorder.error.sourceSelectionCancelled",
  sourceUnavailable: "recorder.error.sourceUnavailable",
  cameraUnavailable: "recorder.error.cameraUnavailable",
  microphoneUnavailable: "recorder.error.microphoneUnavailable",
  streamFailed: "recorder.error.streamFailed",
  timestampDiscontinuity: "recorder.error.timestampDiscontinuity",
  writerFailed: "recorder.error.writerFailed",
  outputFinalizeFailed: "recorder.error.outputFinalizeFailed",
  outputCommitFailed: "recorder.error.outputCommitFailed",
} as const satisfies Record<RecorderFailureCode, string>;

export const recorderFailureRecovery = {
  unsupported: "done",
  captureBusy: "retry",
  screenPermissionDenied: "permission",
  cameraPermissionDenied: "permission",
  microphonePermissionDenied: "permission",
  sourceSelectionCancelled: "choose",
  sourceUnavailable: "choose",
  cameraUnavailable: "retry",
  microphoneUnavailable: "retry",
  streamFailed: "retry",
  timestampDiscontinuity: "retry",
  writerFailed: "retry",
  outputFinalizeFailed: "retry",
  outputCommitFailed: "retry",
} as const satisfies Record<
  RecorderFailureCode,
  "done" | "permission" | "choose" | "retry"
>;

export const recorderCommandErrorFallback = (
  latestNativeSnapshot: RecorderSnapshot | null,
): RecorderFailureCode | null =>
  latestNativeSnapshot !== null && latestNativeSnapshot.failure !== null
    ? null
    : "streamFailed";

export const permissionForFailure = (
  failure: RecorderFailureCode | null | undefined,
): RecorderPermission | null => {
  switch (failure) {
    case "screenPermissionDenied":
      return "screen";
    case "cameraPermissionDenied":
      return "camera";
    case "microphonePermissionDenied":
      return "microphone";
    default:
      return null;
  }
};

/* One decision per phase, total over RecorderPhase like the two failure maps
 * above: a new phase fails the build until both answers are given, instead of
 * silently becoming dismissible mid-capture. */
const phaseCapabilities = {
  checking: { closable: true, capture: false },
  permission: { closable: true, capture: false },
  idle: { closable: true, capture: false },
  selectingSource: { closable: false, capture: false },
  previewing: { closable: true, capture: true },
  starting: { closable: false, capture: true },
  recording: { closable: false, capture: true },
  paused: { closable: false, capture: true },
  finalizing: { closable: false, capture: true },
  saved: { closable: true, capture: true },
  failed: { closable: true, capture: false },
} as const satisfies Record<
  RecorderPhase,
  { closable: boolean; capture: boolean }
>;

export const canCloseRecorder = (phase: RecorderPhase): boolean =>
  phaseCapabilities[phase].closable;

export const recorderHasCapture = (snapshot: RecorderSnapshot): boolean =>
  snapshot.screenSelected || phaseCapabilities[snapshot.phase].capture;
