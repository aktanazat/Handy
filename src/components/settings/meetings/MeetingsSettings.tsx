import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  commands,
  type MeetingCommandError,
  type MeetingConsentInput,
  type MeetingHistorySummary,
  type MeetingMutationResult,
  type MeetingNavigationPayload,
  type MeetingRetentionPolicy,
  type MeetingReviewSnapshot,
  type MeetingSuggestion,
  type OperationReceipt,
  type Result,
} from "@/bindings";
import { Skeleton } from "../../ui";
import { MeetingDraftComposer, MeetingPreflight } from "./MeetingPreflight";
import { MeetingLive } from "./MeetingLive";
import { MeetingReview } from "./MeetingReview";
import { MeetingsHome } from "./MeetingsHome";
import type { MeetingPreflightDraft, MeetingScreen } from "./meetingTypes";
import "../settings-density.css";
import {
  isActiveMeetingPhase,
  isPreflightMeetingPhase,
  meetingErrorKey,
  meetingReasonKey,
} from "./meetingUtils";

export interface MeetingsSettingsProps {
  invalidation?: number;
  navigationRequest?: MeetingNavigationPayload | null;
  startRequest?: number;
}

type MeetingMutationInvocation = (
  operationId: string,
) => Promise<Result<MeetingMutationResult, MeetingCommandError>>;

const DEFAULT_MEETING_SOURCES = ["microphone", "system_audio"] as const;

/* One screenful of meetings, then an explicit request for older ones. The
 * backend clamps a single page at 100 rows, so paging by cursor is the only
 * way to reach a long history. */
const MEETING_PAGE_SIZE = 25;

