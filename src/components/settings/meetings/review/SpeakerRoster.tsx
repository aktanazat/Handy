import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DiarizationStatus,
  MeetingReviewSnapshot,
  SpeakerId,
} from "@/bindings";
import { Notice, SettingsSection } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";

interface SpeakerRosterProps {
  speakers: MeetingReviewSnapshot["speakers"];
  diarizationStatus: DiarizationStatus;
  disabled: boolean;
  onRename: (speakerId: SpeakerId, displayName: string) => void;
  onMerge: (sourceSpeakerId: SpeakerId, targetSpeakerId: SpeakerId) => void;
}

export const SpeakerRoster: React.FC<SpeakerRosterProps> = ({
  speakers,
  diarizationStatus,
  disabled,
  onRename,
  onMerge,
}) => {
  const { t } = useTranslation();

  return (
    <SettingsSection
      label={t("meetings.review.speakers")}
      action={
        <span className="text-[11px] text-gray-700">
          {t(`meetings.diarization.${diarizationStatus}`)}
        </span>
      }
    >
      {speakers.length === 0 ? (
        <div className="px-4 py-3">
          <Notice tone="muted" live={false}>
            {t("meetings.review.noSpeakers")}
          </Notice>
        </div>
      ) : (
        <>
          <ul
            role="list"
            aria-label={t("meetings.review.speakers")}
            className="divide-y divide-gray-alpha-400"
          >
            {speakers.map((speaker) => (
              <SpeakerRow
                key={`${speaker.speaker_id}:${speaker.revision}:${speaker.display_name}`}
                speakerId={speaker.speaker_id}
                name={speaker.display_name}
                disabled={disabled}
                onRename={onRename}
              />
            ))}
          </ul>
          {speakers.length > 1 ? (
            <MeetingSpeakerMerge
              key={speakers
                .map((speaker) => `${speaker.speaker_id}:${speaker.revision}`)
                .join("|")}
              speakers={speakers}
              disabled={disabled}
              onMerge={onMerge}
            />
          ) : null}
        </>
      )}
    </SettingsSection>
  );
};

interface SpeakerRowProps {
  speakerId: SpeakerId;
  name: string;
  disabled: boolean;
  onRename: (speakerId: SpeakerId, name: string) => void;
}

const SpeakerRow: React.FC<SpeakerRowProps> = ({
  speakerId,
  name,
  disabled,
  onRename,
}) => {
  const { t } = useTranslation();
  const [draftName, setDraftName] = useState(name);
  const trimmedName = draftName.trim();
  const canSave = trimmedName.length > 0 && trimmedName !== name;

  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <Input
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        aria-label={t("meetings.review.speakerName")}
        disabled={disabled}
        className="h-8 min-w-0 flex-1"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onRename(speakerId, trimmedName)}
        disabled={disabled || !canSave}
      >
        {t("common.save")}
      </Button>
    </li>
  );
};

interface MeetingSpeakerMergeProps {
  speakers: MeetingReviewSnapshot["speakers"];
  disabled: boolean;
  onMerge: (sourceSpeakerId: SpeakerId, targetSpeakerId: SpeakerId) => void;
}

const MeetingSpeakerMerge: React.FC<MeetingSpeakerMergeProps> = ({
  speakers,
  disabled,
  onMerge,
}) => {
  const { t } = useTranslation();
  const fieldId = useId();
  const [source, setSource] = useState<SpeakerId>(
    speakers[0]?.speaker_id ?? "",
  );
  const [target, setTarget] = useState<SpeakerId>(
    speakers[1]?.speaker_id ?? "",
  );
  const canMerge =
    !disabled && source.length > 0 && target.length > 0 && source !== target;

  return (
    <div className="flex flex-wrap items-end gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
        <label
          className="text-[13px] text-gray-900"
          htmlFor={`${fieldId}-source`}
        >
          {t("meetings.review.mergeSource")}
        </label>
        <Select value={source} onValueChange={setSource} disabled={disabled}>
          <SelectTrigger id={`${fieldId}-source`} size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {speakers.map((speaker) => (
              <SelectItem key={speaker.speaker_id} value={speaker.speaker_id}>
                {speaker.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
        <label
          className="text-[13px] text-gray-900"
          htmlFor={`${fieldId}-target`}
        >
          {t("meetings.review.mergeTarget")}
        </label>
        <Select value={target} onValueChange={setTarget} disabled={disabled}>
          <SelectTrigger id={`${fieldId}-target`} size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {speakers.map((speaker) => (
              <SelectItem key={speaker.speaker_id} value={speaker.speaker_id}>
                {speaker.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onMerge(source, target)}
        disabled={!canMerge}
      >
        {t("meetings.review.merge")}
      </Button>
    </div>
  );
};
