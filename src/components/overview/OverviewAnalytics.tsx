import React from "react";
import { useTranslation } from "react-i18next";
import type {
  HistorySourceKind,
  HistoryStats,
  HistoryTrendProjection,
  MeetingTrendProjection,
} from "@/bindings";
import {
  Button,
  EmptyState,
  Section,
  Skeleton,
  StatusText,
} from "@/components/ui";
import { formatDurationShort } from "@/lib/utils/format";
import { ActivityChart } from "./ActivityChart";
import {
  buildActivityDays,
  buildSourceShares,
  formatCount,
  formatDayLabel,
  peakDictations,
  summarizeMeetings,
  totalDictations,
} from "./analytics";

/* The analytics band: stat tiles, the activity chart, and one line saying
 * where the recordings came from.
 *
 * Two payloads feed it and they are not interchangeable. The trend projection
 * owns everything scoped to the range (totals, streak, per-day points, source
 * split); the stats aggregate owns all-time figures. When the trend request
 * fails the tiles fall back to all-time numbers *and relabel themselves*,
 * because showing all-time totals under a "last 30 days" heading would be a
 * lie. */

interface StatTile {
  key: string;
  label: string;
  value: string;
  meta: string | null;
}

export interface OverviewAnalyticsProps {
  loading: boolean;
  trend: HistoryTrendProjection | null;
  stats: HistoryStats | null;
  meetingTrend: MeetingTrendProjection | null;
  onRetry: () => void;
}