const useMeetingsController = ({
  invalidation = 0,
  navigationRequest = null,
  startRequest = 0,
}: MeetingsSettingsProps) => {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<MeetingScreen>(() => {
    if (startRequest === 0) return { kind: "home" };

    return {
      kind: "draft",
      draft: {
        title: t("meetings.setup.defaultTitle"),
        origin: "manual",
        suggestionId: null,
        requestedSources: [...DEFAULT_MEETING_SOURCES],
        requiredSources: [...DEFAULT_MEETING_SOURCES],
        acceptedKnownMissingSources: [],
        degradedStartPolicy: "abort_if_required_source_fails",
        destination: { kind: "local" },
      },
    };
  });
  const [snapshot, setSnapshot] = useState<MeetingReviewSnapshot | null>(null);
  const [suggestions, setSuggestions] = useState<MeetingSuggestion[]>([]);
  const [recovery, setRecovery] = useState<MeetingHistorySummary[]>([]);
  const [meetings, setMeetings] = useState<MeetingHistorySummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retention, setRetention] = useState<MeetingRetentionPolicy | null>(
    null,
  );
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<OperationReceipt | null>(null);
  const homeRequestRef = useRef(0);
  const snapshotRequestRef = useRef(0);
  const screenRef = useRef<MeetingScreen>(screen);
  const handledNavigationRef = useRef<MeetingNavigationPayload | null>(null);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  const draftFor = useCallback(
    (
      origin: MeetingPreflightDraft["origin"],
      suggestionId: MeetingPreflightDraft["suggestionId"] = null,
      title = t("meetings.setup.defaultTitle"),
    ): MeetingPreflightDraft => ({
      title,
      origin,
      suggestionId,
      requestedSources: [...DEFAULT_MEETING_SOURCES],
      requiredSources: [...DEFAULT_MEETING_SOURCES],
      acceptedKnownMissingSources: [],
      degradedStartPolicy: "abort_if_required_source_fails",
      destination: { kind: "local" },
    }),
    [t],
  );

  const refreshHome = useCallback(async () => {
    const requestId = homeRequestRef.current + 1;
    homeRequestRef.current = requestId;
    setHomeLoading(true);

    try {
      const [listResult, recoveryResult, suggestionsResult, retentionResult] =
        await Promise.allSettled([
          commands.meetingList(null, MEETING_PAGE_SIZE),
          commands.meetingRecoveryList(),
          commands.meetingSuggestionsList(),
          commands.meetingRetentionGet(),
        ]);

      if (homeRequestRef.current !== requestId) return;

      const errors: MeetingCommandError[] = [];
      if (listResult.status === "fulfilled") {
        if (listResult.value.status === "ok") {
          setMeetings(listResult.value.data.entries);
          setHasMore(listResult.value.data.has_more);
        } else {
          errors.push(listResult.value.error);
        }
      }
      if (recoveryResult.status === "fulfilled") {
        if (recoveryResult.value.status === "ok") {
          setRecovery(recoveryResult.value.data);
        } else {
          errors.push(recoveryResult.value.error);
        }
      }
      if (suggestionsResult.status === "fulfilled") {
        setSuggestions(suggestionsResult.value);
      }
      // The policy itself belongs to Settings, Privacy. The list only echoes
      // it, so a failed read drops the hint instead of raising an error.
      setRetention(
        retentionResult.status === "fulfilled" &&
          retentionResult.value.status === "ok"
          ? retentionResult.value.data.policy
          : null,
      );

      setHomeError(
        errors.length > 0
          ? t(meetingErrorKey(errors[0]))
          : listResult.status === "rejected" ||
              recoveryResult.status === "rejected" ||
              suggestionsResult.status === "rejected"
            ? t("meetings.errors.load")
            : null,
      );
    } catch {
      if (homeRequestRef.current === requestId) {
        setHomeError(t("meetings.errors.load"));
      }
    } finally {
      setHomeLoading((current) =>
        homeRequestRef.current === requestId ? false : current,
      );
    }
  }, [t]);

  /* Older meetings are appended, never merged: every page comes back strictly
   * older than the cursor, so there is nothing to reconcile. */
  const loadMoreMeetings = useCallback(async () => {
    const oldest = meetings[meetings.length - 1];
    if (oldest === undefined) return;

    setLoadingMore(true);
    try {
      const result = await commands.meetingList(
        oldest.created_at_utc_ms,
        MEETING_PAGE_SIZE,
      );
      if (result.status === "error") {
        setHomeError(t(meetingErrorKey(result.error)));
        return;
      }
      setMeetings((current) => [...current, ...result.data.entries]);
      setHasMore(result.data.has_more);
    } catch {
      setHomeError(t("meetings.errors.load"));
    } finally {
      setLoadingMore(false);
    }
  }, [meetings, t]);

  const reportMeetingError = useCallback(
    (error: MeetingCommandError) => {
      const message = t(meetingErrorKey(error));
      if (error === "export_cancelled") {
        toast.info(message);
      } else {
        toast.error(message);
      }
    },
    [t],
  );

  const readSnapshot = useCallback(
    async (sessionId: string) => {
      const requestId = snapshotRequestRef.current + 1;
      snapshotRequestRef.current = requestId;
      try {
        const result = await commands.meetingGet(sessionId);
        if (snapshotRequestRef.current !== requestId) return null;
        if (result.status === "error") {
          reportMeetingError(result.error);
          if (result.error === "not_found") {
            setSnapshot(null);
            setScreen({ kind: "home" });
          }
          return null;
        }
        setSnapshot(result.data);
        return result.data;
      } catch {
        toast.error(t("meetings.errors.operation"));
        return null;
      }
    },
    [reportMeetingError, t],
  );

  const receiveReceipt = useCallback(
    (receipt: OperationReceipt) => {
      setLastReceipt(receipt);
      if (receipt.reason_codes.includes("duplicate_operation")) {
        toast.info(t("meetings.receipts.duplicate"));
      }
      if (receipt.result === "committed") {
        return true;
      }

      const reason = receipt.reason_codes[0];
      if (reason === "stale_revision") {
        toast.error(t(meetingErrorKey("stale_revision")));
      } else {
        toast.error(
          reason
            ? t(meetingReasonKey(reason))
            : t("meetings.errors.operationRejected"),
        );
      }
      return false;
    },
    [t],
  );

  const refreshSessionAndHome = useCallback(
    async (sessionId: string) => {
      await Promise.all([readSnapshot(sessionId), refreshHome()]);
    },
    [readSnapshot, refreshHome],
  );

  const openSession = useCallback(
    async (sessionId: string) => {
      setSnapshot(null);
      setScreen({ kind: "session", sessionId });
      const nextSnapshot = await readSnapshot(sessionId);
      if (nextSnapshot && isPreflightMeetingPhase(nextSnapshot.session.phase)) {
        setScreen({
          kind: "preflight",
          sessionId,
          draft: draftFor("manual", null, nextSnapshot.session.title),
        });
      }
    },
    [draftFor, readSnapshot],
  );

  const createPreflight = useCallback(async () => {
    if (screen.kind !== "draft") {
      return;
    }

    const { draft } = screen;
    setPendingAction("preflight_create");
    try {
      const result = await commands.meetingPreflightCreate({
        operation_id: crypto.randomUUID(),
        expected_revision: 0,
        title: draft.title.trim(),
        origin: draft.origin,
        suggestion_id: draft.suggestionId,
        requested_sources: draft.requestedSources,
        required_sources: draft.requiredSources,
        accepted_known_missing_sources: draft.acceptedKnownMissingSources,
        degraded_start_policy: draft.degradedStartPolicy,
        destination: draft.destination,
        remote_acknowledgement: null,
        microphone_device_uid: null,
        frozen_system_audio_application_bundle_ids: [],
      });
      if (result.status === "error") {
        reportMeetingError(result.error);
        return;
      }
      if (!receiveReceipt(result.data.receipt)) {
        return;
      }

      const sessionId = result.data.snapshot.session_id;
      setSnapshot(null);
      setScreen({ kind: "preflight", sessionId, draft });
      await refreshSessionAndHome(sessionId);
    } catch {
      toast.error(t("meetings.errors.operation"));
    } finally {
      setPendingAction(null);
    }
  }, [receiveReceipt, refreshSessionAndHome, reportMeetingError, screen, t]);

  const cancelPreflight = useCallback(async () => {
    if (screen.kind !== "preflight" || !snapshot) {
      setScreen({ kind: "home" });
      return true;
    }

    setPendingAction("preflight_cancel");
    try {
      const result = await commands.meetingPreflightCancel({
        operation_id: crypto.randomUUID(),
        session_id: snapshot.session.session_id,
        expected_revision: snapshot.session.revision,
      });
      if (result.status === "error") {
        reportMeetingError(result.error);
        await refreshSessionAndHome(snapshot.session.session_id);
        return false;
      }
      if (!receiveReceipt(result.data)) {
        await refreshSessionAndHome(snapshot.session.session_id);
        return false;
      }
      setSnapshot(null);
      setScreen({ kind: "home" });
      await refreshHome();
      return true;
    } catch {
      toast.error(t("meetings.errors.operation"));
      return false;
    } finally {
      setPendingAction(null);
    }
  }, [
    receiveReceipt,
    refreshHome,
    refreshSessionAndHome,
    reportMeetingError,
    screen,
    snapshot,
    t,
  ]);

  const reconfigurePreflight = useCallback(async () => {
    if (screen.kind !== "preflight") {
      return;
    }

    const draft = screen.draft;
    const cancelled = await cancelPreflight();
    if (cancelled) {
      setScreen({ kind: "draft", draft });
    }
  }, [cancelPreflight, screen]);

  const refreshPreflight = useCallback(async () => {
    if (screen.kind !== "preflight" || !snapshot) {
      return;
    }

    setPendingAction("preflight_refresh");
    try {
      const result = await commands.meetingPreflightRefresh({
        operation_id: crypto.randomUUID(),
        session_id: snapshot.session.session_id,
        expected_revision: snapshot.session.revision,
      });
      if (result.status === "error") {
        reportMeetingError(result.error);
        return;
      }
      if (receiveReceipt(result.data.receipt)) {
        await refreshSessionAndHome(snapshot.session.session_id);
      }
    } catch {
      toast.error(t("meetings.errors.operation"));
    } finally {
      setPendingAction(null);
    }
  }, [
    receiveReceipt,
    refreshSessionAndHome,
    reportMeetingError,
    screen,
    snapshot,
    t,
  ]);

  const startMeeting = useCallback(
    async (consent: MeetingConsentInput) => {
      if (screen.kind !== "preflight" || !snapshot) {
        return;
      }

      setPendingAction("start");
      try {
        const result = await commands.meetingStart({
          operation_id: crypto.randomUUID(),
          session_id: snapshot.session.session_id,
          expected_revision: snapshot.session.revision,
          consent,
        });
        if (result.status === "error") {
          reportMeetingError(result.error);
          if (result.error === "stale_revision") {
            await refreshSessionAndHome(snapshot.session.session_id);
          }
          return;
        }
        if (receiveReceipt(result.data.receipt)) {
          setScreen({
            kind: "session",
            sessionId: snapshot.session.session_id,
          });
          await refreshSessionAndHome(snapshot.session.session_id);
        } else {
          await refreshSessionAndHome(snapshot.session.session_id);
        }
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        setPendingAction(null);
      }
    },
    [
      receiveReceipt,
      refreshSessionAndHome,
      reportMeetingError,
      screen,
      snapshot,
      t,
    ],
  );

  const mutateSession = useCallback(
    async (
      action: string,
      sessionId: string,
      invocation: MeetingMutationInvocation,
    ) => {
      setPendingAction(action);
      try {
        const result = await invocation(crypto.randomUUID());
        if (result.status === "error") {
          reportMeetingError(result.error);
          if (result.error === "stale_revision") {
            await refreshSessionAndHome(sessionId);
          }
          return;
        }
        if (receiveReceipt(result.data.receipt)) {
          await refreshSessionAndHome(sessionId);
        } else {
          await refreshSessionAndHome(sessionId);
        }
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        setPendingAction(null);
      }
    },
    [receiveReceipt, refreshSessionAndHome, reportMeetingError, t],
  );

  const discardSession = useCallback(
    async (sessionId: string, expectedRevision: number) => {
      setPendingAction("discard");
      try {
        const result = await commands.meetingDiscard({
          operation_id: crypto.randomUUID(),
          session_id: sessionId,
          expected_revision: expectedRevision,
        });
        if (result.status === "error") {
          reportMeetingError(result.error);
          return;
        }
        if (!receiveReceipt(result.data.receipt)) {
          return;
        }
        if (result.data.removed) {
          setSnapshot(null);
          setScreen({ kind: "home" });
          toast.success(t("meetings.discard.complete"));
        }
        await refreshHome();
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        setPendingAction(null);
      }
    },
    [receiveReceipt, refreshHome, reportMeetingError, t],
  );

  const deleteSession = useCallback(
    async (sessionId: string, expectedRevision: number) => {
      setPendingAction("delete");
      try {
        const result = await commands.meetingDelete({
          operation_id: crypto.randomUUID(),
          session_id: sessionId,
          expected_revision: expectedRevision,
        });
        if (result.status === "error") {
          reportMeetingError(result.error);
          return;
        }
        if (!receiveReceipt(result.data.receipt)) {
          return;
        }
        if (result.data.removed) {
          setSnapshot(null);
          setScreen({ kind: "home" });
          toast.success(t("meetings.delete.complete"));
        }
        await refreshHome();
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        setPendingAction(null);
      }
    },
    [receiveReceipt, refreshHome, reportMeetingError, t],
  );

  const finalizeRecovery = useCallback(
    async (sessionId: string) => {
      const current = await readSnapshot(sessionId);
      if (!current) {
        return;
      }
      setScreen({ kind: "session", sessionId });
      await mutateSession("finalize_partial", sessionId, (operationId) =>
        commands.meetingRecoveryFinalize({
          operation_id: operationId,
          session_id: sessionId,
          expected_revision: current.session.revision,
        }),
      );
    },
    [mutateSession, readSnapshot],
  );

  const discardRecovery = useCallback(
    async (sessionId: string) => {
      const current = await readSnapshot(sessionId);
      if (!current) {
        return;
      }
      await discardSession(sessionId, current.session.revision);
    },
    [discardSession, readSnapshot],
  );

  useEffect(() => {
    void refreshHome();
  }, [refreshHome]);

  useEffect(() => {
    if (invalidation === 0) return;

    void refreshHome();
    const activeScreen = screenRef.current;
    if (activeScreen.kind === "preflight" || activeScreen.kind === "session") {
      void readSnapshot(activeScreen.sessionId);
    }
  }, [invalidation, readSnapshot, refreshHome]);

  /* A navigation request arrives when the backend wants a specific meeting on
   * screen: a tray click, a recovery prompt, a finished capture. Each event
   * delivers a fresh payload object, so identity is both the trigger and the
   * record of what has already been handled. */
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
      setSnapshot(null);
      setScreen({ kind: "home" });
      return;
    }

    void openSession(navigationRequest.session_id);
  }, [navigationRequest, openSession]);

  return {
    screen,
    snapshot,
    suggestions,
    recovery,
    meetings,
    hasMore,
    loadingMore,
    retention,
    homeLoading,
    homeError,
    pendingAction,
    lastReceipt,
    setScreen,
    setSnapshot,
    setPendingAction,
    draftFor,
    refreshHome,
    loadMoreMeetings,
    openSession,
    createPreflight,
    cancelPreflight,
    reconfigurePreflight,
    refreshPreflight,
    startMeeting,
    mutateSession,
    discardSession,
    deleteSession,
    finalizeRecovery,
    discardRecovery,
    reportMeetingError,
    receiveReceipt,
    refreshSessionAndHome,
  };
};

