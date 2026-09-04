import React, { useRef, useState } from "react";
import { User } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingReviewSnapshot, SpeakerId } from "@/bindings";
import { cn } from "@/lib/cn";
import { Notice, SettingsSection } from "@/components/settings/rows";
import { Input } from "@/components/vg/input";
import { committedEdit, inlineEditKeys } from "./inlineEdit";

/* Who was in the room, as a row of names.
 *
 * A speaker is a name, and a name is a word — so the roster reads as words,
 * and the field that changes one appears on the name being changed. The pair
 * of labelled dropdowns that used to sit under it existed to answer "these two
 * are the same person", which is a sentence, so it is written as one on the
 * name you are already correcting. */

type MeetingSpeaker = MeetingReviewSnapshot["speakers"][number];

interface SpeakerRosterProps {
  speakers: MeetingSpeaker[];
  diarization: MeetingReviewSnapshot["diarization"];
  disabled: boolean;
  onRename: (speakerId: SpeakerId, displayName: string) => void;
  onMerge: (sourceSpeakerId: SpeakerId, targetSpeakerId: SpeakerId) => void;
  onCorrect: (speakerId: SpeakerId) => void;
}

export const SpeakerRoster: React.FC<SpeakerRosterProps> = ({
  speakers,
  diarization,
  disabled,
  onRename,
  onMerge,
  onCorrect,
}) => {
  const { t } = useTranslation();
  const [editingSpeakerId, setEditingSpeakerId] = useState<SpeakerId | null>(
    null,
  );
  /* Separation either produced assignments or it did not. A run that succeeded
   * against nothing left the same roster an unrequested one leaves, and saying
   * "Speakers are up to date" over it would be a claim about work that has no
   * result on screen. */
  const separated =
    diarization.status === "succeeded" &&
    diarization.assigned_segment_count > 0;

  return (
    <SettingsSection label={t("meetings.review.speakers")}>
      <div className="flex flex-col gap-2 px-4 py-3">
        {speakers.length === 0 ? (
          <Notice tone="muted" live={false}>
            {t("meetings.review.noSpeakers")}
          </Notice>
        ) : (
          <ul
            role="list"
            aria-label={t("meetings.review.speakers")}
            className="flex flex-wrap items-start gap-1.5"
          >
            {speakers.map((speaker) => (
              <li key={speaker.speaker_id} data-slot="speaker-chip">
                {editingSpeakerId === speaker.speaker_id ? (
                  <SpeakerNameEditor
                    speaker={speaker}
                    others={speakers.filter(
                      (other) => other.speaker_id !== speaker.speaker_id,
                    )}
                    onCommit={(draft) => {
                      setEditingSpeakerId(null);
                      const next = committedEdit(draft, speaker.display_name);
                      if (next !== null) onRename(speaker.speaker_id, next);
                    }}
                    onCancel={() => setEditingSpeakerId(null)}
                    onCorrect={() => {
                      setEditingSpeakerId(null);
                      onCorrect(speaker.speaker_id);
                    }}
                    onMerge={(targetSpeakerId) => {
                      setEditingSpeakerId(null);
                      onMerge(speaker.speaker_id, targetSpeakerId);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    title={t("meetings.review.renameSpeaker")}
                    onClick={() => setEditingSpeakerId(speaker.speaker_id)}
                    className="inline-flex h-6 items-center gap-1.5 rounded-md border border-gray-alpha-400 px-2 text-[13px] text-gray-1000 transition-colors hover:bg-gray-alpha-200 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none disabled:pointer-events-none disabled:text-gray-700"
                  >
                    <User aria-hidden="true" className="size-3 text-gray-700" />
                    {speaker.display_name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {separated ? null : (
          <p className="text-[11px] text-gray-700">
            {t(`meetings.diarization.${diarization.status}`)}
          </p>
        )}
      </div>
    </SettingsSection>
  );
};

export interface SpeakerNameEditorProps {
  speaker: MeetingSpeaker;
  /** Everybody else in the room, each one a person this speaker could be. */
  others: MeetingSpeaker[];
  onCommit: (draft: string) => void;
  onCancel: () => void;
  onMerge: (targetSpeakerId: SpeakerId) => void;
  onCorrect: () => void;
}

/* The chip, open. Naming, matching, and correcting all answer who this voice
 * was, so the actions sit together and leave when it is settled.
 *
 * The actions keep the field focused on the way down: a commit fired by losing
 * focus would close this editor out from under the click that chose one. */
export const SpeakerNameEditor: React.FC<SpeakerNameEditorProps> = ({
  speaker,
  others,
  onCommit,
  onCancel,
  onMerge,
  onCorrect,
}) => {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);

  return (
    <div ref={container} className="flex flex-col gap-1">
      <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-blue-700 ps-2 pe-1">
        <User aria-hidden="true" className="size-3 flex-none text-gray-700" />
        <Input
          autoFocus
          defaultValue={speaker.display_name}
          aria-label={t("meetings.review.speakerName")}
          onBlur={(event) => {
            /* Tabbing onto a merge action is not leaving the editor. */
            if (container.current?.contains(event.relatedTarget) === true) {
              return;
            }
            onCommit(event.target.value);
          }}
          onKeyDown={inlineEditKeys(onCommit, onCancel)}
          className={cn(
            "h-5 w-28 rounded-none border-0 px-0 text-[13px] text-gray-1000 md:text-[13px]",
            "focus-visible:border-0 focus-visible:ring-0",
          )}
        />
      </span>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <button
          type="button"
          data-slot="speaker-correct"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCorrect}
          className="cursor-pointer text-[11px] text-gray-700 underline-offset-2 transition-colors hover:text-gray-1000 hover:underline focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
        >
          {t("meetings.review.correctSpeaker")}
        </button>
        {others.map((other) => (
          <button
            key={other.speaker_id}
            type="button"
            data-slot="speaker-merge"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onMerge(other.speaker_id)}
            className="cursor-pointer text-[11px] text-gray-700 underline-offset-2 transition-colors hover:text-gray-1000 hover:underline focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
          >
            {t("meetings.review.samePersonAs", { name: other.display_name })}
          </button>
        ))}
      </span>
    </div>
  );
};
