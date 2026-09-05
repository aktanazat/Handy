import React from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
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

/* The row every list on this page is written in: one hairline-separated button,
 * a title in the row tier over one Meta line. The people list reads across
 * instead of down — a name and a count on one line — so it takes the same
 * padding with a row axis. */
/* `ring-inset` because a settings surface clips its overflow: an outset ring
 * on a full-width row is drawn outside the surface and never seen. */
const ROW_BUTTON =
  "hover-fast flex w-full min-w-0 px-6 py-3.5 text-start transition-colors motion-reduce:transition-none hover:bg-background-200 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset focus-visible:outline-none";
const ROW_STACK = `${ROW_BUTTON} flex-col gap-1`;
const ROW_LINE = `${ROW_BUTTON} items-center gap-4`;
const ROW_TITLE = "text-[14px] leading-[21px] font-medium text-gray-1000";
const ROW_META = "text-[13px] leading-[18px] text-gray-900 tabular-nums";

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
      className="gap-6"
      header={
        <div className="flex flex-col gap-3">
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
          <div className="flex min-w-0 flex-col gap-1.5">
            <PageTitle className="truncate">{detail.name}</PageTitle>
            <p className={ROW_META}>
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
          <EmptyStateRow>{t("organizations.detail.noPeople")}</EmptyStateRow>
        ) : (
          <ul role="list" className="divide-y divide-gray-alpha-400">
            {detail.people.map((entry) => (
              <li key={entry.person.id} data-slot="organization-person">
                <button
                  type="button"
                  onClick={() => onOpenPerson(entry.person.id)}
                  className={ROW_LINE}
                >
                  <span className={`min-w-0 flex-1 truncate ${ROW_TITLE}`}>
                    {entry.person.display_name}
                  </span>
                  <span className={`flex-none ${ROW_META}`}>
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
          <EmptyStateRow>{t("people.detail.noMeetings")}</EmptyStateRow>
        ) : (
          <ul className="divide-y divide-gray-alpha-400">
            {detail.recent_meetings.map((meeting) => (
              <li key={meeting.id} data-slot="organization-meeting">
                <button
                  type="button"
                  onClick={() => onOpenMeeting(meeting.id)}
                  className={ROW_STACK}
                >
                  <span className={ROW_TITLE}>{meeting.title}</span>
                  <span className={ROW_META}>
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
          <EmptyStateRow>{t("people.detail.noOpenLoops")}</EmptyStateRow>
        ) : (
          <ul className="divide-y divide-gray-alpha-400">
            {detail.open_loops.map((openLoop) => (
              <li key={openLoop.loop_id} data-slot="organization-loop">
                <button
                  type="button"
                  onClick={() => onOpenMeeting(openLoop.meeting_id)}
                  className={ROW_STACK}
                >
                  <span className="text-[14px] leading-[21px] text-gray-1000 text-pretty">
                    {openLoop.text}
                  </span>
                  <span className={ROW_META}>
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
