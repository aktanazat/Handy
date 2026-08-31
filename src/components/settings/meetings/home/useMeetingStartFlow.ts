import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { commands, type MeetingConsentInput } from "@/bindings";
import { consentFor } from "../MeetingStartGate";
import type { MeetingStartOptions } from "../meetingTypes";
import { preflightAllowsAction } from "../meetingUtils";
import type { MeetingOutcomes } from "./useMeetingOutcomes";
import type { MeetingWorkflow } from "./useMeetingWorkflow";

export interface MeetingStartFlowOptions {
  workflow: MeetingWorkflow;
  refreshHome: () => Promise<void>;
  receiveReceipt: MeetingOutcomes["receiveReceipt"];
  reportMeetingError: MeetingOutcomes["reportMeetingError"];
}

export interface MeetingStartFlow {
  startMeeting: (options: MeetingStartOptions) => Promise<void>;
  startFromGate: (consent: MeetingConsentInput) => Promise<void>;
  cancelGate: () => Promise<void>;
  refreshGate: () => Promise<void>;
}

/* Getting a meeting recording, and the gate a blocked attempt lands on. */
export const useMeetingStartFlow = ({
  workflow,
  refreshHome,
  receiveReceipt,
  reportMeetingError,
}: MeetingStartFlowOptions): MeetingStartFlow => {
  const { t } = useTranslation();
  const { snapshot } = workflow.state;
  const {
    beginAction,
    finishAction,
    refreshSessionAndHome,
    showGate,
    showHome,
    showSession,
  } = workflow.transitions;

  /* Sends the consent the press expressed. Every caller of this reaches it
   * from a screen where the assurance sentence is rendered next to the button
   * that was pressed. That press is what the MeetingConsent row records. */
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
        showSession(sessionId);
      }
      await refreshSessionAndHome(sessionId);
      return committed;
    },
    [receiveReceipt, refreshSessionAndHome, reportMeetingError, showSession],
  );

  /* The backend needs a preflight row before it will start capture. A blocked
   * required source is the only branch that opens the gate. */
  const startMeeting = useCallback(
    async (options: MeetingStartOptions) => {
      if (options.sources.length === 0) return;

      beginAction("start");
      try {
        const created = await commands.meetingPreflightCreate({
          operation_id: crypto.randomUUID(),
          expected_revision: 0,
          title: options.title.trim(),
          origin: options.origin,
          suggestion_id: options.suggestionId,
          calendar_event_key: options.calendarEventKey,
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
        if (!receiveReceipt(created.data.receipt)) return;

        const session = created.data.snapshot;
        const blocked = session.sources.some(
          (source) => source.required && source.availability !== "available",
        );
        if (blocked) {
          showGate(session.session_id, options);
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
        finishAction("start");
      }
    },
    [
      beginAction,
      finishAction,
      receiveReceipt,
      refreshSessionAndHome,
      reportMeetingError,
      showGate,
      startCapture,
      t,
    ],
  );

  /* A loaded preflight can render while navigation still names a generic
   * session. Its phase and allowed actions are the command authority; the
   * transient screen variant is not. */
  const startFromGate = useCallback(
    async (consent: MeetingConsentInput) => {
      if (!snapshot || !preflightAllowsAction(snapshot.session, "start")) {
        return;
      }

      beginAction("start");
      try {
        await startCapture(
          snapshot.session.session_id,
          snapshot.session.revision,
          consent,
        );
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        finishAction("start");
      }
    },
    [beginAction, finishAction, snapshot, startCapture, t],
  );

  /* Leaving the gate cancels the preflight row so an abandoned start does not
   * remain in meeting history. */
  const cancelGate = useCallback(async () => {
    if (
      !snapshot ||
      !preflightAllowsAction(snapshot.session, "cancel_preflight")
    ) {
      showHome();
      return;
    }

    beginAction("preflight_cancel");
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
      showHome();
      await refreshHome();
    } catch {
      toast.error(t("meetings.errors.operation"));
    } finally {
      finishAction("preflight_cancel");
    }
  }, [
    beginAction,
    finishAction,
    receiveReceipt,
    refreshHome,
    refreshSessionAndHome,
    reportMeetingError,
    showHome,
    snapshot,
    t,
  ]);

  const refreshGate = useCallback(async () => {
    if (
      !snapshot ||
      !preflightAllowsAction(snapshot.session, "refresh_preflight")
    ) {
      return;
    }

    beginAction("preflight_refresh");
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
      finishAction("preflight_refresh");
    }
  }, [
    beginAction,
    finishAction,
    receiveReceipt,
    refreshSessionAndHome,
    reportMeetingError,
    snapshot,
    t,
  ]);

  return { startMeeting, startFromGate, cancelGate, refreshGate };
};
