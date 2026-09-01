import React, { useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { commands, events, type MeetingReviewSnapshot } from "@/bindings";
import { Button } from "@/components/vg/button";
import { useChatOpener } from "@/components/chat/ChatSheetHost";

export interface FollowUpAgentMessageSource {
  session: Pick<MeetingReviewSnapshot["session"], "title">;
  artifacts: ReadonlyArray<
    Pick<MeetingReviewSnapshot["artifacts"][number], "state" | "content">
  >;
}

export const buildFollowUpAgentMessage = (
  snapshot: FollowUpAgentMessageSource,
  t: TFunction,
): string | null => {
  const ledger = snapshot.artifacts.find(
    (artifact) => artifact.state === "current" && artifact.content?.ledger,
  )?.content?.ledger;
  if (ledger === null || ledger === undefined) return null;

  const commitments = ledger.commitments
    .map((commitment) => `${commitment.who}: ${commitment.what}`)
    .filter((line) => line.trim() !== "");
  const openLoops = ledger.open_loops
    .map((loop) => loop.question.trim())
    .filter((line) => line !== "");
  if (commitments.length === 0 && openLoops.length === 0) return null;

  const sections = [
    t("people.review.agentPromptIntro", { title: snapshot.session.title }),
    commitments.length === 0
      ? null
      : `${t("people.review.agentPromptCommitments")}\n${commitments
          .map((line) => `- ${line}`)
          .join("\n")}`,
    openLoops.length === 0
      ? null
      : `${t("people.review.agentPromptOpenLoops")}\n${openLoops
          .map((line) => `- ${line}`)
          .join("\n")}`,
    t("people.review.agentPromptRequest"),
  ];

  return sections.filter((section) => section !== null).join("\n\n");
};

export const FollowUpAgentAction: React.FC<{
  snapshot: MeetingReviewSnapshot;
}> = ({ snapshot }) => {
  const openChat = useChatOpener();
  const { t, i18n } = useTranslation();
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const message = useMemo(
    () => buildFollowUpAgentMessage(snapshot, t),
    [snapshot, t],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void commands
      .agentPanelStatus()
      .then((result) => {
        if (!disposed) {
          setConnected(
            result.status === "ok" && result.data.relay_status === "ready",
          );
        }
      })
      .catch(() => {
        if (!disposed) setConnected(false);
      });

    void events.agentPanelStatusChanged
      .listen((event) => {
        if (!disposed) setConnected(event.payload.status === "ready");
      })
      .then((nextUnlisten) => {
        if (disposed) nextUnlisten();
        else unlisten = nextUnlisten;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!connected || message === null) return null;

  const discuss = async () => {
    setSending(true);
    /* Shown first, then sent: the sheet is where the answer lands, and a
     * button that appears to do nothing until a relay answers is a button
     * people press twice. */
    openChat();
    try {
      const sent = await commands.agentPanelSendTurn({
        turn_id: crypto.randomUUID(),
        message,
        locale: i18n.language,
        workspace: "sona_chat",
        /* The ledger lines are already quoted in the message itself, so there
         * is no separate evidence pack to send. */
        context_pack: null,
      });
      if (sent.status === "error") {
        toast.error(t("people.review.agentError"));
      }
    } catch {
      toast.error(t("people.review.agentError"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={sending}
      onClick={() => void discuss()}
    >
      <MessageSquare aria-hidden="true" />
      {t("people.review.discussFollowUp")}
    </Button>
  );
};