type MeetingsController = ReturnType<typeof useMeetingsController>;

type Translation = ReturnType<typeof useTranslation>["t"];

export const MeetingsSettings: React.FC<MeetingsSettingsProps> = (props) => (
  <MeetingsSettingsPage key={props.startRequest ?? 0} {...props} />
);

const MeetingsSettingsPage: React.FC<MeetingsSettingsProps> = (props) => {
  const controller = useMeetingsController(props);
  const { t } = useTranslation();
  return renderMeetingsContent(controller, t);
};

const renderMeetingsContent = (
  controller: MeetingsController,
  t: Translation,
) => {
  const {
    screen,
    snapshot,
    suggestions,
    recovery,
    meetings,
    hasMore,
    loadingMore,
    retention,
    homeLoading,
    homeError,
    pendingAction,
    draftFor,
    setScreen,
    createPreflight,
    openSession,
    finalizeRecovery,
    discardRecovery,
    refreshHome,
    loadMoreMeetings,
  } = controller;

  if (screen.kind === "draft") {
    const suggestion =
      screen.draft.suggestionId === null
        ? null
        : (suggestions.find(
            (candidate) => candidate.offer_id === screen.draft.suggestionId,
          ) ?? null);

    return (
      <MeetingDraftComposer
        draft={screen.draft}
        suggestion={suggestion}
        submitting={pendingAction === "preflight_create"}
        onChange={(draft) => setScreen({ kind: "draft", draft })}
        onCheck={createPreflight}
        onCancel={() => setScreen({ kind: "home" })}
      />
    );
  }

  if (screen.kind === "preflight" || screen.kind === "session") {
    const currentSnapshot =
      snapshot?.session.session_id === screen.sessionId ? snapshot : null;
    return renderMeetingSessionContent(controller, currentSnapshot, t);
  }

  return (
    <MeetingsHome
      suggestions={suggestions}
      recovery={recovery}
      meetings={meetings}
      loading={homeLoading}
      loadingMore={loadingMore}
      hasMore={hasMore}
      retention={retention}
      error={homeError}
      onStartManual={() =>
        setScreen({ kind: "draft", draft: draftFor("manual") })
      }
      onStartSuggestion={(suggestion) =>
        setScreen({
          kind: "draft",
          draft: draftFor("suggestion", suggestion.offer_id),
        })
      }
      onOpenMeeting={openSession}
      onFinalizeRecovery={finalizeRecovery}
      onDiscardRecovery={discardRecovery}
      onLoadMore={() => void loadMoreMeetings()}
      onRetry={() => void refreshHome()}
    />
  );
};

