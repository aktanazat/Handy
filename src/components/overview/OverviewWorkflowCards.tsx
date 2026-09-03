import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  events,
  type PersonOpenLoop,
  type WorkflowRunCursor,
  type WorkflowRunReceipt,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/utils/format";
import { Microlabel, SettingsCard } from "@/components/settings/rows";
import {
  formatWorkflowOutcome,
  workflowOutcomeHasEffect,
} from "@/components/settings/workflows/formatWorkflowOutcome";
import { WORKFLOW_NAME_KEY } from "@/components/settings/workflows/workflowCatalogue";

const OVERVIEW_RUN_PAGE_SIZE = 20;
const OVERVIEW_RECEIPT_LIMIT = 3;

/* What the feed will show: a run that succeeded, changed something, and that
 * the reader can act on, which normally means it names a meeting to open.
 * Meeting-recording runs are the exception — skipping a detected meeting
 * leaves no session to open, and "Skipped recording a detected meeting" is
 * exactly the line a reader needs to see. A run that found nothing keeps its
 * row in the full run log under Settings, where a quiet pass is the point. */
const belongsInFeed = (receipt: WorkflowRunReceipt): boolean =>
  receipt.status === "ok" &&
  workflowOutcomeHasEffect(receipt) &&
  (receipt.jump_target?.kind === "meeting" ||
    receipt.workflow_id === "meeting_activity");

const loadRecentFeedReceipts = async (): Promise<WorkflowRunReceipt[]> => {
  const receipts: WorkflowRunReceipt[] = [];
  let cursor: WorkflowRunCursor | null = null;

  do {
    const result = await commands.workflowRuns({
      workflow_id: null,
      cursor,
      limit: OVERVIEW_RUN_PAGE_SIZE,
    });
    if (result.status === "error") throw new Error(result.error);
    for (const receipt of result.data.entries) {
      if (belongsInFeed(receipt)) {
        receipts.push(receipt);
        if (receipts.length === OVERVIEW_RECEIPT_LIMIT) return receipts;
      }
    }
    cursor = result.data.next_cursor;
  } while (cursor !== null);

  return receipts;
};

type OverviewCardState<T> =
  | { status: "loading" }
  | { status: "loaded"; entries: readonly T[] }
  | { status: "error" };

const isLoadedEmpty = <T,>(state: OverviewCardState<T>): boolean =>
  state.status === "loaded" && state.entries.length === 0;

