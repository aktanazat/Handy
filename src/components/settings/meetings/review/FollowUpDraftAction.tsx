import React, { useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "@/bindings";
import { Button } from "@/components/vg/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import {
  followUpDraftText,
  meetingFollowUpDraft,
  type MeetingFollowUpDraft,
} from "./followUpDraft";

/* D26: one press turns the record into a message.
 *
 * The sheet shows the draft before anything is copied, because the whole point
 * is that a person reads it and sends it in their own words. It also says
 * plainly where the draft came from: a message an engine wrote is a rewrite of
 * the record and worth checking, and a draft assembled from the record is
 * verbatim and worth trusting. Those are different things to hand somebody,
 * so the sheet does not pretend they are the same. */

interface FollowUpDraftActionProps {
  sessionId: string;
  disabled: boolean;
}

export const FollowUpDraftAction: React.FC<FollowUpDraftActionProps> = ({
  sessionId,
  disabled,
}) => {
  const { t } = useTranslation();
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<MeetingFollowUpDraft | null>(null);

  const write = async () => {
    setDrafting(true);
    try {
      setDraft(await meetingFollowUpDraft(crypto.randomUUID(), sessionId));
    } catch {
      toast.error(t("meetings.followUp.failed"));
    } finally {
      setDrafting(false);
    }
  };

  const body = draft === null ? "" : followUpDraftText(draft, t);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setDraft(null);
      toast.success(t("meetings.followUp.copied"));
    } catch {
      toast.error(t("meetings.followUp.copyFailed"));
    }
  };

  /* The draft, addressed. The backend owns the recipients, the subject, the
   * encoding and the length bound; the words and the clipboard are this side's,
   * exactly as they are for Copy. */
  const openInMail = async () => {
    if (draft === null) return;
    try {
      const mail = await commands.meetingFollowUpMail({
        session_id: draft.session_id,
        body,
        over_bound_note: t("meetings.followUp.mailClipboardNote"),
      });
      if (mail.status === "error") {
        toast.error(t("meetings.followUp.mailFailed"));
        return;
      }
      if (mail.data.body === "clipboard") {
        await navigator.clipboard.writeText(body);
      }
      await openUrl(mail.data.url);
      setDraft(null);
      toast.success(
        mail.data.body === "clipboard"
          ? t("meetings.followUp.mailCopied")
          : t("meetings.followUp.mailOpened"),
      );
    } catch {
      toast.error(t("meetings.followUp.mailFailed"));
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void write()}
        disabled={disabled || drafting}
      >
        <Mail aria-hidden="true" className="size-3.5" />
        {drafting
          ? t("meetings.followUp.drafting")
          : t("meetings.followUp.draft")}
      </Button>

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("meetings.followUp.title")}</DialogTitle>
            <DialogDescription>
              {draft?.source === "generated"
                ? t("meetings.followUp.fromEngine")
                : t("meetings.followUp.fromRecord")}
            </DialogDescription>
          </DialogHeader>
          {/* The draft owns the scroll, so the sheet's own footer never leaves
           * the window on a long meeting. */}
          <div className="max-h-64 overflow-y-auto">
            <p className="text-[14px] leading-[21px] whitespace-pre-wrap text-pretty text-gray-1000">
              {body}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraft(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {t("meetings.followUp.copy")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void openInMail()}
            >
              {t("meetings.followUp.openInMail")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
