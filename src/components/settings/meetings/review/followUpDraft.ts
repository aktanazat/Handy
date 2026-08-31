import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import type { OperationReceipt } from "@/bindings";

/* D26: turn a finished meeting into a message worth sending.
 *
 * The backend decides what goes in — the summary, the rows the user owes, the
 * decisions — and whether an engine wrote a message out of them. It does not
 * decide the words around them, because those are read by a person in their
 * own language and a Rust string cannot reach the i18next catalog.
 *
 * So there are exactly two shapes. An engine wrote a message: that message is
 * the draft, verbatim, and nothing is bolted onto it. No engine was available:
 * the draft is the record under translated headings, in the order somebody
 * would write it. The second is not a degraded first — nothing in it was
 * invented, which is the property a follow-up most needs.
 *
 * The types and the wrapper are hand-written here rather than taken from
 * `bindings.ts`, matching `meetingAnalytics.ts`: the meeting commands have
 * always reached the frontend this way. */

/** Who wrote the draft. Mirrors `MeetingFollowUpSource`. */
export type MeetingFollowUpSource = "generated" | "structured";

/** Mirrors `MeetingFollowUpDraft`. */
export interface MeetingFollowUpDraft {
  session_id: string;
  title: string;
  source: MeetingFollowUpSource;
  /** The engine's message. Null when no engine was selectable. */
  message: string | null;
  summary: string;
  /** Open rows the user owes, ledger order. */
  mine: string[];
  decisions: string[];
  receipt: OperationReceipt;
}

export const meetingFollowUpDraft = (
  operationId: string,
  sessionId: string,
): Promise<MeetingFollowUpDraft> =>
  invoke<MeetingFollowUpDraft>("meeting_follow_up_draft", {
    operationId,
    sessionId,
  });

/** The draft as a person reads it, and as the clipboard receives it. */
export const followUpDraftText = (
  draft: MeetingFollowUpDraft,
  t: TFunction,
): string => {
  if (draft.message !== null) return draft.message;

  const sections: string[] = [];
  if (draft.summary !== "") sections.push(draft.summary);
  if (draft.mine.length > 0) {
    sections.push(
      [
        t("meetings.followUp.iOwe"),
        ...draft.mine.map((line) => `- ${line}`),
      ].join("\n"),
    );
  }
  if (draft.decisions.length > 0) {
    sections.push(
      [
        t("meetings.followUp.decisions"),
        ...draft.decisions.map((line) => `- ${line}`),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
};
