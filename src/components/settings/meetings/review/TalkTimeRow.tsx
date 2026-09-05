import React from "react";
import { useTranslation } from "react-i18next";
import type { MeetingReviewSnapshot } from "@/bindings";
import { formatTalkShare, type MeetingAnalytics } from "../meetingAnalytics";
import { talkTimeSlices } from "./talkTime";

/* D25: one quiet line saying who held the meeting.
 *
 * Deliberately not a chart and deliberately not a score: the names in the
 * order they held the floor, each with its share — enough to notice you did
 * all the talking, and not enough to turn a conversation into a performance
 * review. The Insights strip already carries the exact seconds and turn counts
 * for anyone who wants them; this is the glance.
 *
 * It used to draw the shares as a hairline split by speaker, with the names
 * spelled out underneath and the percentages left to a screen reader. On the
 * page that bar landed directly under the facts line and read as an underline
 * of it, one rule above the tab strip's rule — and the reader who could see it
 * still could not tell 45% from 37%. The sentence assistive tech was already
 * getting is the better row, so it is the row everybody gets.
 *
 * Nothing at all when the meeting was never diarized: one name with all of the
 * airtime would claim a measurement Sona did not make. */

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

  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px] leading-[18px] text-gray-1000">
      <span className="text-gray-900">{t("meetings.talkTime.label")}</span>
      {slices.map((slice) => (
        <span key={slice.speakerId} className="min-w-0 truncate tabular-nums">
          {t("meetings.talkTime.speakerShare", {
            name: slice.name,
            share: formatTalkShare(slice.permille),
          })}
        </span>
      ))}
    </p>
  );
};
