import React, { useCallback, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  commands,
  type Document,
  type DocumentListResult,
  type MeetingCommandError,
  type PeopleMutationResult,
  type PersonDetailResult,
  type PersonListEntry,
  type PersonMeetingLink,
  type PersonSplitRequest,
  type Result,
} from "@/bindings";
import { SettingsPage, SettingsSurface } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { EmptyStateRow } from "./EmptyStateRow";
import { PersonDetailView } from "./PersonDetailView";
import { usePeopleQuery } from "./usePeopleQuery";

interface LoadedPersonDetail {
  person: PersonDetailResult;
  documents: DocumentListResult;
  documentsLoadFailed: boolean;
  people: PersonListEntry[];
}

interface PersonDetailScreenProps {
  personId: string;
  onBack: () => void;
  onPersonChange: (personId: string) => void;
  onDeleted: () => void;
  /* Optional at exactly one caller: the person dialog the meeting-review
   * insights band opens has no meeting route to give, and threading one to it
   * would mean an `onOpenMeeting` prop on InsightsTab and the band as well —
   * the four-level drill this change removed from the ledger below. So the
   * absence is resolved here, once, and every surface under this line takes a
   * route it can rely on. */
  onOpenMeeting?: (meetingId: string) => void;
  /** Opens the organization page the header's label names. Absent at the same
   * caller `onOpenMeeting` is absent at, and for the same reason. */
  onOpenOrganization?: (organization: string) => void;
}

