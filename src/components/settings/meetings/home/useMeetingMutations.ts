import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  commands,
  type MeetingCommandError,
  type MeetingExportFormat,
  type MeetingMutationResult,
  type MeetingRemovalResult,
  type MeetingReviewSnapshot,
  type Result,
} from "@/bindings";
import type { MeetingPendingAction } from "../meetingTypes";
import type { MeetingOutcomes } from "./useMeetingOutcomes";
import type { MeetingWorkflowTransitions } from "./useMeetingWorkflow";

export type MeetingMutationInvocation = (
  operationId: string,
) => Promise<Result<MeetingMutationResult, MeetingCommandError>>;

type MeetingRemovalInvocation = (
  operationId: string,
) => Promise<Result<MeetingRemovalResult, MeetingCommandError>>;

export interface MeetingMutationsOptions {
  transitions: MeetingWorkflowTransitions;
  refreshHome: () => Promise<void>;
  receiveReceipt: MeetingOutcomes["receiveReceipt"];
  reportMeetingError: MeetingOutcomes["reportMeetingError"];
}

export interface MeetingMutations {
  mutateSession: (
    action: MeetingPendingAction,
    snapshot: MeetingReviewSnapshot,
    invocation: MeetingMutationInvocation,
  ) => Promise<void>;
  discardMeeting: (snapshot: MeetingReviewSnapshot) => Promise<void>;
  finalizeRecovery: (snapshot: MeetingReviewSnapshot) => Promise<void>;
  exportMeeting: (
    snapshot: MeetingReviewSnapshot,
    format: MeetingExportFormat,
  ) => Promise<void>;
  cancelRemote: (snapshot: MeetingReviewSnapshot) => Promise<void>;
  deleteMeeting: (snapshot: MeetingReviewSnapshot) => Promise<void>;
}

/* Every write against an existing meeting passes through this hook. Action
 * bindings supply the command payload; this owner supplies operation ids,
 * revisions, receipts, refreshes, and the pending-action lifecycle. */
export const useMeetingMutations = ({
  transitions,
  refreshHome,
  receiveReceipt,
  reportMeetingError,
}: MeetingMutationsOptions): MeetingMutations => {
  const { t } = useTranslation();
  const { beginAction, finishAction, refreshSessionAndHome, showHome } =
    transitions;

  const mutateSession = useCallback(
    async (
      action: MeetingPendingAction,
      snapshot: MeetingReviewSnapshot,
      invocation: MeetingMutationInvocation,
    ) => {
      const sessionId = snapshot.session.session_id;
      beginAction(action);
      try {
        const result = await invocation(crypto.randomUUID());
        if (result.status === "error") {
          reportMeetingError(result.error);
          if (result.error === "stale_revision") {
            await refreshSessionAndHome(sessionId);
          }
          return;
        }
        receiveReceipt(result.data.receipt);
        await refreshSessionAndHome(sessionId);
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        finishAction(action);
      }
    },
    [
      beginAction,
      finishAction,
      receiveReceipt,
      refreshSessionAndHome,
      reportMeetingError,
      t,
    ],
  );

  const removeMeeting = useCallback(
    async (
      action: "discard" | "delete",
      snapshot: MeetingReviewSnapshot,
      invocation: MeetingRemovalInvocation,
      successMessage: string,
    ) => {
      beginAction(action);
      try {
        const result = await invocation(crypto.randomUUID());
        if (result.status === "error") {
          reportMeetingError(result.error);
          return;
        }
        if (!receiveReceipt(result.data.receipt)) return;
        if (result.data.removed) {
          showHome();
          toast.success(successMessage);
        }
        await refreshHome();
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        finishAction(action);
      }
    },
    [
      beginAction,
      finishAction,
      receiveReceipt,
      refreshHome,
      reportMeetingError,
      showHome,
      t,
    ],
  );

  const discardMeeting = useCallback(
    (snapshot: MeetingReviewSnapshot) =>
      removeMeeting(
        "discard",
        snapshot,
        (operationId) =>
          commands.meetingDiscard({
            operation_id: operationId,
            session_id: snapshot.session.session_id,
            expected_revision: snapshot.session.revision,
          }),
        t("meetings.discard.complete"),
      ),
    [removeMeeting, t],
  );

  const finalizeRecovery = useCallback(
    (snapshot: MeetingReviewSnapshot) =>
      mutateSession("finalize_partial", snapshot, (operationId) =>
        commands.meetingRecoveryFinalize({
          operation_id: operationId,
          session_id: snapshot.session.session_id,
          expected_revision: snapshot.session.revision,
        }),
      ),
    [mutateSession],
  );

  const exportMeeting = useCallback(
    async (snapshot: MeetingReviewSnapshot, format: MeetingExportFormat) => {
      const action: MeetingPendingAction = `export_${format}`;
      beginAction(action);
      try {
        const result = await commands.meetingExport({
          operation_id: crypto.randomUUID(),
          session_id: snapshot.session.session_id,
          expected_revision: snapshot.session.revision,
          format,
        });
        if (result.status === "error") {
          reportMeetingError(result.error);
          return;
        }
        if (receiveReceipt(result.data.receipt)) {
          toast.success(t("meetings.review.exportComplete"));
          await refreshSessionAndHome(snapshot.session.session_id);
        }
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        finishAction(action);
      }
    },
    [
      beginAction,
      finishAction,
      receiveReceipt,
      refreshSessionAndHome,
      reportMeetingError,
      t,
    ],
  );

  const cancelRemote = useCallback(
    async (snapshot: MeetingReviewSnapshot) => {
      beginAction("remote_cancel");
      try {
        const result = await commands.meetingRemoteCancel({
          operation_id: crypto.randomUUID(),
          session_id: snapshot.session.session_id,
          expected_revision: snapshot.session.revision,
        });
        if (result.status === "error") {
          reportMeetingError(result.error);
          return;
        }
        toast.success(t("meetings.review.remoteCancellationRequested"));
        await refreshSessionAndHome(snapshot.session.session_id);
      } catch {
        toast.error(t("meetings.errors.operation"));
      } finally {
        finishAction("remote_cancel");
      }
    },
    [beginAction, finishAction, refreshSessionAndHome, reportMeetingError, t],
  );

  const deleteMeeting = useCallback(
    (snapshot: MeetingReviewSnapshot) =>
      removeMeeting(
        "delete",
        snapshot,
        (operationId) =>
          commands.meetingDelete({
            operation_id: operationId,
            session_id: snapshot.session.session_id,
            expected_revision: snapshot.session.revision,
          }),
        t("meetings.delete.complete"),
      ),
    [removeMeeting, t],
  );

  return {
    mutateSession,
    discardMeeting,
    finalizeRecovery,
    exportMeeting,
    cancelRemote,
    deleteMeeting,
  };
};
