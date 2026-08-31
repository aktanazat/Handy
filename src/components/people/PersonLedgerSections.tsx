import React from "react";
import { CheckCheck, CircleDashed, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MeetingLoopStatus,
  PersonCommitment,
  PersonOpenLoop,
} from "@/bindings";
import { LoopStatusChip } from "@/components/settings/meetings/review/LoopRows";
import { Microlabel, SettingsSection } from "@/components/settings/rows";
import { formatEntryTimestamp } from "@/lib/utils/format";
import { EmptyStateRow } from "./EmptyStateRow";
import { groupByDirection } from "./loopDirection";

/* One thing said in one meeting, in the shape both ledgers keep it.
 *
 * Open loops and commitments are two questions about the same record, which is
 * why they render through one section below rather than two copies of it. What
 * differs is the heading, the empty state, and whether a line carries the date
 * it was first raised — so those are fields, not a second component. */
interface LedgerRow {
  /** React key: the loop's own id, which is stable across re-reads. */
  key: string;
  text: string;
  /** The meeting the line was said in, as the link's own label. */
  title: string;
  meetingId: string;
  atUtcMs: number;
  /** When the loop was first raised, for a line that has outlived a meeting. */
  carriedSinceUtcMs: number | null;
  /** Where the loop stands now, read live from its store row. */
  status: MeetingLoopStatus;
  /** D27: this person has owed it for longer than a working week. */
  stale: boolean;
}

/* The sentence first, then the meeting it came from. The meeting is a link,
 * not a caption — reading "who owns the launch checklist?" is the moment you
 * want to be back in the room where it was asked.
 *
 * Two groups inside one section, not two sections: "I owe" and "waiting on
 * them" are the same register read from opposite ends, and splitting the card
 * would make a page of four headings out of a page of two. A group with
 * nothing in it says nothing; the section's own empty state covers the case
 * where neither has anything. */
const LedgerSection: React.FC<{
  label: string;
  emptyIcon: LucideIcon;
  emptyText: string;
  mine: LedgerRow[];
  waitingOn: LedgerRow[];
  waitingOnLabel: string;
  onOpenMeeting: (meetingId: string) => void;
}> = ({
  label,
  emptyIcon,
  emptyText,
  mine,
  waitingOn,
  waitingOnLabel,
  onOpenMeeting,
}) => {
  const { t } = useTranslation();

  if (mine.length === 0 && waitingOn.length === 0) {
    return (
      <SettingsSection label={label}>
        <EmptyStateRow icon={emptyIcon}>{emptyText}</EmptyStateRow>
      </SettingsSection>
    );
  }

  const groups = [
    { key: "mine", heading: t("people.waitingOn.iOwe"), rows: mine },
    { key: "waitingOn", heading: waitingOnLabel, rows: waitingOn },
  ].filter((group) => group.rows.length > 0);

  return (
    <SettingsSection label={label}>
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col">
          <h3 className="px-4 pt-3 pb-1">
            <Microlabel>{group.heading}</Microlabel>
          </h3>
          <ul className="divide-y divide-gray-alpha-400 border-t border-gray-alpha-400">
            {group.rows.map((row) => (
              <li key={row.key} className="flex flex-col gap-1.5 px-4 py-3">
                <p className="text-[13px] leading-5 text-gray-1000 text-pretty">
                  {row.text}
                </p>
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={() => onOpenMeeting(row.meetingId)}
                    className="rounded-md text-[13px] leading-5 text-blue-900 hover:underline focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
                  >
                    {row.title}
                  </button>
                  <span className="snap-measured text-[11px] text-gray-800 tabular-nums">
                    {formatEntryTimestamp(row.atUtcMs)}
                  </span>
                  <LoopStatusChip status={row.status} />
                  {row.stale ? (
                    <span
                      data-slot="loop-stale"
                      className="text-[11px] whitespace-nowrap text-red-900"
                    >
                      {t("people.waitingOn.stale")}
                    </span>
                  ) : null}
                  {row.carriedSinceUtcMs === null ? null : (
                    <span className="snap-measured text-[11px] text-gray-800 tabular-nums">
                      {t("people.detail.carriedSince", {
                        date: formatEntryTimestamp(row.carriedSinceUtcMs),
                      })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </SettingsSection>
  );
};

export const PersonOpenLoops: React.FC<{
  openLoops: PersonOpenLoop[];
  /** Whose page this is, for the "waiting on them" heading. */
  personName: string;
  onOpenMeeting: (meetingId: string) => void;
}> = ({ openLoops, personName, onOpenMeeting }) => {
  const { t } = useTranslation();
  const grouped = groupByDirection(openLoops);
  const asRow = (loop: PersonOpenLoop): LedgerRow => ({
    key: loop.loop_id,
    text: loop.text,
    title: loop.title,
    meetingId: loop.meeting_id,
    atUtcMs: loop.at_utc_ms,
    carriedSinceUtcMs: loop.carried_since_at_utc_ms,
    status: loop.status,
    stale: loop.waiting_on_stale,
  });

  return (
    <LedgerSection
      label={t("peopleV2.detail.openLoops")}
      emptyIcon={CircleDashed}
      emptyText={t("people.detail.noOpenLoops")}
      mine={grouped.mine.map(asRow)}
      waitingOn={grouped.waitingOn.map(asRow)}
      waitingOnLabel={t("people.waitingOn.them", { name: personName })}
      onOpenMeeting={onOpenMeeting}
    />
  );
};

export const PersonCommitments: React.FC<{
  commitments: PersonCommitment[];
  personName: string;
  onOpenMeeting: (meetingId: string) => void;
}> = ({ commitments, personName, onOpenMeeting }) => {
  const { t } = useTranslation();
  const grouped = groupByDirection(commitments);
  const asRow = (commitment: PersonCommitment): LedgerRow => ({
    key: commitment.loop_id,
    text: commitment.text,
    title: commitment.title,
    meetingId: commitment.meeting_id,
    atUtcMs: commitment.at_utc_ms,
    carriedSinceUtcMs: null,
    status: commitment.status,
    stale: commitment.waiting_on_stale,
  });

  return (
    <LedgerSection
      label={t("people.detail.commitments")}
      emptyIcon={CheckCheck}
      emptyText={t("people.detail.noCommitments")}
      mine={grouped.mine.map(asRow)}
      waitingOn={grouped.waitingOn.map(asRow)}
      waitingOnLabel={t("people.waitingOn.them", { name: personName })}
      onOpenMeeting={onOpenMeeting}
    />
  );
};
