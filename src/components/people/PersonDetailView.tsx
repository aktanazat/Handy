import React from "react";
import { useTranslation } from "react-i18next";
import type {
  Document,
  PersonDetail,
  PersonListEntry,
  PersonMeetingLink,
  PersonSplitRequest,
} from "@/bindings";
import { SettingsPage } from "@/components/settings/rows";
import { ChartCard } from "@/components/charts";
import { Bars } from "@/components/vg/chart";
import { formatEntryTimestamp } from "@/lib/utils/format";
import { PersonDocuments } from "./PersonDocuments";
import { PersonHeader } from "./PersonHeader";
import { PersonLedgerSections } from "./PersonLedgerSections";
import { PersonMeetings } from "./PersonMeetings";
import {
  confirmedPersonLinks,
  latestConfirmedMeetingAt,
  monthlyMeetingCadence,
} from "./peopleModel";

export interface PersonDetailViewProps {
  detail: PersonDetail;
  people: PersonListEntry[];
  documents: Document[];
  documentsLoadFailed: boolean;
  pending: boolean;
  onBack: () => void;
  onRename: (displayName: string) => void;
  onMerge: (targetPersonId: string) => void;
  onDelete: () => void;
  onSplit: (
    request: Omit<PersonSplitRequest, "source_person_id" | "expected_revision">,
  ) => void;
  onConfirmLink: (link: PersonMeetingLink) => void;
  onUnlink: (link: PersonMeetingLink) => void;
  onImportDocument: () => void;
  onDeleteDocument: (document: Document) => void;
}

export const PersonDetailView: React.FC<PersonDetailViewProps> = ({
  detail,
  people,
  documents,
  documentsLoadFailed,
  pending,
  onBack,
  onRename,
  onMerge,
  onDelete,
  onSplit,
  onConfirmLink,
  onUnlink,
  onImportDocument,
  onDeleteDocument,
}) => {
  const { t } = useTranslation();
  const confirmedLinks = confirmedPersonLinks(detail.links);
  const cadence = monthlyMeetingCadence(confirmedLinks);
  const latestMeetingAt = latestConfirmedMeetingAt(confirmedLinks);
  const talkShare =
    detail.talk_share_avg_permille === null
      ? null
      : `${(detail.talk_share_avg_permille / 10).toLocaleString(undefined, {
          maximumFractionDigits: 1,
        })}%`;
  const footerFacts = [
    ...(latestMeetingAt === null
      ? []
      : [
          {
            label: t("people.detail.lastMeeting"),
            value: formatEntryTimestamp(latestMeetingAt),
          },
        ]),
    ...(talkShare === null
      ? []
      : [{ label: t("people.detail.talkShare"), value: talkShare }]),
  ];

  return (
    <SettingsPage
      data-slot="person-detail"
      header={
        <PersonHeader
          key={`${detail.person.id}:${detail.person.display_name}`}
          person={detail.person}
          people={people}
          links={detail.links}
          documents={detail.documents}
          pending={pending}
          onBack={onBack}
          onRename={onRename}
          onMerge={onMerge}
          onDelete={onDelete}
          onSplit={onSplit}
        />
      }
    >
      {confirmedLinks.length === 0 ? null : (
        <ChartCard
          data-slot="person-cadence"
          label={t("people.detail.cadence")}
          metric={confirmedLinks.length}
          footerFacts={footerFacts}
        >
          <Bars
            data-slot="person-cadence-bars"
            values={cadence}
            ariaLabel={t("people.detail.cadenceAria", {
              values: cadence.join(", "),
            })}
          />
        </ChartCard>
      )}

      <PersonLedgerSections
        openLoops={detail.open_loops}
        commitments={detail.commitments}
      />
      <PersonMeetings
        links={detail.links}
        pending={pending}
        onConfirm={onConfirmLink}
        onUnlink={onUnlink}
      />
      <PersonDocuments
        documents={documents}
        loadFailed={documentsLoadFailed}
        pending={pending}
        onImport={onImportDocument}
        onDelete={onDeleteDocument}
      />
    </SettingsPage>
  );
};
