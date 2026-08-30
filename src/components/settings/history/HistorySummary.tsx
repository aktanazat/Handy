import React from "react";
import { useTranslation } from "react-i18next";
import type { HistoryStats } from "@/bindings";
import { Microlabel, SETTINGS_CARD } from "../rows";
import { Button } from "@/components/vg/button";
import { Skeleton } from "@/components/vg/skeleton";
import { formatDurationShort } from "@/lib/utils/format";
import { cn } from "@/lib/cn";

const NUMBER_FORMATTER = new Intl.NumberFormat();

interface HistorySummaryProps {
  stats: HistoryStats | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

/* The three base totals every library reports, in card order. The loading
 * state renders these same labels over skeleton figures — the labels are
 * known before the numbers are, and a zero the backend never reported would
 * be a lie. */
const SUMMARY_KEYS = ["entries", "duration", "words"] as const;

/* All-time usage: exactly three flat cards, mono microlabel over a tabular
 * figure. No sublabel under any figure — "5 all time" under "5" states the
 * same number twice — and no per-source split: provenance is a property of a
 * recording, and the row that owns it states it on its receipt.
 *
 * Exported because the band is the page's one derived readout and the whole
 * page cannot be rendered without its data effects. */
export const HistorySummary: React.FC<HistorySummaryProps> = ({
  stats,
  loading,
  error,
  onRetry,
}) => {
  const { t } = useTranslation();

  if (error) {
    return (
      <div className="flex min-h-5 flex-wrap items-center gap-3">
        <p className="text-sm text-red-900">
          {t("settings.history.stats.unavailable")}
        </p>
        {/* Bordered, not a text ghost: this line has no banner surface of its
         * own, so a ghost label would read as the tail of the sentence beside
         * it rather than as the control that refills the band. */}
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("settings.history.retry")}
        </Button>
      </div>
    );
  }

  if (stats === null) {
    if (!loading) {
      return (
        <div className="flex min-h-5 flex-wrap items-center gap-3">
          <p className="text-sm text-gray-900">
            {t("settings.history.stats.unavailable")}
          </p>
        </div>
      );
    }
    return (
      <dl
        className="grid grid-cols-3 gap-3"
        data-testid="history-summary-loading"
      >
        {SUMMARY_KEYS.map((key) => (
          <div
            className={cn(
              SETTINGS_CARD,
              "flex min-w-0 flex-col gap-1.5 px-4 py-3",
            )}
            key={key}
            data-testid="history-stat"
          >
            <dt>
              <Microlabel>{t(`settings.history.stats.${key}`)}</Microlabel>
            </dt>
            <dd className="m-0">
              <Skeleton className="h-8 w-16" />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  const totals = [
    {
      key: "entries",
      label: t("settings.history.stats.entries"),
      value: NUMBER_FORMATTER.format(stats.entries),
    },
    {
      key: "duration",
      label: t("settings.history.stats.duration"),
      value: formatDurationShort(stats.total_duration_ms / 1000),
    },
    {
      key: "words",
      label: t("settings.history.stats.words"),
      value: NUMBER_FORMATTER.format(stats.total_words),
    },
  ];

  return (
    <dl className="grid grid-cols-3 gap-3" data-testid="history-summary">
      {totals.map((total) => (
        <div
          className={cn(
            SETTINGS_CARD,
            "flex min-w-0 flex-col gap-1.5 px-4 py-3",
          )}
          key={total.key}
          data-testid="history-stat"
        >
          <dt>
            <Microlabel>{total.label}</Microlabel>
          </dt>
          <dd className="m-0 text-2xl text-gray-1000 tabular-nums">
            {total.value}
          </dd>
        </div>
      ))}
    </dl>
  );
};
