import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HistoryTrendPoint, HistoryTrendProjection } from "@/bindings";
import { ChartCard } from "@/components/charts";
import { Microlabel } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import {
  ActivityBars,
  ActivitySparkline,
  ActivityWeek,
  type ActivityWeekDay,
} from "./ActivityBandCharts";
import { activityPage } from "./activityPaging";

export interface ActivityBandProps {
  trend: HistoryTrendProjection;
}

const parseLocalDate = (value: string): Date => new Date(`${value}T00:00:00`);

const isToday = (date: Date, today: Date): boolean =>
  date.getFullYear() === today.getFullYear() &&
  date.getMonth() === today.getMonth() &&
  date.getDate() === today.getDate();

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
  const narrowWeekdayFormat = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "narrow" }),
    [locale],
  );
  const weekdayListFormat = React.useMemo(
    () => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }),
    [locale],
  );

  const dictations = points.map((point) => point.recordings);
  const words = points.map((point) => point.words);
  const week: ActivityWeekDay[] = [];
  const activeWeekdayNames: string[] = [];
  const today = new Date();
  let dictationTotal = 0;
  let wordTotal = 0;
  let peakIndex = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const localDate = parseLocalDate(point.local_date);
    const active = dictations[index] > 0;

    /* The trend projection has a streak total but no per-day streak payload.
     * Its Dictations bars already own the daily activity source, so the dot row
     * derives from that same recordings array rather than inventing a second
     * definition of an active day. */
    week.push({
      label: narrowWeekdayFormat.format(localDate),
      active,
      today: isToday(localDate, today),
    });
    if (active) activeWeekdayNames.push(weekdayFormat.format(localDate));

    dictationTotal += point.recordings;
    wordTotal += point.words;
    if (point.recordings > (points[peakIndex]?.recordings ?? -1)) {
      peakIndex = index;
    }
  }

  const peak = points[peakIndex];
  const finalPoint = points[points.length - 1];
  const peakDay =
    peak === undefined
      ? ""
      : weekdayFormat.format(parseLocalDate(peak.local_date));
  const dateRange = formatRange(points, dateFormat);
  const activeWeekdays = weekdayListFormat.format(activeWeekdayNames) || "—";
  const previousLabel = t("overview.activity.rangePrevious", "Previous 7 days");
  const nextLabel = t("overview.activity.rangeNext", "Next 7 days");

  return (
    <section aria-labelledby="overview-activity-heading" className="space-y-3">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="overview-activity-heading">
          <Microlabel>{t("overview.activity.title", "Activity")}</Microlabel>
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={previousLabel}
            disabled={start === 0}
            onClick={() => setPageIndex((current) => current + 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="min-w-[9.5ch] text-center text-[11px] text-gray-800 tabular-nums">
            {dateRange}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={nextLabel}
            disabled={page === 0}
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <ChartCard
          label={t("overview.activity.dictations", "Dictations")}
          metric={numberFormat.format(dictationTotal)}
          footerFacts={[
            {
              label: t("overview.activity.peak", "Peak"),
              value: numberFormat.format(peak?.recordings ?? 0),
            },
          ]}
        >
          <ActivityBars
            values={dictations}
            weekdayLabels={week.map((day) => day.label)}
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
          <ActivitySparkline
            values={words}
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
          <ActivityWeek
            days={week}
            ariaLabel={t(
              "overview.activity.streakAria",
              "Current streak, {{count}} days. Active days this week: {{days}}.",
              {
                count: trend.current_streak_days,
                days: activeWeekdays,
              },
            )}
          />
        </ChartCard>
      </div>
    </section>
  );
}
