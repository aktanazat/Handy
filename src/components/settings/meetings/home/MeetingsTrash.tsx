import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands, type MeetingTrashEntry } from "@/bindings";
import { Microlabel, SettingsSection } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { formatEntryTimestamp } from "@/lib/utils/format";

/* The undo bin, on the page that deletes.
 *
 * It sits at the bottom of Meetings home rather than in Settings because this is
 * the page the Delete action lives on, and a bin somewhere else would be a
 * second place to look for the meeting you just lost. Like the unfinished-
 * meetings section above it, it renders nothing when it is empty: a "Recently
 * deleted (0)" heading on every mount would be a permanent reminder of an action
 * most people take rarely.
 *
 * Self-fetching, like MeetingsUpcoming: the controller owns live meeting state,
 * and a deleted meeting is not one. */

const DAY_MS = 24 * 60 * 60 * 1_000;

interface MeetingsTrashProps {
  /** Refreshes the history list, so a restored meeting appears in it. */
  onRestored: () => void;
}

export const MeetingsTrash: React.FC<MeetingsTrashProps> = ({ onRestored }) => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<MeetingTrashEntry[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await commands.meetingTrashList();
    setEntries(result.status === "ok" ? result.data : []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const restore = async (entry: MeetingTrashEntry) => {
    setRestoring(entry.job_id);
    try {
      const result = await commands.meetingTrashRestore(entry.job_id);
      if (result.status === "error") {
        toast.error(t("meetings.trash.restoreFailed"));
        return;
      }
      toast.success(t("meetings.trash.restored", { title: result.data.title }));
      await refresh();
      onRestored();
    } catch {
      toast.error(t("meetings.trash.restoreFailed"));
    } finally {
      setRestoring(null);
    }
  };

  if (entries.length === 0) return null;

  return (
    <SettingsSection label={t("meetings.trash.title")}>
      <ul
        aria-label={t("meetings.trash.title")}
        className="divide-y divide-gray-alpha-400"
        data-slot="meetings-trash"
      >
        {entries.map((entry) => {
          const days = Math.ceil(
            (entry.expires_at_utc_ms - Date.now()) / DAY_MS,
          );
          return (
            <li
              key={entry.job_id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3.5"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[14px] leading-[21px] font-medium text-gray-1000">
                  {entry.title}
                </span>
                <Microlabel className="snap-measured tabular-nums">
                  {days > 0
                    ? t("meetings.trash.expires", {
                        deleted: formatEntryTimestamp(entry.deleted_at_utc_ms),
                        count: days,
                      })
                    : t("meetings.trash.expiresToday", {
                        deleted: formatEntryTimestamp(entry.deleted_at_utc_ms),
                      })}
                </Microlabel>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={restoring !== null}
                onClick={() => void restore(entry)}
              >
                {t("meetings.trash.restore")}
              </Button>
            </li>
          );
        })}
      </ul>
    </SettingsSection>
  );
};
