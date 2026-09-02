import React from "react";
import { AlertCircle, ChevronRight, LoaderCircle, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PersonListEntry } from "@/bindings";
import {
  Microlabel,
  SETTINGS_SURFACE,
  SettingsPage,
  SettingsSurface,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { formatEntryTimestamp } from "@/lib/utils/format";
import { EmptyStateRow } from "./EmptyStateRow";
import { organizationsFromEntries } from "./peopleModel";

export interface PeopleListViewProps {
  entries: PersonListEntry[] | null;
  error: boolean;
  onOpenPerson: (personId: string) => void;
  onOpenOrganization: (organization: string) => void;
  onRetry: () => void;
}

/* The organizations the list already carries, as a strip above it.
 *
 * Derived from the loaded rows rather than asked for: every person row already
 * says which organization they are at, so a second command for the same fact
 * would be a second answer to it. A corpus with no calendar domains on it draws
 * nothing here, which is the honest empty state — there is no organization to
 * name. */
const OrganizationStrip: React.FC<{
  entries: readonly PersonListEntry[];
  onOpen: (organization: string) => void;
}> = ({ entries, onOpen }) => {
  const { t } = useTranslation();
  const organizations = organizationsFromEntries(entries);
  if (organizations.length === 0) return null;

  return (
    <SettingsSurface data-slot="organizations-strip">
      <div className="flex flex-col gap-2 px-4 py-3">
        <Microlabel>{t("organizations.title")}</Microlabel>
        <div className="flex flex-wrap gap-1.5">
          {organizations.map((organization) => (
            <Button
              key={organization.name}
              type="button"
              variant="outline"
              size="sm"
              data-slot="organization-chip"
              onClick={() => onOpen(organization.name)}
            >
              <span>{organization.name}</span>
              <span className="text-gray-800 tabular-nums">
                {organization.count}
              </span>
            </Button>
          ))}
        </div>
      </div>
    </SettingsSurface>
  );
};

/* One person, one line: who they are, how many meetings you have had, and
 * when the last one was. Everything else about them — the meetings
 * themselves, what is still open, and how Sona connected them — is on their
 * own page, which is what this row opens. */
const PersonRow: React.FC<{
  entry: PersonListEntry;
  onOpen: () => void;
}> = ({ entry, onOpen }) => {
  const { t } = useTranslation();
  const lastMeeting = entry.last_meeting;

  return (
    <li data-slot="person-card">
      <button
        type="button"
        onClick={onOpen}
        className="hover-fast flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-start hover:bg-background-200 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 truncate text-[13px] leading-[19px] text-gray-1000">
            {entry.person.display_name}
          </span>
          {entry.person.organization === null ? null : (
            <span
              data-slot="person-organization"
              className="flex-none text-[10px] leading-4 text-gray-700"
            >
              {entry.person.organization}
            </span>
          )}
        </span>
        <span className="snap-measured flex flex-none items-center gap-1.5 text-[11px] text-gray-900 tabular-nums">
          <span>
            {t("people.list.meetings", { count: entry.confirmed_count })}
          </span>
          {lastMeeting === null ? null : (
            <>
              <span aria-hidden="true" className="text-gray-700">
                ·
              </span>
              <span>
                {t("peopleV2.list.lastMet", {
                  date: formatEntryTimestamp(lastMeeting.at_ms),
                })}
              </span>
            </>
          )}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 flex-none text-gray-700 rtl:rotate-180"
        />
      </button>
    </li>
  );
};

export const PeopleListView: React.FC<PeopleListViewProps> = ({
  entries,
  error,
  onOpenPerson,
  onOpenOrganization,
  onRetry,
}) => {
  const { t } = useTranslation();

  return (
    <SettingsPage title={t("people.title")} data-slot="people-page">
      {error ? (
        <SettingsSurface>
          <EmptyStateRow
            icon={AlertCircle}
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
              >
                {t("common.retry")}
              </Button>
            }
          >
            {t("people.list.loadError")}
          </EmptyStateRow>
        </SettingsSurface>
      ) : entries === null ? (
        <SettingsSurface>
          <EmptyStateRow icon={LoaderCircle}>
            {t("common.loading")}
          </EmptyStateRow>
        </SettingsSurface>
      ) : entries.length === 0 ? (
        <SettingsSurface>
          <EmptyStateRow icon={Users}>{t("people.list.empty")}</EmptyStateRow>
        </SettingsSurface>
      ) : (
        <>
          <OrganizationStrip entries={entries} onOpen={onOpenOrganization} />
          <ul
            role="list"
            aria-label={t("people.title")}
            data-slot="people-list"
            className={SETTINGS_SURFACE}
          >
            {entries.map((entry) => (
              <PersonRow
                key={entry.person.id}
                entry={entry}
                onOpen={() => onOpenPerson(entry.person.id)}
              />
            ))}
          </ul>
        </>
      )}
    </SettingsPage>
  );
};
