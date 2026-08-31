import React, { useState } from "react";
import { ArrowLeft, GitMerge, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  DocumentSummary,
  Person,
  PersonListEntry,
  PersonMeetingLink,
  PersonSplitRequest,
} from "@/bindings";
import { PageTitle } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { PeopleConfirmDialog } from "./PeopleConfirmDialog";
import { PersonSplitDialog } from "./PersonSplitDialog";

interface PersonHeaderProps {
  person: Person;
  people: PersonListEntry[];
  links: PersonMeetingLink[];
  documents: DocumentSummary[];
  pending: boolean;
  onBack: () => void;
  onRename: (displayName: string) => void;
  onMerge: (targetPersonId: string) => void;
  onDelete: () => void;
  onSplit: (
    request: Omit<PersonSplitRequest, "source_person_id" | "expected_revision">,
  ) => void;
}

export const PersonHeader: React.FC<PersonHeaderProps> = ({
  person,
  people,
  links,
  documents,
  pending,
  onBack,
  onRename,
  onMerge,
  onDelete,
  onSplit,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(person.display_name);
  const [renameConfirming, setRenameConfirming] = useState(false);
  const [mergeConfirming, setMergeConfirming] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const trimmedName = nameDraft.trim();
  const mergeOptions = people.filter((entry) => entry.person.id !== person.id);
  const mergeTargetName = mergeOptions.find(
    (entry) => entry.person.id === mergeTarget,
  )?.person.display_name;

  return (
    <div className="flex flex-col gap-4" data-slot="person-header">
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

      <div className="flex flex-wrap items-start justify-between gap-4">
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Input
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              aria-label={t("people.detail.nameLabel")}
              className="h-9 max-w-[360px] text-[18px] font-medium"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setNameDraft(person.display_name);
                setEditing(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                trimmedName.length === 0 || trimmedName === person.display_name
              }
              onClick={() => setRenameConfirming(true)}
            >
              {t("common.save")}
            </Button>
          </div>
        ) : (
          <PageTitle>{person.display_name}</PageTitle>
        )}

        {editing ? null : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setEditing(true)}
            >
              <Pencil aria-hidden="true" />
              {t("people.detail.rename")}
            </Button>
            <PersonSplitDialog
              person={person}
              people={people}
              links={links}
              documents={documents}
              pending={pending}
              onSplit={onSplit}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || mergeOptions.length === 0}
              onClick={() => setMergeConfirming(true)}
            >
              <GitMerge aria-hidden="true" />
              {t("people.detail.merge")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-red-900 hover:text-red-900"
              disabled={pending}
              onClick={() => setDeleteConfirming(true)}
            >
              <Trash2 aria-hidden="true" />
              {t("people.detail.deletePerson")}
            </Button>
          </div>
        )}
      </div>

      {person.aliases.length === 0 ? null : (
        <p className="font-mono text-[11px] text-gray-800">
          {t("people.detail.aliases", { aliases: person.aliases.join(" · ") })}
        </p>
      )}

      <PeopleConfirmDialog
        open={renameConfirming}
        onOpenChange={setRenameConfirming}
        title={t("people.detail.renameTitle")}
        description={t("people.detail.renameDescription", {
          name: trimmedName,
        })}
        confirmLabel={t("people.detail.rename")}
        pending={pending}
        onConfirm={() => {
          setEditing(false);
          onRename(trimmedName);
        }}
      />

      <PeopleConfirmDialog
        open={mergeConfirming}
        onOpenChange={setMergeConfirming}
        title={t("people.detail.mergeTitle")}
        description={t("people.detail.mergeDescription", {
          source: person.display_name,
          target: mergeTargetName ?? t("people.detail.mergeTarget"),
        })}
        confirmLabel={t("people.detail.merge")}
        pending={pending || mergeTarget === null}
        destructive
        onConfirm={() => {
          if (mergeTarget !== null) onMerge(mergeTarget);
        }}
      >
        <Select value={mergeTarget ?? undefined} onValueChange={setMergeTarget}>
          <SelectTrigger
            size="sm"
            className="w-full"
            aria-label={t("people.detail.mergeTarget")}
          >
            <SelectValue placeholder={t("people.detail.mergeTarget")} />
          </SelectTrigger>
          <SelectContent>
            {mergeOptions.map((entry) => (
              <SelectItem key={entry.person.id} value={entry.person.id}>
                {entry.person.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PeopleConfirmDialog>

      <PeopleConfirmDialog
        open={deleteConfirming}
        onOpenChange={setDeleteConfirming}
        title={t("people.detail.deleteTitle")}
        description={t("people.detail.deleteDescription", {
          name: person.display_name,
        })}
        confirmLabel={t("people.detail.deletePerson")}
        pending={pending}
        destructive
        onConfirm={onDelete}
      />
    </div>
  );
};
