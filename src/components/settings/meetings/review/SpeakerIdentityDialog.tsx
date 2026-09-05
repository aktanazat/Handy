import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  MeetingReviewSnapshot,
  PersonListEntry,
  VoiceIdentityTarget,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import { Checkbox } from "@/components/vg/checkbox";
import {
  Dialog,
  DialogContent,
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

const CREATE_TARGET = "__create_person__";

type MeetingSpeaker = MeetingReviewSnapshot["speakers"][number];

/**
 * Which question this dialog is asking: a speaker who has no person yet, or a
 * speaker whose person is wrong. One command writes both, so the words on
 * screen are the only thing that tells a person which one they answered.
 */
export type SpeakerIdentityMode = "label" | "correct";

interface SpeakerIdentityDialogProps {
  open: boolean;
  mode: SpeakerIdentityMode;
  speaker: MeetingSpeaker | null;
  people: PersonListEntry[] | null;
  peopleLoading: boolean;
  peopleLoadFailed: boolean;
  pending: boolean;
  unknownConfirming: boolean;
  onOpenChange: (open: boolean) => void;
  onRetryPeople: () => void;
  onSave: (target: VoiceIdentityTarget, remember: boolean) => void;
  onUnknownRequest: () => void;
  onUnknownCancel: () => void;
  onSkip: () => void;
}

interface SpeakerIdentityDialogFormProps {
  mode: SpeakerIdentityMode;
  speakerName: string | null;
  people: PersonListEntry[] | null;
  peopleLoading: boolean;
  peopleLoadFailed: boolean;
  pending: boolean;
  unknownConfirming: boolean;
  onRetryPeople: () => void;
  onSave: (target: VoiceIdentityTarget, remember: boolean) => void;
  onUnknownRequest: () => void;
  onUnknownCancel: () => void;
  onSkip: () => void;
  onNotNow: () => void;
}

export const SpeakerIdentityDialogForm: React.FC<
  SpeakerIdentityDialogFormProps
> = ({
  mode,
  speakerName,
  people,
  peopleLoading,
  peopleLoadFailed,
  pending,
  unknownConfirming,
  onRetryPeople,
  onSave,
  onUnknownRequest,
  onUnknownCancel,
  onSkip,
  onNotNow,
}) => {
  const { t } = useTranslation();
  const idPrefix = useId();
  const nameInputId = idPrefix + "-name";
  const rememberId = idPrefix + "-remember";
  const [targetValue, setTargetValue] = useState(CREATE_TARGET);
  const [name, setName] = useState("");
  const [remember, setRemember] = useState(false);

  /* The speaker's own name in the title, because the dialog reopens on the
   * next unresolved speaker without closing: three speakers to label is the
   * same question three times, and the name is what tells them apart. */
  const speaker = speakerName ?? t("meetings.review.unknownSpeaker");
  const title = t(
    mode === "correct"
      ? "meetings.review.correctSpeakerNamed"
      : "meetings.review.labelSpeakerNamed",
    { speaker },
  );

  const createTarget = targetValue === CREATE_TARGET;
  const trimmedName = name.trim();
  const canSave =
    !pending && people !== null && (!createTarget || trimmedName.length > 0);

  const save = () => {
    if (!canSave) return;
    onSave(
      createTarget
        ? { kind: "create", display_name: trimmedName }
        : { kind: "existing", person_id: targetValue },
      remember,
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>

      {unknownConfirming ? (
        /* Marking a speaker unknown deletes the voice samples saved from that
         * speaker and writes "Unknown" over whatever name the transcript
         * carried, and neither comes back. The snapshot says nothing about
         * which speakers have a saved sample, so the question is asked every
         * time rather than guessed at. */
        <p className="text-[14px] leading-[21px] text-gray-1000" role="alert">
          {t("meetings.review.markUnknownDescription", { speaker })}
        </p>
      ) : peopleLoadFailed ? (
        <div className="flex items-center justify-between gap-3" role="alert">
          <p className="text-[14px] leading-[21px] text-gray-900">
            {t("people.list.loadError")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetryPeople}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : peopleLoading || people === null ? (
        <p className="text-[14px] leading-[21px] text-gray-900">
          {t("common.loading")}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-[14px] text-gray-1000">
              {t("meetings.review.identityPerson")}
            </span>
            <Select value={targetValue} onValueChange={setTargetValue}>
              <SelectTrigger
                size="sm"
                className="w-full"
                aria-label={t("meetings.review.identityPerson")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>
                    {t("meetings.review.identityNewPerson")}
                  </SelectLabel>
                  <SelectItem value={CREATE_TARGET}>
                    {t("meetings.review.identityNewPerson")}
                  </SelectItem>
                </SelectGroup>
                {people.length === 0 ? null : (
                  <SelectGroup>
                    <SelectLabel>
                      {t("meetings.review.identityExistingPerson")}
                    </SelectLabel>
                    {people.map((entry) => (
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
                className="text-[14px] text-gray-1000"
              >
                {t("meetings.review.identityNewPersonName")}
              </label>
              <Input
                id={nameInputId}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          ) : null}

          <label
            htmlFor={rememberId}
            className="flex cursor-pointer items-center gap-3 text-[14px] text-gray-1000"
          >
            <Checkbox
              id={rememberId}
              checked={remember}
              onCheckedChange={(next) => setRemember(next === true)}
            />
            {t("meetings.review.rememberVoice")}
          </label>
        </div>
      )}

      <DialogFooter>
        {unknownConfirming ? (
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={onUnknownCancel}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={onSkip}
            >
              {t("meetings.review.markUnknown")}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={onNotNow}
            >
              {t("meetings.review.notNow")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || people === null}
              onClick={onUnknownRequest}
            >
              {t("meetings.review.markUnknown")}
            </Button>
            <Button type="button" disabled={!canSave} onClick={save}>
              {pending ? t("common.loading") : t("common.save")}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
};

export const SpeakerIdentityDialog: React.FC<SpeakerIdentityDialogProps> = ({
  open,
  mode,
  speaker,
  people,
  peopleLoading,
  peopleLoadFailed,
  pending,
  unknownConfirming,
  onOpenChange,
  onRetryPeople,
  onSave,
  onUnknownRequest,
  onUnknownCancel,
  onSkip,
}) => (
  <Dialog
    open={open}
    onOpenChange={(nextOpen) => {
      if (!pending) onOpenChange(nextOpen);
    }}
  >
    <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
      <SpeakerIdentityDialogForm
        key={open + ":" + mode + ":" + (speaker?.speaker_id ?? "none")}
        mode={mode}
        speakerName={speaker?.display_name ?? null}
        people={people}
        peopleLoading={peopleLoading}
        peopleLoadFailed={peopleLoadFailed}
        pending={pending}
        unknownConfirming={unknownConfirming}
        onRetryPeople={onRetryPeople}
        onSave={onSave}
        onUnknownRequest={onUnknownRequest}
        onUnknownCancel={onUnknownCancel}
        onSkip={onSkip}
        onNotNow={() => onOpenChange(false)}
      />
    </DialogContent>
  </Dialog>
);
