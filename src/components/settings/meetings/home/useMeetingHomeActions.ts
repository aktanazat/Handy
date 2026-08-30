import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { commands, type MeetingExportFormat } from "@/bindings";
import { meetingErrorKey } from "../meetingUtils";
import type { MeetingMutations } from "./useMeetingMutations";
import type { MeetingSnapshotRead } from "./useMeetingSnapshotReader";
import type { MeetingWorkflowTransitions } from "./useMeetingWorkflow";

export interface MeetingHomeActionsOptions {
  transitions: MeetingWorkflowTransitions;
  readMeeting: (sessionId: string) => Promise<MeetingSnapshotRead>;
  mutations: MeetingMutations;
}

export interface MeetingHomeActions {
  finalizeRecovery: (sessionId: string) => Promise<void>;
  discardRecovery: (sessionId: string) => Promise<void>;
  exportMeeting: (
    sessionId: string,
    format: MeetingExportFormat,
  ) => Promise<void>;
  exportMeetingLedger: (sessionId: string) => Promise<void>;
  deleteMeetingFromList: (sessionId: string) => Promise<void>;
}

/* The list acts on summaries, which deliberately carry no revision. Each
 * action reads the current snapshot, then hands the revision-guarded write to
 * the mutation owner. */
export const useMeetingHomeActions = ({
  transitions,
  readMeeting,
  mutations,
}: MeetingHomeActionsOptions): MeetingHomeActions => {
  const { t } = useTranslation();
  const { beginAction, finishAction, showLoadedSession } = transitions;

  const finalizeRecovery = useCallback(
    async (sessionId: string) => {
      const current = await readMeeting(sessionId);
      if (current.status !== "ok") return;
      showLoadedSession(current.snapshot);
      await mutations.finalizeRecovery(current.snapshot);
    },
    [mutations, readMeeting, showLoadedSession],
  );

  const discardRecovery = useCallback(
    async (sessionId: string) => {
      const current = await readMeeting(sessionId);
      if (current.status !== "ok") return;
      await mutations.discardMeeting(current.snapshot);
    },
    [mutations, readMeeting],
  );

  const exportMeeting = useCallback(
    async (sessionId: string, format: MeetingExportFormat) => {
      const current = await readMeeting(sessionId);
      if (current.status !== "ok") return;
      await mutations.exportMeeting(current.snapshot, format);
    },
    [mutations, readMeeting],
  );

  /* The ledger exporter writes a file, not the meeting, so it needs no
   * revision or operation receipt. */
  const exportMeetingLedger = useCallback(
    async (sessionId: string) => {
      beginAction("export_ledger");
      try {
        const result = await commands.produceLedgerHtml(sessionId);
        if (result.status === "error") {
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
        finishAction("export_ledger");
      }
    },
    [beginAction, finishAction, t],
  );

  const deleteMeetingFromList = useCallback(
    async (sessionId: string) => {
      const current = await readMeeting(sessionId);
      if (current.status !== "ok") return;
      await mutations.deleteMeeting(current.snapshot);
    },
    [mutations, readMeeting],
  );

  return {
    finalizeRecovery,
    discardRecovery,
    exportMeeting,
    exportMeetingLedger,
    deleteMeetingFromList,
  };
};
