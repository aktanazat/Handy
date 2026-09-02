import React from "react";
import { ArrowLeft, ChevronRight, ListChecks, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OrganizationDetail } from "@/bindings";
import {
  PageTitle,
  SettingsPage,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { formatEntryTimestamp } from "@/lib/utils/format";
import { EmptyStateRow } from "./EmptyStateRow";

export interface OrganizationViewProps {
  detail: OrganizationDetail;
  onBack: () => void;
  onOpenPerson: (personId: string) => void;
  onOpenMeeting: (meetingId: string) => void;
}

/* One organization, read across its people.
 *
 * The same three sections a person's page has, in the same order and out of the
 * same row shapes — who, what you met about, what is still open — because an
 * organization is not a different kind of noun here, it is a set of people. It
 * owns no mutation: nothing on this page changes anything, and everything that
 * could is one row away on the person it belongs to.
 */
export const OrganizationView: React.FC<OrganizationViewProps> = ({
  detail,
  onBack,
  onOpenPerson,
  onOpenMeeting,
}) => {
  const { t } = useTranslation();

  return (
    <SettingsPage
      data-slot="organization-detail"
      header={
        <div className="flex flex-col gap-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit -ms-2"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" />
            {t("meetings.actions.back")}
          </Button>
          <div className="flex min-w-0 flex-col gap-1">
            <PageTitle className="truncate">{detail.name}</PageTitle>
            <p className="text-[11px] leading-4 text-gray-800 tabular-nums">
              {t("organizations.detail.people", {
                count: detail.people.length,
              })}
            </p>
          </div>
        </div>
      }
    >
      <SettingsSection label={t("organizations.detail.peopleHere")}>
        {detail.people.length === 0 ? (
          <EmptyStateRow icon={Users}>
            {t("organizations.detail.noPeople")}
          </EmptyStateRow>
        ) : (
          <ul role="list" className="divide-y divide-gray-alpha-400">
            {detail.people.map((entry) => (
              <li key={entry.person.id} data-slot="organization-person">
                <button
                  type="button"
                  onClick={() => onOpenPerson(entry.person.id)}
                  className="hover-fast flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-start hover:bg-background-200 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-[19px] text-gray-1000">
                    {entry.person.display_name}
                  </span>
                  <span className="flex-none text-[11px] text-gray-900 tabular-nums">
                    {t("people.list.meetings", {
                      count: entry.confirmed_count,
                    })}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 flex-none text-gray-700 rtl:rotate-180"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection label={t("organizations.detail.recentMeetings")}>
        {detail.recent_meetings.length === 0 ? (
          <EmptyStateRow icon={Users}>
            {t("people.detail.noMeetings")}
          </EmptyStateRow>
        ) : (
          <ul className="divide-y divide-gray-alpha-400">
            {detail.recent_meetings.map((meeting) => (
              <li key={meeting.id} data-slot="organization-meeting">
                <button
                  type="button"
                  onClick={() => onOpenMeeting(meeting.id)}
                  className="hover-fast flex w-full min-w-0 flex-col gap-0.5 px-4 py-3 text-start hover:bg-background-200 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
                >
                  <span className="text-[13px] leading-[19px] text-gray-1000">
                    {meeting.title}
                  </span>
                  <span className="text-[11px] leading-4 text-gray-800 tabular-nums">
                    {meeting.headline === null
                      ? formatEntryTimestamp(meeting.at_utc_ms)
                      : `${meeting.headline} · ${formatEntryTimestamp(meeting.at_utc_ms)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection label={t("peopleV2.detail.openLoops")}>
        {detail.open_loops.length === 0 ? (
          <EmptyStateRow icon={ListChecks}>
            {t("people.detail.noOpenLoops")}
          </EmptyStateRow>
        ) : (
          <ul className="divide-y divide-gray-alpha-400">
            {detail.open_loops.map((openLoop) => (
              <li key={openLoop.loop_id} data-slot="organization-loop">
                <button
                  type="button"
                  onClick={() => onOpenMeeting(openLoop.meeting_id)}
                  className="hover-fast flex w-full min-w-0 flex-col gap-0.5 px-4 py-3 text-start hover:bg-background-200 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
                >
                  <span className="text-[13px] leading-[19px] text-gray-1000">
                    {openLoop.text}
                  </span>
                  <span className="text-[11px] leading-4 text-gray-800 tabular-nums">
                    {`${openLoop.title} · ${formatEntryTimestamp(openLoop.at_utc_ms)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </SettingsPage>
  );
};
