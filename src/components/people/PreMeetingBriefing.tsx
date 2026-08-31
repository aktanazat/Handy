import React from "react";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PersonBriefingRow } from "@/bindings";
import { formatEntryTimestamp } from "@/lib/utils/format";
import { groupByDirection } from "./loopDirection";

export const PreMeetingBriefing: React.FC<{
  rows: readonly PersonBriefingRow[];
}> = ({ rows }) => {
  const { t } = useTranslation();
  const row = rows.find((candidate) => candidate.meetings_count > 0);
  if (row === undefined) return null;

  const relationship =
    row.last === null
      ? t("people.briefing.metCount", {
          name: row.display_name,
          count: row.meetings_count,
        })
      : t("people.briefing.metBefore", {
          name: row.display_name,
          count: row.meetings_count,
          date: formatEntryTimestamp(row.last.at_utc_ms),
        });
  /* D27: the brief has room for one line about what is still open, so which
   * one it is matters. What the user owes this person comes first — it is the
   * thing they can act on in the next thirty seconds — and only when there is
   * none does the brief name what they are waiting on. An overdue handoff is
   * marked, because "still open" and "still open after two weeks" are
   * different sentences to walk into a room with. */
  const open = [...row.open_loops, ...row.commitments].filter(
    (loop) => loop.text.trim() !== "",
  );
  const grouped = groupByDirection(open);
  const owed = grouped.mine[0];
  const awaited =
    grouped.waitingOn.find((loop) => loop.waiting_on_stale) ??
    grouped.waitingOn[0];

  return (
    <div
      data-slot="preview-briefing"
      className="flex items-start gap-2 border-t border-gray-alpha-400 px-3 py-2.5"
    >
      <Users
        aria-hidden="true"
        className="mt-0.5 size-3.5 flex-none text-gray-700"
      />
      <div className="min-w-0 text-[11px] leading-[17px] text-gray-900">
        <p className="truncate">{relationship}</p>
        {owed === undefined ? null : (
          <p className="truncate">
            {t("people.waitingOn.briefIOwe", { text: owed.text })}
          </p>
        )}
        {awaited === undefined ? null : (
          <p className="truncate">
            {awaited.waiting_on_stale
              ? t("people.waitingOn.briefOverdue", {
                  name: row.display_name,
                  text: awaited.text,
                })
              : t("people.waitingOn.brief", {
                  name: row.display_name,
                  text: awaited.text,
                })}
          </p>
        )}
      </div>
    </div>
  );
};
