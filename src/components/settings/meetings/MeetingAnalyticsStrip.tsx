import React from "react";
import { useTranslation } from "react-i18next";
import {
  Microlabel,
  Notice,
  SettingsSection,
} from "@/components/settings/rows";
import {
  formatPatience,
  formatTalkDuration,
  formatTalkShare,
  type MeetingAnalytics,
} from "./meetingAnalytics";

/* Three numbers about how the conversation went, derived from the diarized
 * transcript and nothing else, plus the per-speaker split and whatever the
 * user's keyword trackers found. Every figure is a fact about the transcript
 * on this screen, so a meeting with no speech shows nothing rather than a row
 * of zeros.
 *
 * There is no "Top talker" tile: the split below is sorted by share, so its
 * first row already prints the leader's percentage and their name. The tile
 * was the same number twice on one screen.
 *
 * Tiles separated by hairlines, not three cards: these numbers are read
 * together and boxing each one would claim they are three separate objects. */

interface MeetingAnalyticsStripProps {
  analytics: MeetingAnalytics;
  speakerNames: Record<string, string>;
  onJumpToSegment: (segmentId: string) => void;
}

interface StatProps {
  label: string;
  value: string;
  /** A second fact, never the first one again: who, or a different count. */
  detail?: string;
}

const Stat: React.FC<StatProps> = ({ label, value, detail }) => (
  <div className="flex flex-col gap-0.5 px-4 py-3">
    <Microlabel>{label}</Microlabel>
    <p className="font-mono text-lg leading-7 tabular-nums text-gray-1000">
      {value}
    </p>
    {detail ? (
      <p className="truncate text-[12px] leading-4 text-gray-800">{detail}</p>
    ) : null}
  </div>
);

export const MeetingAnalyticsStrip: React.FC<MeetingAnalyticsStripProps> = ({
  analytics,
  speakerNames,
  onJumpToSegment,
}) => {
  const { t } = useTranslation();
  const { talk, trackers } = analytics;
  const nameOf = (speakerId: string | null) =>
    speakerId === null
      ? t("meetings.analytics.unknownSpeaker", "Unknown speaker")
      : (speakerNames[speakerId] ??
        t("meetings.analytics.unknownSpeaker", "Unknown speaker"));

  if (talk.segment_count === 0) {
    return (
      <SettingsSection label={t("meetings.analytics.title", "Conversation")}>
        <div className="px-4 py-6">
          <Notice tone="muted" live={false}>
            {t(
              "meetings.analytics.noSpeech",
              "No speech was transcribed, so there is nothing to measure.",
            )}
          </Notice>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection label={t("meetings.analytics.title", "Conversation")}>
      <div className="grid grid-cols-3 divide-x divide-gray-alpha-400">
        <Stat
          label={t("meetings.analytics.longestMonologue", "Longest monologue")}
          value={formatTalkDuration(talk.longest_monologue_ns)}
          detail={nameOf(talk.longest_monologue_speaker_id)}
        />
        <Stat
          label={t("meetings.analytics.patience", "Patience")}
          value={formatPatience(talk.median_switch_gap_ms)}
          /* Not a restatement of "Patience": it is what the number measures,
           * which the word alone does not say. */
          detail={t(
            "meetings.analytics.patienceDetail",
            "Median pause before replying",
          )}
        />
        <Stat
          label={t("meetings.analytics.interactions", "Handovers")}
          value={String(talk.interaction_count)}
          /* A different count, not the same one twice: turns are every stretch
           * of speech, handovers are the ones that changed speaker. */
          detail={t("meetings.analytics.turns", "{{count}} turns", {
            count: talk.turn_count,
          })}
        />
      </div>

      <ul className="divide-y divide-gray-alpha-400">
        {talk.speakers.map((share) => (
          <li
            key={share.speaker_id}
            className="flex items-center justify-between gap-4 px-4 py-2.5"
          >
            <span className="min-w-0 truncate text-[13px] text-gray-1000">
              {nameOf(share.speaker_id)}
            </span>
            <span className="flex flex-none items-baseline gap-3">
              <span className="font-mono text-[13px] leading-5 font-medium tabular-nums text-gray-1000">
                {formatTalkShare(share.share_permille)}
              </span>
              <Microlabel className="normal-case tabular-nums text-gray-800">
                {t("meetings.analytics.speakerDetail", "{{time}} · {{turns}}", {
                  time: formatTalkDuration(share.speaking_ns),
                  turns: t("meetings.analytics.turns", "{{count}} turns", {
                    count: share.turn_count,
                  }),
                })}
              </Microlabel>
            </span>
          </li>
        ))}
      </ul>

      {trackers.length === 0 ? null : (
        <div className="flex flex-col gap-2 py-3">
          <h3 className="px-4">
            <Microlabel>
              {t("meetings.analytics.trackers", "Trackers")}
            </Microlabel>
          </h3>
          <ul className="divide-y divide-gray-alpha-400 border-t border-gray-alpha-400">
            {trackers.map((tracker) => (
              <li
                key={tracker.name}
                className="flex items-center justify-between gap-4 px-4 py-2.5"
              >
                <span className="min-w-0 truncate text-[13px] text-gray-1000">
                  {tracker.name}
                </span>
                {tracker.hit_count === 0 ? (
                  <Microlabel className="normal-case text-gray-800">
                    {t("meetings.analytics.noHits", "Not mentioned")}
                  </Microlabel>
                ) : (
                  <span className="flex flex-none items-baseline gap-3">
                    <Microlabel className="normal-case tabular-nums text-gray-800">
                      {t("meetings.analytics.hits", "{{count}} mentions", {
                        count: tracker.hit_count,
                      })}
                    </Microlabel>
                    <button
                      type="button"
                      onClick={() => onJumpToSegment(tracker.segment_ids[0])}
                      className="rounded-md text-[12px] leading-4 text-blue-900 hover:underline focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
                    >
                      {t("meetings.analytics.jumpToFirst", "Show first")}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsSection>
  );
};