/* The detail view loads a whole snapshot: transcript, speakers, notes,
 * artifacts, answers. The skeleton keeps the header and the first rows in
 * place so the swap does not jump. */
const MeetingDetailSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div className="settings-page" role="status" aria-label={label}>
    <div className="space-y-2">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-4 w-56" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-[120px] w-full" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-[88px] w-full" />
    </div>
  </div>
);

const renderMeetingSessionContent = (
  controller: MeetingsController,
  currentSnapshot: MeetingReviewSnapshot | null,
  t: Translation,
) => {
  const {
    screen,
    pendingAction,
    draftFor,
    setScreen,
    refreshPreflight,
    reconfigurePreflight,
    cancelPreflight,
    startMeeting,
  } = controller;

  if (!currentSnapshot) {
    return <MeetingDetailSkeleton label={t("meetings.loading")} />;
  }

  if (screen.kind === "preflight") {
    return (
      <MeetingPreflight
        snapshot={currentSnapshot}
        draft={screen.draft}
        refreshing={pendingAction === "preflight_refresh"}
        starting={pendingAction === "start"}
        onRefresh={refreshPreflight}
        onReconfigure={reconfigurePreflight}
        onCancel={cancelPreflight}
        onStart={startMeeting}
      />
    );
  }

  if (isPreflightMeetingPhase(currentSnapshot.session.phase)) {
    const draft = draftFor("manual", null, currentSnapshot.session.title);
    return (
      <MeetingPreflight
        snapshot={currentSnapshot}
        draft={draft}
        refreshing={pendingAction === "preflight_refresh"}
        starting={pendingAction === "start"}
        onRefresh={refreshPreflight}
        onReconfigure={() => setScreen({ kind: "draft", draft })}
        onCancel={() => setScreen({ kind: "home" })}
        onStart={startMeeting}
      />
    );
  }

  if (isActiveMeetingPhase(currentSnapshot.session.phase)) {
    return renderMeetingLiveSession(controller, currentSnapshot);
  }

  return renderMeetingReviewSession(controller, currentSnapshot, t);
};

