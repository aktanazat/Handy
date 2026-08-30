import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { MeetingCommandError, OperationReceipt } from "@/bindings";
import { meetingErrorKey, meetingReasonKey } from "../meetingUtils";

export interface MeetingOutcomes {
  /** What the store recorded for the last write the person asked for. */
  lastReceipt: OperationReceipt | null;
  reportMeetingError: (error: MeetingCommandError) => void;
  /** True when the receipt committed. A rejection is named here, not by the
   *  caller, which only has to decide whether to carry on. */
  receiveReceipt: (receipt: OperationReceipt) => boolean;
}

/* Every meeting command answers with either an error or a receipt, and both
 * answers reach the person as a toast. One owner of that wording, so no flow
 * has to invent a second name for a rejection the store already named. */
export const useMeetingOutcomes = (): MeetingOutcomes => {
  const { t } = useTranslation();
  const [lastReceipt, setLastReceipt] = useState<OperationReceipt | null>(null);

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

  return { lastReceipt, reportMeetingError, receiveReceipt };
};
