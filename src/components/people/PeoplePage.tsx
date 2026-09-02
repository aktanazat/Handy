import React, { useCallback, useEffect, useState } from "react";
import { commands } from "@/bindings";
import { OrganizationView } from "./OrganizationView";
import { PeopleListView } from "./PeopleList";
import { PersonDetailScreen } from "./PersonDetailScreen";
import { usePeopleQuery } from "./usePeopleQuery";

interface PeoplePageProps {
  /* The shell's meeting route, so a line on a person's page can open the
   * meeting it was said in. Optional because `sidebarSections` types every
   * destination as a bare component; App.tsx is the only caller and always
   * passes one. */
  onOpenMeeting?: (meetingId: string) => void;
  /* A person the shell was asked to open — `sona://person/<id>` from a deep
   * link or a ⌘K row. The nonce is what makes the same person twice a second
   * request: without it, coming back to the list and picking the same row from
   * the palette again would set state that is already set and change nothing. */
  personRequest?: { personId: string; nonce: number } | null;
  /* An organization the shell was asked to open — `sona://organization/<slug>`.
   * The nonce means the same thing it does above. */
  organizationRequest?: { slug: string; nonce: number } | null;
}

/* People, one person, one organization: three screens behind one rail entry.
 *
 * An organization is not a rail destination of its own because it is not a
 * fourth kind of noun — it is a slice of this list, reached from a label on it
 * or on the person's page, and it goes back to whichever of the two opened it.
 */
export const PeoplePage: React.FC<PeoplePageProps> = ({
  onOpenMeeting,
  personRequest,
  organizationRequest,
}) => {
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [organization, setOrganization] = useState<string | null>(null);
  useEffect(() => {
    if (personRequest) {
      setOrganization(null);
      setSelectedPersonId(personRequest.personId);
    }
  }, [personRequest]);
  useEffect(() => {
    if (organizationRequest) {
      setSelectedPersonId(null);
      setOrganization(organizationRequest.slug);
    }
  }, [organizationRequest]);
  const loadPeople = useCallback(async () => {
    const result = await commands.peopleList();
    if (result.status === "error") throw new Error(result.error);
    return result.data;
  }, []);
  const { data, error, reload } = usePeopleQuery("people-list", loadPeople);

  /* The label from a chip and the slug from a link are the same key: the
   * command slugifies whatever it is given, so neither side derives the slug. */
  const loadOrganization = useCallback(async () => {
    if (organization === null) return null;
    const result = await commands.organizationDetail(organization);
    if (result.status === "error") throw new Error(result.error);
    return result.data;
  }, [organization]);
  const { data: organizationDetail } = usePeopleQuery(
    `organization:${organization ?? ""}`,
    loadOrganization,
  );

  if (selectedPersonId !== null) {
    return (
      <PersonDetailScreen
        key={selectedPersonId}
        personId={selectedPersonId}
        onBack={() => setSelectedPersonId(null)}
        onPersonChange={setSelectedPersonId}
        onDeleted={() => {
          setSelectedPersonId(null);
          void reload();
        }}
        onOpenMeeting={onOpenMeeting}
        onOpenOrganization={(name) => {
          setSelectedPersonId(null);
          setOrganization(name);
        }}
      />
    );
  }

  if (organization !== null && organizationDetail !== null) {
    return (
      <OrganizationView
        detail={organizationDetail.detail}
        onBack={() => setOrganization(null)}
        onOpenPerson={(personId) => {
          setOrganization(null);
          setSelectedPersonId(personId);
        }}
        onOpenMeeting={onOpenMeeting ?? (() => {})}
      />
    );
  }

  return (
    <PeopleListView
      entries={data?.entries ?? null}
      error={error}
      onOpenPerson={setSelectedPersonId}
      onOpenOrganization={setOrganization}
      onRetry={() => void reload()}
    />
  );
};
