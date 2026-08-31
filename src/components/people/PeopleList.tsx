import React from "react";
import { AlertCircle, ChevronRight, LoaderCircle, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PersonListEntry } from "@/bindings";
import {
  Microlabel,
  SETTINGS_CARD,
  SettingsPage,
  SettingsSurface,
} from "@/components/settings/rows";
import { SpeakerBubbles } from "@/components/settings/meetings/home/SpeakerBubbles";
import { Button } from "@/components/vg/button";
import { formatEntryTimestamp } from "@/lib/utils/format";
import { EmptyStateRow } from "./EmptyStateRow";
import { EvidenceChip } from "./EvidenceChip";

export interface PeopleListViewProps {
  entries: PersonListEntry[] | null;
  error: boolean;
  onOpenPerson: (personId: string) => void;
  onRetry: () => void;
}

const PersonCard: React.FC<{
  entry: PersonListEntry;
  onOpen: () => void;
}> = ({ entry, onOpen }) => {
  const { t } = useTranslation();
  const lastMeeting = entry.last_meeting;
  const lastMeetingCopy =
    lastMeeting?.headline?.text ?? lastMeeting?.title ?? null;

  return (
    <li data-slot="person-card" className={`${SETTINGS_CARD} overflow-hidden`}>
      <button
        type="button"
        className="flex w-full min-w-0 flex-col gap-3 px-5 py-4 text-start transition-colors hover:bg-background-200 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
        onClick={onOpen}
      >
        <span className="flex w-full min-w-0 items-center justify-between gap-4">
          <SpeakerBubbles speakers={[entry.person.display_name]} />
          <span className="flex flex-none items-center font-mono text-[11px] text-gray-800 tabular-nums">
            <span>
              {t("people.list.meetings", { count: entry.confirmed_count })}
            </span>
            {lastMeeting === null ? null : (
              <>
                <span aria-hidden="true" className="px-1.5 text-gray-700">
                  /
                </span>
                <span>
                  {t("people.list.last", {
                    date: formatEntryTimestamp(lastMeeting.at_ms),
                  })}
                </span>
              </>
            )}
          </span>
        </span>
        {lastMeetingCopy === null ? null : (
          <span className="w-full truncate text-[13px] leading-[18px] text-gray-900">
            {lastMeetingCopy}
          </span>
        )}
        {entry.evidence_sources.length === 0 ? null : (
          <span className="flex flex-wrap gap-1.5">
            {entry.evidence_sources.map((source) => (
              <EvidenceChip key={source} source={source} />
            ))}
          </span>
        )}
      </button>

      {entry.suggested_count === 0 ? null : (
        <button
          type="button"
          data-slot="suggested-links"
          className="flex min-h-[44px] w-full items-center justify-between gap-3 border-t border-gray-alpha-400 bg-background-200 px-4 py-2 text-start transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
          onClick={onOpen}
        >
          <Microlabel>
            {t("people.list.suggested", { count: entry.suggested_count })}
          </Microlabel>
          <ChevronRight aria-hidden="true" className="size-4 text-gray-700" />
        </button>
      )}
    </li>
  );
};

export const PeopleListView: React.FC<PeopleListViewProps> = ({
  entries,
  error,
  onOpenPerson,
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
        <ul
          role="list"
          aria-label={t("people.title")}
          data-slot="people-list"
          className="flex flex-col gap-2"
        >
          {entries.map((entry) => (
            <PersonCard
              key={entry.person.id}
              entry={entry}
              onOpen={() => onOpenPerson(entry.person.id)}
            />
          ))}
        </ul>
      )}
    </SettingsPage>
  );
};
