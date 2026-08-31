import * as React from "react";
import { useTranslation } from "react-i18next";
import type { HistoryTrendPoint, HistoryTrendProjection } from "@/bindings";
import { Microlabel } from "@/components/settings/rows";
import { ChartCard } from "@/components/charts";
import { Bars, Ring, Sparkline } from "@/components/vg/chart";
import { ACTIVITY_DAYS_PER_PAGE, activityPage } from "./activityPaging";

export interface ActivityBandProps {
  trend: HistoryTrendProjection;
}

const parseLocalDate = (value: string): Date => new Date(`${value}T00:00:00`);

const formatRange = (
  points: readonly HistoryTrendPoint[],
  formatter: Intl.DateTimeFormat,
): string => {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return "";
  return `${formatter.format(parseLocalDate(first.local_date))}–${formatter.format(parseLocalDate(last.local_date))}`;
};
export function ActivityBand({ trend }: ActivityBandProps) {
  const { t, i18n } = useTranslation();
  const [pageIndex, setPageIndex] = React.useState(0);
  const selection = React.useMemo(
    () => activityPage(trend.points, pageIndex),
    [pageIndex, trend.points],
  );
  const { page, start, points } = selection;
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const numberFormat = React.useMemo(
    () => new Intl.NumberFormat(locale),
    [locale],
  );
  const dateFormat = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
      }),
    [locale],
  );
  const weekdayFormat = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "long" }),
    [locale],
  );

  const dictations = points.map((point) => point.recordings);
  const words = points.map((point) => point.words);
  let dictationTotal = 0;
  let wordTotal = 0;
  let peakIndex = 0;
  for (let index = 0; index < points.length; index += 1) {
    dictationTotal += points[index].recordings;
    wordTotal += points[index].words;
    if (points[index].recordings > (points[peakIndex]?.recordings ?? -1)) {
      peakIndex = index;
    }
  }

  const peak = points[peakIndex];
  const finalPoint = points[points.length - 1];
  const peakDay = React.useMemo(
    () =>
      peak === undefined
        ? ""
        : weekdayFormat.format(parseLocalDate(peak.local_date)),
    [peak, weekdayFormat],
  );
  const dateRange = React.useMemo(
    () => formatRange(points, dateFormat),
    [dateFormat, points],
  );
  const previousLabel = t("overview.activity.rangePrevious", "Previous 7 days");
  const nextLabel = t("overview.activity.rangeNext", "Next 7 days");

  return (
    <section aria-labelledby="overview-activity-heading" className="space-y-3">
      <h2 id="overview-activity-heading">
        <Microlabel>{t("overview.activity.title", "Activity")}</Microlabel>
      </h2>
      <div className="grid gap-3 md:grid-cols-3">
        <ChartCard
          label={t("overview.activity.dictations", "Dictations")}
          metric={numberFormat.format(dictationTotal)}
          range={{
            label: dateRange,
            previousLabel,
            nextLabel,
            previousDisabled: start === 0,
            nextDisabled: page === 0,
            onPrevious: () => setPageIndex((current) => current + 1),
            onNext: () => setPageIndex((current) => Math.max(0, current - 1)),
          }}
          footerFacts={[
            {
              label: t("overview.activity.peak", "Peak"),
              value: numberFormat.format(peak?.recordings ?? 0),
            },
          ]}
        >
          <Bars
            values={dictations}
            highlightIndex={peak === undefined ? undefined : peakIndex}
            ariaLabel={t(
              "overview.activity.dictationsAria",
              "Dictations per day, highest {{count}} on {{day}}",
              {
                count: peak?.recordings ?? 0,
                day: peakDay,
              },
            )}
          />
        </ChartCard>

        <ChartCard
          label={t("overview.activity.words", "Words")}
          metric={numberFormat.format(wordTotal)}
        >
          <Sparkline
            values={words}
            area
            ariaLabel={t(
              "overview.activity.wordsAria",
              "Words per day, {{count}} total, ending at {{last}}",
              {
                count: wordTotal,
                last: finalPoint?.words ?? 0,
              },
            )}
          />
        </ChartCard>

        <ChartCard
          label={t("overview.activity.streak", "Streak")}
          metric={t("overview.activity.days", "{{count}} days", {
            count: trend.current_streak_days,
          })}
        >
          <div className="flex h-16 items-center justify-center">
            <Ring
              value={trend.current_streak_days}
              max={ACTIVITY_DAYS_PER_PAGE}
              center={numberFormat.format(trend.current_streak_days)}
              ariaLabel={t(
                "overview.activity.streakAria",
                "Current streak, {{count}} days",
                { count: trend.current_streak_days },
              )}
            />
          </div>
        </ChartCard>
      </div>
    </section>
  );
}
