import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { commands, type MeetingReviewSnapshot } from "@/bindings";
import type { MeetingOutcomes } from "./useMeetingOutcomes";

export type MeetingSnapshotRead =
  | { status: "ok"; snapshot: MeetingReviewSnapshot }
  | { status: "missing" }
  | { status: "error" };

/** Reads one current snapshot without deciding which screen owns it. Workflow
 * reads and list-row reads share the command, but only the workflow may place
 * the result in screen state. */
export const useMeetingSnapshotReader = (
  reportMeetingError: MeetingOutcomes["reportMeetingError"],
) => {
  const { t } = useTranslation();

  return useCallback(
    async (sessionId: string): Promise<MeetingSnapshotRead> => {
      try {
        const result = await commands.meetingGet(sessionId);
        if (result.status === "error") {
          reportMeetingError(result.error);
          return result.error === "not_found"
            ? { status: "missing" }
            : { status: "error" };
        }
        return { status: "ok", snapshot: result.data };
      } catch {
        toast.error(t("meetings.errors.operation"));
        return { status: "error" };
      }
    },
    [reportMeetingError, t],
  );
};