const renderMeetingLiveSession = (
  controller: MeetingsController,
  snapshot: MeetingReviewSnapshot,
) => {
  const sessionId = snapshot.session.session_id;
  const revision = snapshot.session.revision;

  return (
    <MeetingLive
      snapshot={snapshot}
      pendingAction={controller.pendingAction}
      onPause={() =>
        controller.mutateSession("pause", sessionId, (operationId) =>
          commands.meetingPause({
            operation_id: operationId,
            session_id: sessionId,
            expected_revision: revision,
          }),
        )
      }
      onResume={() =>
        controller.mutateSession("resume", sessionId, (operationId) =>
          commands.meetingResume({
            operation_id: operationId,
            session_id: sessionId,
            expected_revision: revision,
          }),
        )
      }
      onStop={() =>
        controller.mutateSession("stop", sessionId, (operationId) =>
          commands.meetingStop({
            operation_id: operationId,
            session_id: sessionId,
            expected_revision: revision,
          }),
        )
      }
      onDiscard={() => controller.discardSession(sessionId, revision)}
      onCreateNote={(body) =>
        controller.mutateSession("note_create", sessionId, (operationId) =>
          commands.meetingNoteCreate({
            operation_id: operationId,
            session_id: sessionId,
            expected_revision: revision,
            start_offset_ns: snapshot.session.elapsed_offset_ns,
            end_offset_ns: null,
            body,
          }),
        )
      }
    />
  );
};

