import React from "react";
import { CircleDashed } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PersonLinkSource, PersonMeetingLink } from "@/bindings";
import { SettingsSection } from "@/components/settings/rows";
import { EmptyStateRow } from "./EmptyStateRow";
import { EvidenceChip } from "./EvidenceChip";

/* The order these are read in, which is also how strong they are: an invite
 * names a person outright, a voice match is recognition, a title is a guess,
 * and a manual link is you. */
const EVIDENCE_ORDER = [
  "calendar",
  "speaker",
  "title",
  "manual",
] as const satisfies readonly PersonLinkSource[];

/* `satisfies` keeps the literal keyed type while proving every
 * `PersonLinkSource` has a slot, so `counts[link.source]` stays checked. */
const countLinksBySource = (links: PersonMeetingLink[]) => {
  const counts = {
    calendar: 0,
    speaker: 0,
    title: 0,
    manual: 0,
  } satisfies Record<PersonLinkSource, number>;
  for (const link of links) counts[link.source] += 1;
  return counts;
};

/**
 * Why Sona believes these meetings belong to this person, in the plainest form
 * the record supports: one row per kind of evidence, and how many meetings
 * carry it. It reads out of the links already on screen above, so nothing here
 * asks the backend a second question.
 */
export const PersonEvidence: React.FC<{ links: PersonMeetingLink[] }> = ({
  links,
}) => {
  const { t } = useTranslation();
  const counts = countLinksBySource(links);
  const sources = EVIDENCE_ORDER.filter((source) => counts[source] > 0);

  return (
    <SettingsSection label={t("peopleV2.detail.howSonaKnows")}>
      {sources.length === 0 ? (
        <EmptyStateRow icon={CircleDashed}>
          {t("peopleV2.detail.noEvidence")}
        </EmptyStateRow>
      ) : (
        <ul className="divide-y divide-gray-alpha-400">
          {sources.map((source) => (
            <li
              key={source}
              data-slot="person-evidence-row"
              className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5"
            >
              <EvidenceChip source={source} />
              <span className="snap-measured flex-none text-[11px] text-gray-800 tabular-nums">
                {t("people.list.meetings", { count: counts[source] })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
};
