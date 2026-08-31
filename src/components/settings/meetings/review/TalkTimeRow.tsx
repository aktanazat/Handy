import React from "react";
import { useTranslation } from "react-i18next";
import type { MeetingReviewSnapshot } from "@/bindings";
import { formatTalkShare, type MeetingAnalytics } from "../meetingAnalytics";
import { talkTimeSlices } from "./talkTime";

/* D25: one quiet line saying who held the meeting.
 *
 * Deliberately not a chart and deliberately not a score. A hairline split by
 * speaker, and the names in the order they held the floor — enough to notice
 * you did all the talking, and not enough to turn a conversation into a
 * performance review. The Insights strip already carries the exact seconds and
 * turn counts for anyone who wants them; this is the glance.
 *
 * Nothing at all when the meeting was never diarized. A single undivided bar
 * labelled with one name would claim a measurement Sona did not make. */

/** The gray ladder, widest share first. Colour is not the channel here — the
 * order of the names is — so the steps only need to be distinguishable. */
const SLICE_TONES = [
  "bg-gray-1000",
  "bg-gray-800",
  "bg-gray-600",
  "bg-gray-400",
] as const;

interface TalkTimeRowProps {
  diarization: MeetingReviewSnapshot["diarization"];
  /** Conversation metrics, or null until the first read lands. */
  analytics: MeetingAnalytics | null;
  speakerNames: Record<string, string>;
}

export const TalkTimeRow: React.FC<TalkTimeRowProps> = ({
  diarization,
  analytics,
  speakerNames,
}) => {
  const { t } = useTranslation();
  if (
    analytics === null ||
    diarization.status !== "succeeded" ||
    diarization.assigned_segment_count === 0
  ) {
    return null;
  }

  const slices = talkTimeSlices(
    analytics.talk.speakers,
    (speakerId) =>
      speakerNames[speakerId] ?? t("meetings.analytics.unknownSpeaker"),
  );
  if (slices.length === 0) return null;

  /* The sentence a screen reader gets is the whole row: the bar is decoration
   * over it, which is why the list below carries no percentages of its own. */
  const spoken = slices
    .map((slice) =>
      t("meetings.talkTime.speakerShare", {
        name: slice.name,
        share: formatTalkShare(slice.permille),
      }),
    )
    .join(", ");

  return (
    <div className="flex flex-col gap-1.5">
      <p className="sr-only">
        {t("meetings.talkTime.sentence", { speakers: spoken })}
      </p>
      <div
        aria-hidden="true"
        className="flex h-px w-full overflow-hidden rounded-full bg-gray-alpha-400"
      >
        {slices.map((slice, index) => (
          <span
            key={slice.speakerId}
            style={{ width: `${slice.percent}%` }}
            className={SLICE_TONES[Math.min(index, SLICE_TONES.length - 1)]}
          />
        ))}
      </div>
      <p
        aria-hidden="true"
        className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-gray-800"
      >
        <span className="text-gray-700">{t("meetings.talkTime.label")}</span>
        {slices.map((slice) => (
          <span key={slice.speakerId} className="min-w-0 truncate">
            {slice.name}
          </span>
        ))}
      </p>
    </div>
  );
};