const renderMeetingReviewSession = (
  controller: MeetingsController,
  snapshot: MeetingReviewSnapshot,
  t: Translation,
) => {
  const sessionId = snapshot.session.session_id;
  const revision = snapshot.session.revision;

  return (
    <MeetingReview
      snapshot={snapshot}
      lastReceipt={controller.lastReceipt}
      pendingAction={controller.pendingAction}
      onBack={() => {
        controller.setSnapshot(null);
        controller.setScreen({ kind: "home" });
      }}
      onTitleSet={(title) =>
        controller.mutateSession("title_set", sessionId, (operationId) =>
          commands.meetingTitleSet({
            operation_id: operationId,
            session_id: sessionId,
            expected_revision: revision,
            title,
          }),
        )
      }
      onSpeakerRename={(speakerId, displayName) =>
        controller.mutateSession("speaker_rename", sessionId, (operationId) =>
          commands.meetingSpeakerRename({
            operation_id: operationId,
            session_id: sessionId,
            expected_revision: revision,
            speaker_id: speakerId,
            display_name: displayName,
          }),
        )
      }
      onSpeakerMerge={(sourceSpeakerId, targetSpeakerId) =>
        controller.mutateSession("speaker_merge", sessionId, (operationId) =>
          commands.meetingSpeakerMerge({
            operation_id: operationId,
            session_id: sessionId,
            expected_revision: revision,
            source_speaker_id: sourceSpeakerId,
            target_speaker_id: targetSpeakerId,
          }),
        )
      }
      onSegmentEdit={(segmentId, replacementText, removed) =>
        controller.mutateSession("segment_edit", sessionId, (operationId) =>
          commands.meetingSegmentEdit({
            operation_id: operationId,
            session_id: sessionId,
            expected_revision: revision,
            segment_id: segmentId,
            replacement_text: replacementText,
            removed,
          }),
        )
      }
      onNoteCreate={(body) =>
        controller.mutateSession("note_create", sessionId, (operationId) =>
          commands.meetingNoteCreate({
            operation_id: operationId,
            session_id: sessionId,
            expected_revision: revision,
            start_offset_ns: null,
            end_offset_ns: null,
            body,
          }),
        )
      }
      onNoteUpdate={(note, body) =>
        controller.mutateSession("note_update", sessionId, (operationId) =>
          commands.meetingNoteUpdate({
            operation_id: operationId,
            session_id: sessionId,
            expected_revision: revision,
            note_id: note.note_id,
            expected_note_revision: note.revision,
            start_offset_ns: note.start_offset_ns,
            end_offset_ns: note.end_offset_ns,
            body,
          }),
        )
      }
      onNoteDelete={(note) =>
        controller.mutateSession("note_delete", sessionId, (operationId) =>
          commands.meetingNoteDelete({
            operation_id: operationId,
            session_id: sessionId,
            expected_revision: revision,
            note_id: note.note_id,
            expected_note_revision: note.revision,
          }),
        )
      }
      onRegenerate={() =>
        controller.mutateSession(
          "artifacts_regenerate",
          sessionId,
          (operationId) =>
            commands.meetingArtifactsRegenerate({
              operation_id: operationId,
              session_id: sessionId,
              expected_revision: revision,
            }),
        )
      }
      onExport={async (format) => {
        controller.setPendingAction("export_" + format);
        try {
          const result = await commands.meetingExport({
            operation_id: crypto.randomUUID(),
            session_id: sessionId,
            expected_revision: revision,
            format,
          });
          if (result.status === "error") {
            controller.reportMeetingError(result.error);
            return;
          }
          if (controller.receiveReceipt(result.data.receipt)) {
            toast.success(t("meetings.review.exportComplete"));
            await controller.refreshSessionAndHome(sessionId);
          }
        } catch {
          toast.error(t("meetings.errors.operation"));
        } finally {
          controller.setPendingAction(null);
        }
      }}
      onRemoteCancel={async () => {
        controller.setPendingAction("remote_cancel");
        try {
          const result = await commands.meetingRemoteCancel({
            operation_id: crypto.randomUUID(),
            session_id: sessionId,
            expected_revision: revision,
          });
          if (result.status === "error") {
            controller.reportMeetingError(result.error);
            return;
          }
          toast.success(t("meetings.review.remoteCancellationRequested"));
          await controller.refreshSessionAndHome(sessionId);
        } catch {
          toast.error(t("meetings.errors.operation"));
        } finally {
          controller.setPendingAction(null);
        }
      }}
      onDelete={() => controller.deleteSession(sessionId, revision)}
      onRefresh={() => controller.refreshSessionAndHome(sessionId)}
    />
  );
};
