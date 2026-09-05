import React from "react";
import { Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkflowRunReceipt } from "@/bindings";
import { formatRelativeTime } from "@/lib/utils/format";
import { Button } from "@/components/vg/button";
import { Bars } from "@/components/vg/chart";
import { Skeleton } from "@/components/vg/skeleton";
import { Notice, SettingsSection } from "@/components/settings/rows";
import { WorkflowStatusGlyph } from "./WorkflowStatusGlyph";
import { runsForLastSevenDays } from "./workflowRuns";
import { formatWorkflowOutcome } from "./formatWorkflowOutcome";
import { WORKFLOW_NAME_KEY } from "./workflowCatalogue";

interface WorkflowRunLogProps {
  receipts: readonly WorkflowRunReceipt[];
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  hasMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  nowMs?: number;
}

export const WorkflowRunLog: React.FC<WorkflowRunLogProps> = ({
  receipts,
  loading,
  loadingMore,
  error,
  hasMore,
  onRetry,
  onLoadMore,
  nowMs = Date.now(),
}) => {
  const { t } = useTranslation();
  const dailyRuns = runsForLastSevenDays(receipts, nowMs);
  const runsThisWeek = dailyRuns.reduce((total, count) => total + count, 0);

  return (
    <SettingsSection
      label={t("settings.workflows.runLog.title")}
      action={
        receipts.length === 0 ? undefined : (
          <Bars
            values={dailyRuns}
            highlightIndex={dailyRuns.length - 1}
            ariaLabel={t("settings.workflows.runLog.chartAria", {
              count: runsThisWeek,
            })}
            className="h-7 w-24"
          />
        )
      }
    >
      {loading && receipts.length === 0 ? (
        <div
          role="status"
          aria-label={t("common.loading")}
          className="space-y-2 px-6 py-3"
        >
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : error && receipts.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
          <Notice tone="danger">
            {t("settings.workflows.runLog.loadError")}
          </Notice>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      ) : receipts.length === 0 ? (
        <div role="status" className="flex items-center gap-3 px-6 py-3">
          <Minus aria-hidden="true" className="size-4 text-gray-700" />
          <span className="text-[14px] text-gray-700">
            {t("settings.workflows.runLog.empty")}
          </span>
        </div>
      ) : (
        <ol className="divide-y divide-gray-alpha-400">
          {receipts.map((receipt) => (
            <li
              key={receipt.id}
              data-workflow-run-id={receipt.id}
              className="flex min-w-0 items-start gap-3 px-6 py-3"
            >
              <WorkflowStatusGlyph status={receipt.status} className="mt-0.5" />
              <div className="min-w-0 space-y-1">
                <p className="text-[14px] leading-[21px] text-gray-1000">
                  {formatWorkflowOutcome(receipt, t)}
                </p>
                <p className="text-[12px] text-gray-700">
                  {t(WORKFLOW_NAME_KEY[receipt.workflow_id])}
                  <span aria-hidden="true"> · </span>
                  <span className="tabular-nums">
                    {formatRelativeTime(receipt.finished_at_utc_ms, nowMs)}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {receipts.length > 0 && (hasMore || error) ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
          {error ? (
            <Notice tone="danger">
              {t("settings.workflows.runLog.loadMoreError")}
            </Notice>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loadingMore}
            className="ml-auto"
            onClick={error ? onRetry : onLoadMore}
          >
            {loadingMore
              ? t("common.loading")
              : error
                ? t("common.retry")
                : t("settings.workflows.runLog.loadMore")}
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  );
};
