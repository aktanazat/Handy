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

/* The round-6 list grammar, in one place because both lists are written in it:
 * a row is a line of text with one meta line under it, and the surface around
 * it draws the only border. */
const ROW_TITLE = "block text-[14px] leading-[21px] font-medium text-gray-1000";
const ROW_META = "mt-1 block text-[13px] leading-[18px] text-gray-900";
const ROW_BOX = "px-6 py-3.5";
const ROW_LINK =
  "hover-fast w-full px-6 py-3.5 text-start hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none";

/* The source and the time, as one meta line with a tabular clock. */
const RowMeta: React.FC<{
  source: React.ReactNode;
  time: string;
  className?: string;
}> = ({ source, time, className }) => (
  <span className={cn(ROW_META, className)}>
    {source}
    <span aria-hidden="true"> · </span>
    <span className="snap-measured tabular-nums">{time}</span>
  </span>
);

/* A named list: the label sits above the surface, the way every section label
 * on every other page does, so the first row inside is a row and not a header. */
const FeedList: React.FC<{
  labelId: string;
  label: string;
  children: React.ReactNode;
}> = ({ labelId, label, children }) => (
  <div className="flex min-w-0 flex-col gap-2">
    <h2 id={labelId}>
      <Microlabel>{label}</Microlabel>
    </h2>
    <SettingsCard aria-labelledby={labelId} className="overflow-hidden">
      {children}
    </SettingsCard>
  </div>
);

const OverviewCardStateRow: React.FC<{
  status: "loading" | "error";
  onRetry: () => void;
}> = ({ status, onRetry }) => {
  const { t } = useTranslation();

  if (status === "loading") {
    return (
      <div
        role="status"
        className={cn(ROW_BOX, "text-[14px] leading-[21px] text-gray-900")}
      >
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        ROW_BOX,
        "flex items-center justify-between gap-3 text-[14px] leading-[21px] text-gray-900",
      )}
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
        <FeedList
          labelId="overview-workflow-receipts"
          label={t("settings.workflows.overview.whatSonaDid")}
        >
          {receipts.status === "loaded" ? (
            <ul role="list" className="divide-y divide-gray-alpha-400">
              {feedReceipts.map((receipt) => {
                const meetingId =
                  receipt.jump_target?.kind === "meeting"
                    ? receipt.jump_target.session_id
                    : null;
                const line = (
                  <>
                    <span className={ROW_TITLE}>
                      {formatWorkflowOutcome(receipt, t)}
                    </span>
                    <RowMeta
                      source={t(WORKFLOW_NAME_KEY[receipt.workflow_id])}
                      time={formatRelativeTime(
                        receipt.finished_at_utc_ms,
                        nowMs,
                      )}
                    />
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
                        className={ROW_BOX}
                      >
                        {line}
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid="overview-workflow-receipt"
                        data-meeting-id={meetingId}
                        onClick={() => onOpenMeeting(meetingId)}
                        className={ROW_LINK}
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
        </FeedList>
      )}

      {hideOpenLoops ? null : (
        <FeedList
          labelId="overview-open-loops"
          label={t("settings.workflows.overview.openLoops")}
        >
          {openLoops.status === "loaded" ? (
            <ul role="list" className="divide-y divide-gray-alpha-400">
              {openLoops.entries.map((openLoop) => {
                const line = (
                  <>
                    <span className={ROW_TITLE}>{openLoop.text}</span>
                    <RowMeta
                      className="truncate"
                      source={openLoop.title}
                      time={formatRelativeTime(openLoop.at_utc_ms, nowMs)}
                    />
                  </>
                );

                return (
                  <li
                    key={`${openLoop.meeting_id}:${openLoop.at_utc_ms}:${openLoop.text}`}
                  >
                    {/* A promise whose meeting is gone still has to be read;
                     * it just has nothing to open. */}
                    {openLoop.meeting_id === "" ? (
                      <div data-testid="overview-open-loop" className={ROW_BOX}>
                        {line}
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid="overview-open-loop"
                        data-meeting-id={openLoop.meeting_id}
                        aria-label={t(
                          "settings.workflows.overview.openMeeting",
                          { title: openLoop.title },
                        )}
                        onClick={() => onOpenMeeting(openLoop.meeting_id)}
                        className={ROW_LINK}
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
              status={openLoops.status}
              onRetry={onRetryOpenLoops}
            />
          )}
        </FeedList>
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