const OverviewCardStateRow: React.FC<{
  status: "loading" | "error";
  onRetry: () => void;
}> = ({ status, onRetry }) => {
  const { t } = useTranslation();

  if (status === "loading") {
    return (
      <div role="status" className="px-4 py-3 text-[13px] text-gray-900">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-[13px] text-gray-800"
    >
      <span>{t("settings.workflows.overview.loadError")}</span>
      <Button type="button" variant="ghost" size="xs" onClick={onRetry}>
        {t("settings.workflows.overview.retry")}
      </Button>
    </div>
  );
};

interface OverviewWorkflowCardsViewProps {
  receipts: OverviewCardState<WorkflowRunReceipt>;
  openLoops: OverviewCardState<PersonOpenLoop>;
  onOpenMeeting: (meetingId: string) => void;
  onRetryReceipts: () => void;
  onRetryOpenLoops: () => void;
  nowMs?: number;
}

export const OverviewWorkflowCardsView: React.FC<
  OverviewWorkflowCardsViewProps
> = ({
  receipts,
  openLoops,
  onOpenMeeting,
  onRetryReceipts,
  onRetryOpenLoops,
  nowMs = Date.now(),
}) => {
  const { t } = useTranslation();
  /* The card lists effects, so a receipt with none does not reach it — the
   * same rule the loader pages by, applied where the row is drawn. */
  const feedReceipts =
    receipts.status === "loaded"
      ? receipts.entries
          .filter(workflowOutcomeHasEffect)
          .slice(0, OVERVIEW_RECEIPT_LIMIT)
      : [];
  const hideReceipts =
    receipts.status === "loaded" && feedReceipts.length === 0;
  const hideOpenLoops = isLoadedEmpty(openLoops);
  if (hideReceipts && hideOpenLoops) return null;

  return (
    /* Two cards share the row; one card takes the whole content measure. The
     * second column is only a column when something is in it — pinning
     * `md:grid-cols-2` unconditionally left a solo "What Sona did" at half the
     * page width beside a dead half. Rows are short lines with a 44px gutter,
     * so the wider measure costs the reader nothing. */
    <div
      className={cn(
        "grid gap-6",
        !hideReceipts && !hideOpenLoops && "md:grid-cols-2",
      )}
    >
      {hideReceipts ? null : (
        <SettingsCard aria-labelledby="overview-workflow-receipts">
          <h2 id="overview-workflow-receipts" className="px-4 pt-4 pb-2">
            <Microlabel>
              {t("settings.workflows.overview.whatSonaDid")}
            </Microlabel>
          </h2>
          {receipts.status === "loaded" ? (
            <ul role="list" className="divide-y divide-gray-alpha-500">
              {feedReceipts.map((receipt) => {
                const meetingId =
                  receipt.jump_target?.kind === "meeting"
                    ? receipt.jump_target.session_id
                    : null;
                const line = (
                  <>
                    <span className="block text-[13px] leading-5 text-gray-1000">
                      {formatWorkflowOutcome(receipt, t)}
                    </span>
                    <span className="mt-1 block text-[11px] text-gray-900">
                      {t(WORKFLOW_NAME_KEY[receipt.workflow_id])}
                      <span aria-hidden="true"> · </span>
                      <span className="snap-measured tabular-nums">
                        {formatRelativeTime(receipt.finished_at_utc_ms, nowMs)}
                      </span>
                    </span>
                  </>
                );

                return (
                  <li key={receipt.id}>
                    {/* A line with nothing to open is a line, not a dead
                     * button: skipping a detected meeting leaves no
                     * session behind. */}
                    {meetingId === null ? (
                      <div
                        data-testid="overview-workflow-receipt"
                        className="px-4 py-3"
                      >
                        {line}
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid="overview-workflow-receipt"
                        data-meeting-id={meetingId}
                        onClick={() => onOpenMeeting(meetingId)}
                        className="hover-fast w-full px-4 py-3 text-start hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
                      >
                        {line}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <OverviewCardStateRow
              status={receipts.status}
              onRetry={onRetryReceipts}
            />
          )}
        </SettingsCard>
      )}

      {hideOpenLoops ? null : (
        <SettingsCard aria-labelledby="overview-open-loops">
          <h2 id="overview-open-loops" className="px-4 pt-4 pb-2">
            <Microlabel>
              {t("settings.workflows.overview.openLoops")}
            </Microlabel>
          </h2>
          {openLoops.status === "loaded" ? (
            <ul role="list" className="divide-y divide-gray-alpha-500">
              {openLoops.entries.map((openLoop) => (
                <li
                  key={`${openLoop.meeting_id}:${openLoop.at_utc_ms}:${openLoop.text}`}
                >
                  <button
                    type="button"
                    data-testid="overview-open-loop"
                    data-meeting-id={openLoop.meeting_id}
                    aria-label={t("settings.workflows.overview.openMeeting", {
                      title: openLoop.title,
                    })}
                    onClick={() => onOpenMeeting(openLoop.meeting_id)}
                    className="hover-fast w-full px-4 py-3 text-start hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
                  >
                    <span className="block text-[13px] leading-5 text-gray-1000">
                      {openLoop.text}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-gray-900">
                      {openLoop.title}
                      <span aria-hidden="true"> · </span>
                      <span className="snap-measured tabular-nums">
                        {formatRelativeTime(openLoop.at_utc_ms, nowMs)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <OverviewCardStateRow
              status={openLoops.status}
              onRetry={onRetryOpenLoops}
            />
          )}
        </SettingsCard>
      )}
    </div>
  );
};

interface OverviewWorkflowCardsProps {
  onOpenMeeting: (meetingId: string) => void;
}

export const OverviewWorkflowCards: React.FC<OverviewWorkflowCardsProps> = ({
  onOpenMeeting,
}) => {
  const [receipts, setReceipts] = useState<
    OverviewCardState<WorkflowRunReceipt>
  >({ status: "loading" });
  const [openLoops, setOpenLoops] = useState<OverviewCardState<PersonOpenLoop>>(
    { status: "loading" },
  );
  const requestGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    setReceipts({ status: "loading" });
    setOpenLoops({ status: "loading" });

    const [receiptResult, inboxResult] = await Promise.allSettled([
      loadRecentFeedReceipts(),
      commands.openLoopsInbox(5),
    ]);
    if (requestGenerationRef.current !== requestGeneration) return;

    setReceipts(
      receiptResult.status === "fulfilled"
        ? { status: "loaded", entries: receiptResult.value }
        : { status: "error" },
    );
    setOpenLoops(
      inboxResult.status === "fulfilled" && inboxResult.value.status === "ok"
        ? { status: "loaded", entries: inboxResult.value.data.entries }
        : { status: "error" },
    );
  }, []);

  useEffect(() => {
    void refresh();
    const subscriptions = Promise.all([
      events.meetingArtifactChanged.listen(() => void refresh()),
      events.meetingRemoved.listen(() => void refresh()),
      events.historyUpdatePayload.listen(() => void refresh()),
    ]);

    return () => {
      requestGenerationRef.current += 1;
      void subscriptions.then((unlisteners) => {
        for (const unlisten of unlisteners) unlisten();
      });
    };
  }, [refresh]);

  return (
    <OverviewWorkflowCardsView
      receipts={receipts}
      openLoops={openLoops}
      onOpenMeeting={onOpenMeeting}
      onRetryReceipts={() => void refresh()}
      onRetryOpenLoops={() => void refresh()}
    />
  );
};
