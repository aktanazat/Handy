import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  MeetingNavigationPayload,
  MeetingReviewSnapshot,
} from "@/bindings";
import type {
  MeetingPendingAction,
  MeetingScreen,
  MeetingStartOptions,
} from "../meetingTypes";
import { isPreflightMeetingPhase } from "../meetingUtils";
import type { MeetingStartOptionsBuilder } from "./useMeetingStartSetup";
import type { MeetingSnapshotRead } from "./useMeetingSnapshotReader";

interface MeetingWorkflowState {
  screen: MeetingScreen;
  snapshot: MeetingReviewSnapshot | null;
  pendingAction: MeetingPendingAction | null;
}

type MeetingWorkflowEvent =
  | { type: "show_home" }
  | { type: "show_session"; sessionId: string }
  | { type: "show_loaded_session"; snapshot: MeetingReviewSnapshot }
  | {
      type: "show_gate";
      sessionId: string;
      options: MeetingStartOptions;
    }
  | {
      type: "receive_snapshot";
      sessionId: string;
      snapshot: MeetingReviewSnapshot;
    }
  | { type: "begin_action"; action: MeetingPendingAction }
  | { type: "finish_action"; action: MeetingPendingAction };

const sessionOnScreen = (screen: MeetingScreen) =>
  screen.kind === "home" ? null : screen.sessionId;

const meetingWorkflowReducer = (
  state: MeetingWorkflowState,
  event: MeetingWorkflowEvent,
): MeetingWorkflowState => {
  switch (event.type) {
    case "show_home":
      return { ...state, screen: { kind: "home" }, snapshot: null };
    case "show_session":
      return {
        ...state,
        screen: { kind: "session", sessionId: event.sessionId },
        snapshot:
          sessionOnScreen(state.screen) === event.sessionId
            ? state.snapshot
            : null,
      };
    case "show_loaded_session":
      return {
        ...state,
        screen: {
          kind: "session",
          sessionId: event.snapshot.session.session_id,
        },
        snapshot: event.snapshot,
      };
    case "show_gate":
      return {
        ...state,
        screen: {
          kind: "gate",
          sessionId: event.sessionId,
          options: event.options,
        },
        snapshot:
          sessionOnScreen(state.screen) === event.sessionId
            ? state.snapshot
            : null,
      };
    case "receive_snapshot":
      return sessionOnScreen(state.screen) === event.sessionId
        ? { ...state, snapshot: event.snapshot }
        : state;
    case "begin_action":
      return { ...state, pendingAction: event.action };
    case "finish_action":
      return state.pendingAction === event.action
        ? { ...state, pendingAction: null }
        : state;
  }
};

export interface MeetingWorkflowTransitions {
  showHome: () => void;
  showSession: (sessionId: string) => void;
  showLoadedSession: (snapshot: MeetingReviewSnapshot) => void;
  showGate: (sessionId: string, options: MeetingStartOptions) => void;
  beginAction: (action: MeetingPendingAction) => void;
  finishAction: (action: MeetingPendingAction) => void;
  openSession: (sessionId: string) => Promise<void>;
  refreshSessionAndHome: (sessionId: string) => Promise<void>;
}

export interface MeetingWorkflow {
  state: MeetingWorkflowState;
  transitions: MeetingWorkflowTransitions;
}

interface MeetingWorkflowOptions {
  invalidation: number;
  navigationRequest: MeetingNavigationPayload | null;
  readMeeting: (sessionId: string) => Promise<MeetingSnapshotRead>;
  refreshHome: () => Promise<void>;
  startOptions: MeetingStartOptionsBuilder;
}

/** Owns the three facts that move together during a meeting workflow. Callers
 * can request named transitions; no raw React setter crosses this boundary. */
export const useMeetingWorkflow = ({
  invalidation,
  navigationRequest,
  readMeeting,
  refreshHome,
  startOptions,
}: MeetingWorkflowOptions): MeetingWorkflow => {
  const [state, dispatch] = useReducer(meetingWorkflowReducer, {
    screen: { kind: "home" },
    snapshot: null,
    pendingAction: null,
  });
  const stateRef = useRef(state);
  const snapshotRequestRef = useRef(0);
  const handledNavigationRef = useRef<MeetingNavigationPayload | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const showHome = useCallback(() => dispatch({ type: "show_home" }), []);
  const showSession = useCallback(
    (sessionId: string) => dispatch({ type: "show_session", sessionId }),
    [],
  );
  const showLoadedSession = useCallback(
    (snapshot: MeetingReviewSnapshot) =>
      dispatch({ type: "show_loaded_session", snapshot }),
    [],
  );
  const showGate = useCallback(
    (sessionId: string, options: MeetingStartOptions) =>
      dispatch({ type: "show_gate", sessionId, options }),
    [],
  );
  const beginAction = useCallback(
    (action: MeetingPendingAction) =>
      dispatch({ type: "begin_action", action }),
    [],
  );
  const finishAction = useCallback(
    (action: MeetingPendingAction) =>
      dispatch({ type: "finish_action", action }),
    [],
  );

  const loadSnapshot = useCallback(
    async (sessionId: string) => {
      const requestId = snapshotRequestRef.current + 1;
      snapshotRequestRef.current = requestId;
      const result = await readMeeting(sessionId);
      if (snapshotRequestRef.current !== requestId) return null;
      if (result.status === "missing") {
        showHome();
        return null;
      }
      if (result.status === "error") return null;
      dispatch({
        type: "receive_snapshot",
        sessionId,
        snapshot: result.snapshot,
      });
      return result.snapshot;
    },
    [readMeeting, showHome],
  );

  const refreshSessionAndHome = useCallback(
    async (sessionId: string) => {
      await Promise.all([loadSnapshot(sessionId), refreshHome()]);
    },
    [loadSnapshot, refreshHome],
  );

  const openSession = useCallback(
    async (sessionId: string) => {
      showSession(sessionId);
      const nextSnapshot = await loadSnapshot(sessionId);
      if (nextSnapshot && isPreflightMeetingPhase(nextSnapshot.session.phase)) {
        showGate(
          sessionId,
          startOptions("manual", null, nextSnapshot.session.title),
        );
      }
    },
    [loadSnapshot, showGate, showSession, startOptions],
  );

  useEffect(() => {
    if (invalidation === 0) return;
    void refreshHome();
    const activeScreen = stateRef.current.screen;
    if (activeScreen.kind !== "home") {
      void loadSnapshot(activeScreen.sessionId);
    }
  }, [invalidation, loadSnapshot, refreshHome]);

  useEffect(() => {
    if (
      navigationRequest === null ||
      handledNavigationRef.current === navigationRequest
    ) {
      return;
    }
    handledNavigationRef.current = navigationRequest;
    if (
      navigationRequest.destination === "list" ||
      navigationRequest.session_id === null
    ) {
      showHome();
      return;
    }
    void openSession(navigationRequest.session_id);
  }, [navigationRequest, openSession, showHome]);

  const transitions = useMemo<MeetingWorkflowTransitions>(
    () => ({
      showHome,
      showSession,
      showLoadedSession,
      showGate,
      beginAction,
      finishAction,
      openSession,
      refreshSessionAndHome,
    }),
    [
      beginAction,
      finishAction,
      openSession,
      refreshSessionAndHome,
      showGate,
      showHome,
      showLoadedSession,
      showSession,
    ],
  );

  return { state, transitions };
};
