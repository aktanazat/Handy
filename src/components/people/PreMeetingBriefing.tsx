import React from "react";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PersonBriefingRow } from "@/bindings";
import { formatEntryTimestamp } from "@/lib/utils/format";

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
  const openLoop = row.open_loops.find((loop) => loop.text.trim() !== "");

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
        {openLoop === undefined ? null : (
          <p className="truncate">
            {t("people.briefing.stillOpen", { text: openLoop.text })}
          </p>
        )}
      </div>
    </div>
  );
};
