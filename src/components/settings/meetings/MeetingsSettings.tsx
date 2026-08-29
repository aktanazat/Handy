import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  commands,
  type MeetingCommandError,
  type MeetingConsentInput,
  type MeetingExportFormat,
  type MeetingHistorySummary,
  type MeetingListFilter,
  type MeetingMutationResult,
  type MeetingNavigationPayload,
  type MeetingRetentionPolicy,
  type MeetingReviewSnapshot,
  type MeetingSuggestion,
  type OperationReceipt,
  type Result,
  type SourceKind,
} from "@/bindings";
import { Skeleton } from "../../ui";
import { MeetingStartGate, consentFor } from "./MeetingStartGate";
import { MeetingLive } from "./MeetingLive";
import { MeetingReview } from "./MeetingReview";
import { MeetingsHome } from "./MeetingsHome";
import { suggestionFacts } from "./MeetingPreviewCard";
import type { MeetingScreen, MeetingStartOptions } from "./meetingTypes";
import "./meetings.css";
import {
  NO_MEETING_FILTER,
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

const DEFAULT_MEETING_SOURCES: SourceKind[] = ["microphone", "system_audio"];

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
  const [screen, setScreen] = useState<MeetingScreen>({ kind: "home" });
  /* What the next press of Start will record. Sources are the only part of
   * setup a person changes often enough to keep on the page. */
  const [sources, setSources] = useState<SourceKind[]>(DEFAULT_MEETING_SOURCES);
  const [snapshot, setSnapshot] = useState<MeetingReviewSnapshot | null>(null);
  const [suggestions, setSuggestions] = useState<MeetingSuggestion[]>([]);
  const [recovery, setRecovery] = useState<MeetingHistorySummary[]>([]);
  const [meetings, setMeetings] = useState<MeetingHistorySummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  /* The cursor each page past the first was fetched with, oldest-created-at
   * per step. Cursor paging has no page numbers of its own: this stack IS the
   * position, so its length is the page the person is looking at, and Newer is
   * a pop rather than a second query direction. */
  const [pageCursors, setPageCursors] = useState<number[]>([]);
  /* One truth about the list read, viewed two ways: with no rows yet it is the
   * skeleton, with rows on screen it is what disables the pager. */
  const [listLoading, setListLoading] = useState(true);
  const [listRevision, setListRevision] = useState(0);
  const [filter, setFilter] = useState<MeetingListFilter>(NO_MEETING_FILTER);
  const [retention, setRetention] = useState<MeetingRetentionPolicy | null>(
    null,
  );
  const [homeError, setHomeError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<OperationReceipt | null>(null);
  const homeRequestRef = useRef(0);
  const listRequestRef = useRef(0);
  const snapshotRequestRef = useRef(0);
  const screenRef = useRef<MeetingScreen>(screen);
  const handledNavigationRef = useRef<MeetingNavigationPayload | null>(null);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  const startOptions = useCallback(
    (
      origin: MeetingStartOptions["origin"],
      suggestionId: MeetingStartOptions["suggestionId"] = null,
      title = t("meetings.setup.defaultTitle"),
      preview: MeetingStartOptions["preview"] = null,
    ): MeetingStartOptions => ({
      title,
      origin,
      suggestionId,
      sources,
      degradedStartPolicy: "abort_if_required_source_fails",
      destination: { kind: "local" },
      preview,
    }),
    [sources, t],
  );

  /* One owner of "which page is on screen": the cursor stack and the filter
   * are the position, an effect below turns that position into a request, and
   * these handlers only move the position. Nothing is merged, because a page
   * is not an accumulation — each answer contains exactly the rows that match
   * the query, and the previous page's rows are not among them. */
  const loadMeetingPage = useCallback(
    async (cursors: number[], nextFilter: MeetingListFilter) => {
      const requestId = listRequestRef.current + 1;
      listRequestRef.current = requestId;
      setListLoading(true);
      try {
        const result = await commands.meetingList(
          cursors.length === 0 ? null : cursors[cursors.length - 1],
          MEETING_PAGE_SIZE,
          nextFilter,
        );
        if (listRequestRef.current !== requestId) return;
        if (result.status === "error") {
          setHomeError(t(meetingErrorKey(result.error)));
          return;
        }
        setMeetings(result.data.entries);
        setHasMore(result.data.has_more);
        setHomeError(null);
      } catch {
        if (listRequestRef.current === requestId) {
          setHomeError(t("meetings.errors.load"));
        }
      } finally {
        setListLoading((current) =>
          listRequestRef.current === requestId ? false : current,
        );
      }
    },
    [t],
  );

  useEffect(() => {
    void loadMeetingPage(pageCursors, filter);
  }, [filter, listRevision, loadMeetingPage, pageCursors]);

  /* A new filter is a new list, so it always lands on page one: keeping the
   * cursor would ask the store for rows older than a row the filter may have
   * just excluded. */
  const applyMeetingFilter = useCallback((nextFilter: MeetingListFilter) => {
    setFilter(nextFilter);
    setPageCursors([]);
  }, []);

  const nextMeetingPage = useCallback(() => {
    const oldest = meetings[meetings.length - 1];
    if (oldest === undefined || !hasMore) return;
    setPageCursors((current) => [...current, oldest.created_at_utc_ms]);
  }, [hasMore, meetings]);

  const previousMeetingPage = useCallback(() => {
    setPageCursors((current) => current.slice(0, -1));
  }, []);

  /* Everything on this page that is not the meetings list: what needs
   * recovering, what is being offered, and the retention policy the list
   * echoes. The list itself belongs to the position effect above, so a refresh
   * bumps `listRevision` and lets that one owner re-read it. */
  const refreshHome = useCallback(async () => {
    const requestId = homeRequestRef.current + 1;
    homeRequestRef.current = requestId;
    setListRevision((current) => current + 1);

    try {
      const [recoveryResult, suggestionsResult, retentionResult] =
        await Promise.allSettled([
          commands.meetingRecoveryList(),
          commands.meetingSuggestionsList(),
          commands.meetingRetentionGet(),
        ]);

      if (homeRequestRef.current !== requestId) return;

      const errors: MeetingCommandError[] = [];
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

      if (errors.length > 0) {
        setHomeError(t(meetingErrorKey(errors[0])));
      } else if (
        recoveryResult.status === "rejected" ||
        suggestionsResult.status === "rejected"
      ) {
        setHomeError(t("meetings.errors.load"));
      }
    } catch {
      if (homeRequestRef.current === requestId) {
        setHomeError(t("meetings.errors.load"));
      }
    }
  }, [t]);

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
          kind: "gate",
          sessionId,
          options: startOptions("manual", null, nextSnapshot.session.title),
        });
      }
    },
    [readSnapshot, startOptions],
  );

  /* Sends the consent the press expressed. Every caller of this reaches it
   * from a screen where the assurance sentence — "Records your Mac's audio
   * locally. Nothing joins the call." — is rendered next to the button that
   * was pressed: the start block on the meetings list, the detected-meeting
   * rows under the same sentence, and MeetingStartGate. That press is the
   * operator's acknowledgment and is what the MeetingConsent row records, so a
   * fourth caller from a surface without the sentence would make the row
   * claim an acknowledgment nobody could have made. */
  const startCapture = useCallback(
    async (
      sessionId: string,
      revision: number,
      consent: MeetingConsentInput,
    ) => {
      const result = await commands.meetingStart({
        operation_id: crypto.randomUUID(),
        session_id: sessionId,
        expected_revision: revision,
        consent,
      });
      if (result.status === "error") {
        reportMeetingError(result.error);
        await refreshSessionAndHome(sessionId);
        return false;
      }
      const committed = receiveReceipt(result.data.receipt);
      if (committed) {
        setScreen({ kind: "session", sessionId });
      }
      await refreshSessionAndHome(sessionId);
      return committed;
    },
    [receiveReceipt, refreshSessionAndHome, reportMeetingError],
  );

  /* One press, two commands. The backend needs a preflight row before it will
   * start capture, so Start creates one and starts it in the same action; the
   * person never sees a setup step. The only thing that can interrupt this is
   * a required source the machine cannot open, and that lands on
   * MeetingStartGate with the blocker named — checking readiness first would
   * add a round trip to every meeting to catch the rare one. */
  const startMeeting = useCallback(
    async (options: MeetingStartOptions) => {
      if (options.sources.length === 0) return;

      setPendingAction("start");
      try {
        const created = await commands.meetingPreflightCreate({
          operation_id: crypto.randomUUID(),
          expected_revision: 0,
          title: options.title.trim(),
          origin: options.origin,
          suggestion_id: options.suggestionId,
          requested_sources: options.sources,
          required_sources: options.sources,
          accepted_known_missing_sources: [],
          degraded_start_policy: options.degradedStartPolicy,
          destination: options.destination,
          remote_acknowledgement: null,
          microphone_device_uid: null,
          frozen_system_audio_application_bundle_ids: [],
        });
        if (created.status === "error") {
          reportMeetingError(created.error);
          return;
        }
        if (!receiveReceipt(created.data.receipt)) {
          return;
        }

        const session = created.data.snapshot;
        const blocked = session.sources.some(
          (source) => source.required && source.availability !== "available",
        );
        setSnapshot(null);
        if (blocked) {
          setScreen({ kind: "gate", sessionId: session.session_id, options });
          await refreshSessionAndHome(session.session_id);
          return;
        }

        await startCapture(
          session.session_id,
          session.revision,
          consentFor(options, [], false),
        );
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
      startCapture,
      t,
    ],
  );

  /* The gate's own Start: the session already exists, so only the second
   * command runs. */
  const startFromGate = useCallback(
    async (consent: MeetingConsentInput) => {
      if (screen.kind !== "gate" || !snapshot) return;

      setPendingAction("start");
      try {
        await startCapture(
          snapshot.session.session_id,
          snapshot.session.revision,
          consent,
        );
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        setPendingAction(null);
      }
    },
    [screen, snapshot, startCapture, t],
  );

  /* Leaving the gate cancels the session it was standing in front of, so an
   * abandoned attempt does not leave a preflight row in the list. */
  const cancelGate = useCallback(async () => {
    if (screen.kind !== "gate" || !snapshot) {
      setScreen({ kind: "home" });
      return;
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
        return;
      }
      if (!receiveReceipt(result.data)) {
        await refreshSessionAndHome(snapshot.session.session_id);
        return;
      }
      setSnapshot(null);
      setScreen({ kind: "home" });
      await refreshHome();
    } catch {
      toast.error(t("meetings.errors.operation"));
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

  const refreshGate = useCallback(async () => {
    if (screen.kind !== "gate" || !snapshot) {
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

  /* A list row acts on a meeting it has not opened, and export and delete both
   * need the revision they are acting against. The list summary does not carry
   * one — deliberately, it is a projection — so the row reads the snapshot
   * first, exactly as the recovery prompt does. A stale revision then fails
   * loudly at the store instead of silently overwriting someone. */
  const exportMeeting = useCallback(
    async (sessionId: string, format: MeetingExportFormat) => {
      const current = await readSnapshot(sessionId);
      if (!current) return;
      setPendingAction("export_" + format);
      try {
        const result = await commands.meetingExport({
          operation_id: crypto.randomUUID(),
          session_id: sessionId,
          expected_revision: current.session.revision,
          format,
        });
        if (result.status === "error") {
          reportMeetingError(result.error);
          return;
        }
        if (receiveReceipt(result.data.receipt)) {
          toast.success(t("meetings.review.exportComplete"));
        }
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        setPendingAction(null);
      }
    },
    [readSnapshot, receiveReceipt, reportMeetingError, t],
  );

  /* The ledger page is written from an already-recorded revision, so it takes
   * no operation id and no expected revision: it mutates nothing. */
  const exportMeetingLedger = useCallback(
    async (sessionId: string) => {
      setPendingAction("export_ledger");
      try {
        const result = await commands.produceLedgerHtml(sessionId);
        if (result.status === "error") {
          // A cancelled save dialog is the person changing their mind.
          if (result.error === "export_cancelled") return;
          toast.error(
            result.error === "not_found"
              ? t("meetings.ledger.exportMissing")
              : t(meetingErrorKey(result.error)),
          );
          return;
        }
        toast.success(t("meetings.ledger.exported", { path: result.data }));
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        setPendingAction(null);
      }
    },
    [t],
  );

  const deleteMeetingFromList = useCallback(
    async (sessionId: string) => {
      const current = await readSnapshot(sessionId);
      if (!current) return;
      await deleteSession(sessionId, current.session.revision);
    },
    [deleteSession, readSnapshot],
  );

  useEffect(() => {
    void refreshHome();
  }, [refreshHome]);

  useEffect(() => {
    if (invalidation === 0) return;

    void refreshHome();
    const activeScreen = screenRef.current;
    if (activeScreen.kind === "gate" || activeScreen.kind === "session") {
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
    listLoading,
    page: pageCursors.length + 1,
    filter,
    retention,
    homeError,
    pendingAction,
    lastReceipt,
    sources,
    /* A start request means the person asked for this page in order to
     * record, so the Start control takes focus when they land. Starting from
     * a URL stays a press away: a link is not consent to record a room. */
    focusStart: startRequest > 0,
    setScreen,
    setSnapshot,
    setPendingAction,
    setSources,
    startOptions,
    refreshHome,
    applyMeetingFilter,
    nextMeetingPage,
    previousMeetingPage,
    exportMeeting,
    exportMeetingLedger,
    deleteMeetingFromList,
    openSession,
    cancelGate,
    refreshGate,
    startMeeting,
    startFromGate,
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
    listLoading,
    page,
    filter,
    retention,
    homeError,
    pendingAction,
    sources,
    focusStart,
    setSources,
    startOptions,
    startMeeting,
    openSession,
    finalizeRecovery,
    discardRecovery,
    refreshHome,
    applyMeetingFilter,
    nextMeetingPage,
    previousMeetingPage,
    exportMeeting,
    exportMeetingLedger,
    deleteMeetingFromList,
  } = controller;

  if (screen.kind === "gate" || screen.kind === "session") {
    const currentSnapshot =
      snapshot?.session.session_id === screen.sessionId ? snapshot : null;
    return renderMeetingSessionContent(controller, currentSnapshot, t);
  }

  return (
    <MeetingsHome
      suggestions={suggestions}
      recovery={recovery}
      meetings={meetings}
      /* One read in flight, two views of it: with nothing on screen it is the
       * skeleton, with rows on screen it is what disables the pager. */
      loading={listLoading && meetings.length === 0}
      paging={listLoading}
      hasMore={hasMore}
      page={page}
      filter={filter}
      retention={retention}
      error={homeError}
      sources={sources}
      starting={pendingAction === "start"}
      focusStart={focusStart}
      onSourcesChange={setSources}
      onStart={() => void startMeeting(startOptions("manual"))}
      onStartSuggestion={(suggestion) =>
        void startMeeting(
          startOptions(
            "suggestion",
            suggestion.offer_id,
            undefined,
            suggestionFacts(suggestion, t),
          ),
        )
      }
      /* A detected event is still the operator's own press: it takes the
       * manual origin and the same preflight, and carries the event so the
       * consent screen shows the meeting they were looking at. */
      onStartEvent={(facts) =>
        void startMeeting(startOptions("manual", null, facts.title, facts))
      }
      onOpenMeeting={openSession}
      onFinalizeRecovery={finalizeRecovery}
      onDiscardRecovery={discardRecovery}
      onFilterChange={applyMeetingFilter}
      onNextPage={nextMeetingPage}
      onPreviousPage={previousMeetingPage}
      onExportMeeting={(sessionId, format) =>
        void exportMeeting(sessionId, format)
      }
      onExportLedger={(sessionId) => void exportMeetingLedger(sessionId)}
      onDeleteMeeting={(sessionId) => void deleteMeetingFromList(sessionId)}
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
    startOptions,
    refreshGate,
    cancelGate,
    startFromGate,
  } = controller;

  if (!currentSnapshot) {
    return <MeetingDetailSkeleton label={t("meetings.loading")} />;
  }

  if (
    screen.kind === "gate" ||
    isPreflightMeetingPhase(currentSnapshot.session.phase)
  ) {
    return (
      <MeetingStartGate
        snapshot={currentSnapshot}
        options={
          screen.kind === "gate"
            ? screen.options
            : startOptions("manual", null, currentSnapshot.session.title)
        }
        refreshing={pendingAction === "preflight_refresh"}
        starting={pendingAction === "start"}
        onRefresh={refreshGate}
        onCancel={cancelGate}
        onStart={startFromGate}
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
