import React from "react";
import { useTranslation } from "react-i18next";
import { Section, StatusText } from "../../ui";
import {
  formatPatience,
  formatTalkDuration,
  formatTalkShare,
  type MeetingAnalytics,
} from "./meetingAnalytics";

/* Four numbers about how the conversation went, derived from the diarized
 * transcript and nothing else, plus whatever the user's keyword trackers
 * found. Every figure is a fact about the transcript on this screen, so a
 * meeting with no speech shows nothing rather than a row of zeros.
 *
 * Tiles separated by hairlines, not four cards: these numbers are read
 * together and boxing each one would claim they are four separate objects. */

interface MeetingAnalyticsStripProps {
  analytics: MeetingAnalytics;
  speakerNames: Record<string, string>;
  onJumpToSegment: (segmentId: string) => void;
}

interface StatProps {
  label: string;
  value: string;
  detail?: string;
}

const Stat: React.FC<StatProps> = ({ label, value, detail }) => (
  <div className="meeting-stat">
    <p className="microlabel">{label}</p>
    <p className="meeting-stat-value">{value}</p>
    {detail ? (
      <StatusText tone="muted" className="mt-0.5 block truncate">
        {detail}
      </StatusText>
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
      <Section
        title={t("meetings.analytics.title", "Conversation")}
        description={t(
          "meetings.analytics.description",
          "Measured on this Mac from the diarized transcript. Nothing is sent anywhere.",
        )}
      >
        <StatusText tone="muted">
          {t(
            "meetings.analytics.noSpeech",
            "No speech was transcribed, so there is nothing to measure.",
          )}
        </StatusText>
      </Section>
    );
  }

  const leader = talk.speakers[0];

  return (
    <Section
      title={t("meetings.analytics.title", "Conversation")}
      description={t(
        "meetings.analytics.description",
        "Measured on this Mac from the diarized transcript. Nothing is sent anywhere.",
      )}
    >
      <div className="meeting-stats">
        <Stat
          label={t("meetings.analytics.talkShare", "Top talker")}
          value={leader ? formatTalkShare(leader.share_permille) : "—"}
          detail={leader ? nameOf(leader.speaker_id) : undefined}
        />
        <Stat
          label={t("meetings.analytics.longestMonologue", "Longest monologue")}
          value={formatTalkDuration(talk.longest_monologue_ns)}
          detail={nameOf(talk.longest_monologue_speaker_id)}
        />
        <Stat
          label={t("meetings.analytics.patience", "Patience")}
          value={formatPatience(talk.median_switch_gap_ms)}
          detail={t(
            "meetings.analytics.patienceDetail",
            "Median pause before replying",
          )}
        />
        <Stat
          label={t("meetings.analytics.interactions", "Handovers")}
          value={String(talk.interaction_count)}
          detail={t("meetings.analytics.turns", "{{count}} turns", {
            count: talk.turn_count,
          })}
        />
      </div>

      <ul className="meeting-rows mt-4">
        {talk.speakers.map((share) => (
          <li key={share.speaker_id} className="meeting-row">
            <span className="min-w-0 truncate text-[13px] leading-[19px] text-text-primary">
              {nameOf(share.speaker_id)}
            </span>
            <span className="flex flex-none items-baseline gap-3">
              <span className="font-mono text-[13px] leading-[19px] font-semibold text-text-primary tabular-nums">
                {formatTalkShare(share.share_permille)}
              </span>
              <StatusText tone="muted" className="tabular-nums">
                {t("meetings.analytics.speakerDetail", "{{time}} · {{turns}}", {
                  time: formatTalkDuration(share.speaking_ns),
                  turns: t("meetings.analytics.turns", "{{count}} turns", {
                    count: share.turn_count,
                  }),
                })}
              </StatusText>
            </span>
          </li>
        ))}
      </ul>

      {trackers.length > 0 ? (
        <div className="mt-5">
          <h3 className="microlabel mb-1">
            {t("meetings.analytics.trackers", "Trackers")}
          </h3>
          <ul className="meeting-rows">
            {trackers.map((tracker) => (
              <li key={tracker.name} className="meeting-row">
                <span className="min-w-0 truncate text-[13px] leading-[19px] text-text-primary">
                  {tracker.name}
                </span>
                {tracker.hit_count === 0 ? (
                  <StatusText tone="muted">
                    {t("meetings.analytics.noHits", "Not mentioned")}
                  </StatusText>
                ) : (
                  <span className="flex flex-none items-center gap-3">
                    <StatusText tone="neutral" className="tabular-nums">
                      {t("meetings.analytics.hits", "{{count}} mentions", {
                        count: tracker.hit_count,
                      })}
                    </StatusText>
                    <button
                      type="button"
                      className="meeting-citation"
                      onClick={() => onJumpToSegment(tracker.segment_ids[0])}
                    >
                      {t("meetings.analytics.jumpToFirst", "Show first")}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
};