export const OverviewAnalytics: React.FC<OverviewAnalyticsProps> = ({
  loading,
  trend,
  stats,
  meetingTrend,
  onRetry,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const title = t("overview.stats.title", "Activity");

  if (loading) {
    return (
      <Section title={title}>
        <div role="status" aria-label={t("common.loading")}>
          <div className="ov-stat-grid">
            <Skeleton className="h-[74px] w-full" />
            <Skeleton className="h-[74px] w-full" />
            <Skeleton className="h-[74px] w-full" />
            <Skeleton className="h-[74px] w-full" />
          </div>
          <Skeleton className="ov-chart-skeleton w-full" />
        </div>
      </Section>
    );
  }

  /* Both reads failed, so the band has no content at all: an empty region
   * that names why it is empty and carries the one action that fixes it,
   * rather than a tinted bar sitting above an equally empty band. */
  if (trend === null && stats === null) {
    return (
      <Section title={title}>
        <EmptyState
          variant="error"
          title={t(
            "overview.stats.error",
            "Sona could not read your usage history.",
          )}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRetry}
            >
              {t("common.retry")}
            </Button>
          }
        />
      </Section>
    );
  }

  const sourceLabel = (kind: HistorySourceKind | null): string => {
    if (kind === "microphone") return t("overview.sources.microphone");
    if (kind === "file") return t("overview.sources.file");
    return t("overview.sources.legacy");
  };

  const meetings = summarizeMeetings(meetingTrend);
  const days = buildActivityDays(trend, meetingTrend);
  const shares = buildSourceShares(trend === null ? null : trend.range_total);
  const rangeDictations = totalDictations(days);
  const peak = peakDictations(days);

  const allTimeMeta = (value: string): string | null =>
    stats === null
      ? null
      : t("overview.stats.allTime", "{{total}} all time", { total: value });

  const tiles: StatTile[] =
    trend === null
      ? [
          {
            key: "dictations",
            label: t(
              "overview.stats.dictationsAllTime",
              "Dictations, all time",
            ),
            value: formatCount(stats === null ? 0 : stats.entries, locale),
            meta: null,
          },
          {
            key: "words",
            label: t("overview.stats.wordsAllTime", "Words, all time"),
            value: formatCount(stats === null ? 0 : stats.total_words, locale),
            meta: null,
          },
          {
            key: "duration",
            label: t(
              "overview.stats.speakingAllTime",
              "Speaking time, all time",
            ),
            value: formatDurationShort(
              (stats === null ? 0 : stats.total_duration_ms) / 1000,
            ),
            meta: null,
          },
        ]
      : [
          {
            key: "dictations",
            label: t("overview.stats.dictations", "Dictations"),
            value: formatCount(trend.range_total.recordings, locale),
            meta: allTimeMeta(
              formatCount(stats === null ? 0 : stats.entries, locale),
            ),
          },
          {
            key: "words",
            label: t("overview.stats.words", "Words"),
            value: formatCount(trend.range_total.words, locale),
            meta: allTimeMeta(
              formatCount(stats === null ? 0 : stats.total_words, locale),
            ),
          },
          {
            key: "duration",
            label: t("overview.stats.speaking", "Speaking time"),
            value: formatDurationShort(trend.range_total.duration_ms / 1000),
            meta: allTimeMeta(
              formatDurationShort(
                (stats === null ? 0 : stats.total_duration_ms) / 1000,
              ),
            ),
          },
          {
            key: "streak",
            label: t("overview.stats.streak", "Current streak"),
            /* Narrow, so the unit sits inside the value the way every other
             * tile's does: "3d", not "3 days". */
            value: new Intl.NumberFormat(locale, {
              style: "unit",
              unit: "day",
              unitDisplay: "narrow",
              maximumFractionDigits: 0,
            }).format(trend.current_streak_days),
            meta: t(
              "overview.stats.activeDays",
              "{{active}} of {{total}} days active",
              { active: trend.active_days, total: trend.points.length },
            ),
          },
        ];

  const description =
    trend === null
      ? t(
          "overview.stats.rangeUnavailable",
          "The last 30 days could not be read, so these are all-time totals.",
        )
      : t("overview.stats.range", "{{from}} to {{to}}", {
          from: formatDayLabel(trend.range_start_local_date, locale),
          to: formatDayLabel(trend.range_end_local_date, locale),
        });

  const sourceLine =
    shares.length === 0 && meetings.rangeMeetings === 0
      ? t("overview.sources.empty")
      : [
          ...shares.map(
            (share) =>
              `${sourceLabel(share.kind)} ${formatCount(share.recordings, locale)}`,
          ),
          ...(meetings.available && meetings.rangeMeetings > 0
            ? [
                `${t("overview.sources.meetings", "Meetings")} ${formatCount(
                  meetings.rangeMeetings,
                  locale,
                )}`,
              ]
            : []),
        ].join(" \u00b7 ");

  return (
    <Section title={title} description={description}>
      {/* One raised card per counter, its label on top as the card's header
       * and the measured value under it. The shared grid keeps the values
       * aligned, so the band still reads as one comparison. */}
      <ul
        className="ov-stat-grid"
        aria-label={t("overview.stats.tiles", "Usage summary")}
      >
        {tiles.map((tile) => (
          <li key={tile.key} className="ov-stat">
            <span className="ov-stat-label">{tile.label}</span>
            <span className="ov-stat-value type-metric snap-measured">
              {tile.value}
            </span>
            {tile.meta !== null && (
              <span className="ov-stat-meta type-data snap-measured">
                {tile.meta}
              </span>
            )}
          </li>
        ))}
      </ul>

      {trend !== null && days.length > 0 && (
        <div className="ov-chart-block">
          <div className="ov-chart-head">
            <span className="ov-chart-legend type-secondary">
              {t("overview.chart.legend", "Dictations per day")}
            </span>
            <span className="ov-chart-peak type-data snap-measured">
              {t("overview.chart.peak", "Busiest day {{peak}}", { peak })}
            </span>
          </div>
          <ActivityChart
            days={days}
            summary={t(
              "overview.chart.summary",
              "Dictations per day from {{from}} to {{to}}. Total {{total}}, busiest day {{peak}}.",
              {
                from: formatDayLabel(trend.range_start_local_date, locale),
                to: formatDayLabel(trend.range_end_local_date, locale),
                total: rangeDictations,
                peak,
              },
            )}
            dayTitle={(day) =>
              meetings.available
                ? t(
                    "overview.chart.dayWithMeetings",
                    "{{date}} \u00b7 dictations {{dictations}} \u00b7 meetings {{meetings}}",
                    {
                      date: formatDayLabel(day.localDate, locale),
                      dictations: day.dictations,
                      meetings: day.meetings,
                    },
                  )
                : t(
                    "overview.chart.day",
                    "{{date}} \u00b7 dictations {{dictations}}",
                    {
                      date: formatDayLabel(day.localDate, locale),
                      dictations: day.dictations,
                    },
                  )
            }
          />
          <div className="ov-chart-axis type-data">
            <span>{formatDayLabel(trend.range_start_local_date, locale)}</span>
            <span>{formatDayLabel(trend.range_end_local_date, locale)}</span>
          </div>
        </div>
      )}

      <div className="ov-source-block">
        <p className="ov-source-line type-data snap-measured">{sourceLine}</p>
        {!meetings.available && (
          <StatusText tone="muted">
            {t(
              "overview.sources.meetingsUnavailable",
              "Meeting storage is unavailable, so meetings are not counted here.",
            )}
          </StatusText>
        )}
      </div>
    </Section>
  );
};
