import React from "react";
import { CheckCheck, CircleDashed, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MeetingLoopStatus,
  PersonCommitment,
  PersonOpenLoop,
} from "@/bindings";
import { LoopStatusChip } from "@/components/settings/meetings/review/LoopRows";
import { SettingsSection } from "@/components/settings/rows";
import { formatEntryTimestamp } from "@/lib/utils/format";
import { EmptyStateRow } from "./EmptyStateRow";

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
}

/* The sentence first, then the meeting it came from. The meeting is a link,
 * not a caption — reading "who owns the launch checklist?" is the moment you
 * want to be back in the room where it was asked. */
const LedgerSection: React.FC<{
  label: string;
  emptyIcon: LucideIcon;
  emptyText: string;
  rows: LedgerRow[];
  onOpenMeeting: (meetingId: string) => void;
}> = ({ label, emptyIcon, emptyText, rows, onOpenMeeting }) => {
  const { t } = useTranslation();

  return (
    <SettingsSection label={label}>
      {rows.length === 0 ? (
        <EmptyStateRow icon={emptyIcon}>{emptyText}</EmptyStateRow>
      ) : (
        <ul className="divide-y divide-gray-alpha-400">
          {rows.map((row) => (
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
      )}
    </SettingsSection>
  );
};

export const PersonOpenLoops: React.FC<{
  openLoops: PersonOpenLoop[];
  onOpenMeeting: (meetingId: string) => void;
}> = ({ openLoops, onOpenMeeting }) => {
  const { t } = useTranslation();

  return (
    <LedgerSection
      label={t("peopleV2.detail.openLoops")}
      emptyIcon={CircleDashed}
      emptyText={t("people.detail.noOpenLoops")}
      rows={openLoops.map((loop) => ({
        key: loop.loop_id,
        text: loop.text,
        title: loop.title,
        meetingId: loop.meeting_id,
        atUtcMs: loop.at_utc_ms,
        carriedSinceUtcMs: loop.carried_since_at_utc_ms,
        status: loop.status,
      }))}
      onOpenMeeting={onOpenMeeting}
    />
  );
};

export const PersonCommitments: React.FC<{
  commitments: PersonCommitment[];
  onOpenMeeting: (meetingId: string) => void;
}> = ({ commitments, onOpenMeeting }) => {
  const { t } = useTranslation();

  return (
    <LedgerSection
      label={t("people.detail.commitments")}
      emptyIcon={CheckCheck}
      emptyText={t("people.detail.noCommitments")}
      rows={commitments.map((commitment) => ({
        key: commitment.loop_id,
        text: commitment.text,
        title: commitment.title,
        meetingId: commitment.meeting_id,
        atUtcMs: commitment.at_utc_ms,
        carriedSinceUtcMs: null,
        status: commitment.status,
      }))}
      onOpenMeeting={onOpenMeeting}
    />
  );
};