export const PersonDetailScreen: React.FC<PersonDetailScreenProps> = ({
  personId,
  onBack,
  onPersonChange,
  onDeleted,
  onOpenMeeting,
  onOpenOrganization,
}) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);

  const loadDetail = useCallback(async (): Promise<LoadedPersonDetail> => {
    const [personResult, documentResult, peopleResult] = await Promise.all([
      commands.personDetail(personId),
      commands.docList(personId),
      commands.peopleList(),
    ]);
    if (personResult.status === "error") {
      throw new Error(personResult.error);
    }

    return {
      person: personResult.data,
      documents:
        documentResult.status === "ok"
          ? documentResult.data
          : { schema_version: 1, revision: 0, entries: [] },
      documentsLoadFailed: documentResult.status === "error",
      people: peopleResult.status === "ok" ? peopleResult.data.entries : [],
    };
  }, [personId]);
  const {
    data: loaded,
    error: loadFailed,
    reload,
  } = usePeopleQuery(`person-detail:${personId}`, loadDetail);

  const reportMutationError = (error: MeetingCommandError | null) => {
    if (error === "stale_revision") {
      toast.error(t("people.errors.stale"));
    } else {
      toast.error(t("people.errors.operation"));
    }
  };

  const runPersonMutation = async (
    operation: () => Promise<Result<PeopleMutationResult, MeetingCommandError>>,
    onSuccess?: (nextPersonId: string | null) => boolean,
  ) => {
    setPending(true);
    try {
      const result = await operation();
      if (result.status === "error") {
        reportMutationError(result.error);
        await reload();
        return;
      }
      const reloadCurrentPerson =
        onSuccess?.(result.data.person?.id ?? null) ?? true;
      if (reloadCurrentPerson) await reload();
    } catch {
      reportMutationError(null);
    } finally {
      setPending(false);
    }
  };

  const rename = (displayName: string) => {
    if (loaded === null) return;
    void runPersonMutation(() =>
      commands.personRename({
        person_id: personId,
        display_name: displayName,
        expected_revision: loaded.person.revision,
      }),
    );
  };

  const merge = (targetPersonId: string) => {
    if (loaded === null) return;
    void runPersonMutation(
      () =>
        commands.personMerge({
          source_person_id: personId,
          target_person_id: targetPersonId,
          expected_revision: loaded.person.revision,
        }),
      (nextPersonId) => {
        onPersonChange(nextPersonId ?? targetPersonId);
        return false;
      },
    );
  };

  const deletePerson = () => {
    if (loaded === null) return;
    void runPersonMutation(
      () =>
        commands.personDelete({
          person_id: personId,
          expected_revision: loaded.person.revision,
        }),
      () => {
        onDeleted();
        return false;
      },
    );
  };

  const unlink = (link: PersonMeetingLink) => {
    if (loaded === null) return;
    void runPersonMutation(() =>
      commands.linkRemove({
        meeting_id: link.meeting.id,
        person_id: personId,
        expected_revision: loaded.person.revision,
      }),
    );
  };

  const confirmLink = (link: PersonMeetingLink) => {
    if (loaded === null) return;
    void runPersonMutation(() =>
      commands.linkConfirm({
        meeting_id: link.meeting.id,
        person_id: personId,
        expected_revision: loaded.person.revision,
      }),
    );
  };

  const split = (
    request: Omit<PersonSplitRequest, "source_person_id" | "expected_revision">,
  ) => {
    if (loaded === null) return;
    void runPersonMutation(
      () =>
        commands.personSplit({
          ...request,
          source_person_id: personId,
          expected_revision: loaded.person.revision,
        }),
      (nextPersonId) => {
        if (nextPersonId === null) return true;
        onPersonChange(nextPersonId);
        return false;
      },
    );
  };

  const importDocument = async () => {
    setPending(true);
    try {
      const path = await openDialog({
        directory: false,
        multiple: false,
        filters: [
          {
            name: t("people.detail.documentFilter"),
            extensions: ["txt", "md", "markdown"],
          },
        ],
      });
      if (path === null || Array.isArray(path)) return;
      const result = await commands.docIngest({
        path,
        operation_id: crypto.randomUUID(),
      });
      if (result.status === "error") {
        reportMutationError(result.error);
        return;
      }
      toast.success(t("people.detail.documentImported"));
      await reload();
    } catch {
      reportMutationError(null);
    } finally {
      setPending(false);
    }
  };

  const deleteDocument = (document: Document) => {
    if (loaded === null || loaded.documentsLoadFailed) return;
    setPending(true);
    void commands
      .docDelete({
        document_id: document.summary.id,
        expected_revision: loaded.documents.revision,
      })
      .then(async (result) => {
        if (result.status === "error") reportMutationError(result.error);
        await reload();
      })
      .catch(() => reportMutationError(null))
      .finally(() => setPending(false));
  };

  /* One model call on the person's own pack, so the button stays pressed until
   * the paragraph is back. A Mac with no engine answers with the page
   * unchanged, which is why there is nothing to report on success. */
  const regenerateSummary = () => {
    setPending(true);
    void commands
      .personSummaryRegenerate(personId)
      .then(async (result) => {
        if (result.status === "error") reportMutationError(result.error);
        await reload();
      })
      .catch(() => reportMutationError(null))
      .finally(() => setPending(false));
  };

  if (loaded !== null) {
    return (
      <PersonDetailView
        detail={loaded.person.detail}
        people={loaded.people}
        documents={loaded.documents.entries}
        documentsLoadFailed={loaded.documentsLoadFailed}
        pending={pending}
        onBack={onBack}
        onRename={rename}
        onMerge={merge}
        onDelete={deletePerson}
        onSplit={split}
        onConfirmLink={confirmLink}
        onUnlink={unlink}
        onImportDocument={() => void importDocument()}
        onDeleteDocument={deleteDocument}
        onOpenMeeting={onOpenMeeting ?? (() => {})}
        onOpenOrganization={onOpenOrganization}
        onRegenerateSummary={regenerateSummary}
      />
    );
  }

  return (
    <SettingsPage title={t("people.title")} data-slot="person-detail-state">
      <SettingsSurface>
        {loadFailed ? (
          <EmptyStateRow
            icon={AlertCircle}
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void reload()}
              >
                {t("common.retry")}
              </Button>
            }
          >
            {t("people.detail.loadError")}
          </EmptyStateRow>
        ) : (
          <EmptyStateRow icon={LoaderCircle}>
            {t("common.loading")}
          </EmptyStateRow>
        )}
      </SettingsSurface>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={onBack}
      >
        {t("meetings.actions.back")}
      </Button>
    </SettingsPage>
  );
};
