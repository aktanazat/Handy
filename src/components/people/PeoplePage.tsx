import React, { useCallback, useEffect, useState } from "react";
import { commands } from "@/bindings";
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
}

export const PeoplePage: React.FC<PeoplePageProps> = ({
  onOpenMeeting,
  personRequest,
}) => {
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  useEffect(() => {
    if (personRequest) setSelectedPersonId(personRequest.personId);
  }, [personRequest]);
  const loadPeople = useCallback(async () => {
    const result = await commands.peopleList();
    if (result.status === "error") throw new Error(result.error);
    return result.data;
  }, []);
  const { data, error, reload } = usePeopleQuery("people-list", loadPeople);

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
      />
    );
  }

  return (
    <PeopleListView
      entries={data?.entries ?? null}
      error={error}
      onOpenPerson={setSelectedPersonId}
      onRetry={() => void reload()}
    />
  );
};
