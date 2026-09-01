import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DocumentSummary,
  Person,
  PersonListEntry,
  PersonMeetingLink,
  PersonSplitRequest,
} from "@/bindings";
import { Microlabel } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Checkbox } from "@/components/vg/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { formatEntryTimestamp } from "@/lib/utils/format";

const CREATE_TARGET = "__create_person__";

interface SplitOption {
  value: string;
  label: React.ReactNode;
}

const SplitSelectionGroup: React.FC<{
  idPrefix: string;
  label: string;
  options: SplitOption[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
}> = ({ idPrefix, label, options, selected, onChange }) => {
  if (options.length === 0) return null;

  return (
    <fieldset className="space-y-2">
      <legend>
        <Microlabel>{label}</Microlabel>
      </legend>
      <div className="divide-y divide-gray-alpha-400 rounded-md border border-gray-alpha-400">
        {options.map((option, index) => {
          const id = `${idPrefix}-${index}`;
          const checked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              htmlFor={id}
              className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2 text-[13px] text-gray-1000"
            >
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(next) =>
                  onChange(
                    next === true
                      ? [...selected, option.value]
                      : selected.filter((value) => value !== option.value),
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};

interface PersonSplitDialogProps {
  /** Owned by the header's actions menu: the trigger is a menu item there. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: Person;
  people: PersonListEntry[];
  links: PersonMeetingLink[];
  documents: DocumentSummary[];
  pending: boolean;
  onSplit: (
    request: Omit<PersonSplitRequest, "source_person_id" | "expected_revision">,
  ) => void;
}

export const PersonSplitDialog: React.FC<PersonSplitDialogProps> = ({
  open,
  onOpenChange,
  person,
  people,
  links,
  documents,
  pending,
  onSplit,
}) => {
  const { t } = useTranslation();
  const idPrefix = useId();
  const nameInputId = `${idPrefix}-name`;
  const [targetValue, setTargetValue] = useState(CREATE_TARGET);
  const [name, setName] = useState("");
  const [meetingIds, setMeetingIds] = useState<string[]>([]);
  const [aliases, setAliases] = useState<string[]>([]);
  const [calendarEmails, setCalendarEmails] = useState<string[]>([]);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const targetOptions = people.filter((entry) => entry.person.id !== person.id);
  const createTarget = targetValue === CREATE_TARGET;
  const selectedCount =
    meetingIds.length +
    aliases.length +
    calendarEmails.length +
    documentIds.length;
  const availableCount =
    links.length +
    person.aliases.length +
    person.calendar_emails.length +
    documents.length;
  const trimmedName = name.trim();
  const submitDisabled =
    pending || (createTarget ? trimmedName.length === 0 : selectedCount === 0);

  const submit = () => {
    const target: PersonSplitRequest["target"] = createTarget
      ? { kind: "create", display_name: trimmedName }
      : { kind: "existing", person_id: targetValue };
    onSplit({
      target,
      meeting_ids: meetingIds,
      aliases,
      calendar_emails: calendarEmails,
      document_ids: documentIds,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("people.detail.splitTitle")}</DialogTitle>
          <DialogDescription>
            {t("people.detail.splitDescription", {
              name: person.display_name,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-[13px] text-gray-1000">
              {t("people.detail.splitTarget")}
            </span>
            <Select value={targetValue} onValueChange={setTargetValue}>
              <SelectTrigger
                size="sm"
                className="w-full"
                aria-label={t("people.detail.splitTarget")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t("people.detail.splitCreate")}</SelectLabel>
                  <SelectItem value={CREATE_TARGET}>
                    {t("people.detail.splitCreate")}
                  </SelectItem>
                </SelectGroup>
                {targetOptions.length === 0 ? null : (
                  <SelectGroup>
                    <SelectLabel>
                      {t("people.detail.splitExisting")}
                    </SelectLabel>
                    {targetOptions.map((entry) => (
                      <SelectItem key={entry.person.id} value={entry.person.id}>
                        {entry.person.display_name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          {createTarget ? (
            <div className="space-y-2">
              <label
                htmlFor={nameInputId}
                className="text-[13px] text-gray-1000"
              >
                {t("people.detail.splitNameLabel")}
              </label>
              <Input
                id={nameInputId}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          ) : null}

          <div className="space-y-3">
            <Microlabel>{t("people.detail.splitEvidence")}</Microlabel>
            {availableCount === 0 ? (
              <p className="text-[13px] text-gray-700">
                {t("people.detail.splitNoItems")}
              </p>
            ) : (
              <>
                <SplitSelectionGroup
                  idPrefix={`${idPrefix}-meetings`}
                  label={t("people.detail.splitMeetings")}
                  options={links.map((link) => ({
                    value: link.meeting.id,
                    label: `${link.meeting.title} · ${formatEntryTimestamp(
                      link.meeting.at_utc_ms,
                    )}`,
                  }))}
                  selected={meetingIds}
                  onChange={setMeetingIds}
                />
                <SplitSelectionGroup
                  idPrefix={`${idPrefix}-aliases`}
                  label={t("people.detail.splitAliases")}
                  options={person.aliases.map((alias) => ({
                    value: alias,
                    label: alias,
                  }))}
                  selected={aliases}
                  onChange={setAliases}
                />
                <SplitSelectionGroup
                  idPrefix={`${idPrefix}-emails`}
                  label={t("people.detail.splitEmails")}
                  options={person.calendar_emails.map((email) => ({
                    value: email,
                    label: email,
                  }))}
                  selected={calendarEmails}
                  onChange={setCalendarEmails}
                />
                <SplitSelectionGroup
                  idPrefix={`${idPrefix}-documents`}
                  label={t("people.detail.splitDocuments")}
                  options={documents.map((document) => ({
                    value: document.id,
                    label: document.title,
                  }))}
                  selected={documentIds}
                  onChange={setDocumentIds}
                />
              </>
            )}
            {!createTarget && selectedCount === 0 ? (
              <p className="text-[12px] text-gray-700">
                {t("people.detail.splitNothingSelected")}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={submitDisabled}
            onClick={submit}
          >
            {pending ? t("common.saving") : t("people.detail.splitSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
