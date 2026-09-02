import React, { useState } from "react";
import { ArrowLeft, Ellipsis } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/vg/dropdown-menu";
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
  /* Absent in the person dialog the meeting-review band opens: a modal has no
   * place to put a page, and a label that looks like a link and goes nowhere
   * is worse than a label. The same absence `onOpenMeeting` resolves one level
   * up, for the same reason. */
  onOpenOrganization?: (organization: string) => void;
  onDelete: () => void;
  onSplit: (
    request: Omit<PersonSplitRequest, "source_person_id" | "expected_revision">,
  ) => void;
}

/**
 * A person's page reads as a page about that person: their name as the title,
 * then their derived organization and meeting count as one quiet line.
 *
 * The name is the field that edits it — click it and it becomes an input,
 * which commits on Enter or on leaving it and reverts on Escape. There is no
 * Save, because a rename is one value with a receipt behind it, and no "rename
 * this person?" dialog, because confirming a reversible edit of a name is
 * ceremony. Splitting, merging and deleting are the three things that change
 * who this person *is*, so they wait behind the row's own menu — the same
 * quiet glyph a meeting row and a mode row keep their operations behind — and
 * the two irreversible ones keep their confirmation.
 */
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
  onOpenOrganization,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(person.display_name);
  const [splitting, setSplitting] = useState(false);
  const [mergeConfirming, setMergeConfirming] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const mergeOptions = people.filter((entry) => entry.person.id !== person.id);
  const mergeTargetName = mergeOptions.find(
    (entry) => entry.person.id === mergeTarget,
  )?.person.display_name;
  const actionsLabel = t("people.detail.personActions");
  const meetingsLabel = t("people.list.meetings", {
    count: links.filter((link) => link.confidence === "confirmed").length,
  });
  const organization = person.organization ?? "";

  /* One commit path. Enter and Escape both blur the field; Escape puts the
   * saved name back first, so leaving the field is the only thing that ever
   * writes, and it writes only when the name actually changed. */
  const commitName = () => {
    setEditing(false);
    const trimmed = nameDraft.trim();
    if (trimmed === "" || trimmed === person.display_name) {
      setNameDraft(person.display_name);
      return;
    }
    onRename(trimmed);
  };

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

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          {editing ? (
            <Input
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setNameDraft(person.display_name);
                  event.currentTarget.blur();
                }
              }}
              aria-label={t("people.detail.nameLabel")}
              className="h-9 min-w-0 flex-1 sm:max-w-[360px] text-[18px] font-medium"
            />
          ) : (
            /* The title is the control. A bare button so the name keeps the page
             * title's own type, with the hover wash the only thing that says it
             * can be typed into. */
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setNameDraft(person.display_name);
                setEditing(true);
              }}
              title={t("people.detail.rename")}
              className="-mx-2 min-w-0 rounded-md px-2 py-0.5 text-start hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
            >
              <PageTitle className="truncate">{person.display_name}</PageTitle>
            </button>
          )}
          <p className="text-[11px] leading-4 text-gray-800 tabular-nums">
            {person.organization === null ? (
              meetingsLabel
            ) : onOpenOrganization === undefined ? (
              <span data-slot="person-organization">
                {`${person.organization} · ${meetingsLabel}`}
              </span>
            ) : (
              /* The label is the link. An organization has a page of its own —
               * everybody Sona knows there, and what is open across them — and
               * this is the only place the name already appears. */
              <>
                <button
                  type="button"
                  data-slot="person-organization"
                  onClick={() => onOpenOrganization(organization)}
                  className="-mx-1 rounded px-1 underline decoration-gray-alpha-400 underline-offset-2 hover:text-gray-1000 hover:decoration-gray-700 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
                >
                  {organization}
                </button>
                {` · ${meetingsLabel}`}
              </>
            )}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="flex-none text-gray-700 hover:text-gray-1000"
              aria-label={actionsLabel}
              title={actionsLabel}
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => setSplitting(true)}
            >
              {t("people.detail.split")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={pending || mergeOptions.length === 0}
              onSelect={() => setMergeConfirming(true)}
            >
              {t("people.detail.merge")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={pending}
              variant="destructive"
              onSelect={() => setDeleteConfirming(true)}
            >
              {t("people.detail.deletePerson")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {person.aliases.length === 0 ? null : (
        <p className="text-[11px] text-gray-800">
          {t("people.detail.aliases", { aliases: person.aliases.join(" · ") })}
        </p>
      )}

      <PersonSplitDialog
        open={splitting}
        onOpenChange={setSplitting}
        person={person}
        people={people}
        links={links}
        documents={documents}
        pending={pending}
        onSplit={onSplit}
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
