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
import { formatRelativeTime } from "@/lib/utils/format";
import { Microlabel, SettingsCard } from "@/components/settings/rows";
import { formatWorkflowOutcome } from "@/components/settings/workflows/formatWorkflowOutcome";

const OVERVIEW_RUN_PAGE_SIZE = 20;
const OVERVIEW_RECEIPT_LIMIT = 3;

const loadRecentMeetingReceipts = async (): Promise<WorkflowRunReceipt[]> => {
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
      if (receipt.status === "ok" && receipt.jump_target?.kind === "meeting") {
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
      <div role="status" className="px-4 py-3 text-[13px] text-gray-700">
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
  commitments: OverviewCardState<PersonOpenLoop>;
  onOpenMeeting: (meetingId: string) => void;
  onRetryReceipts: () => void;
  onRetryCommitments: () => void;
  nowMs?: number;
}

export const OverviewWorkflowCardsView: React.FC<
  OverviewWorkflowCardsViewProps
> = ({
  receipts,
  commitments,
  onOpenMeeting,
  onRetryReceipts,
  onRetryCommitments,
  nowMs = Date.now(),
}) => {
  const { t } = useTranslation();
  const hideReceipts = isLoadedEmpty(receipts);
  const hideCommitments = isLoadedEmpty(commitments);
  if (hideReceipts && hideCommitments) return null;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {hideReceipts ? null : (
        <SettingsCard aria-labelledby="overview-workflow-receipts">
          <h2 id="overview-workflow-receipts" className="px-4 pt-4 pb-2">
            <Microlabel>
              {t("settings.workflows.overview.whatSonaDid")}
            </Microlabel>
          </h2>
          {receipts.status === "loaded" ? (
            <ul role="list" className="divide-y divide-gray-alpha-400">
              {receipts.entries
                .slice(0, OVERVIEW_RECEIPT_LIMIT)
                .map((receipt) => {
                  if (receipt.jump_target?.kind !== "meeting") return null;
                  const meetingId = receipt.jump_target.session_id;
                  return (
                    <li key={receipt.id}>
                      <button
                        type="button"
                        data-testid="overview-workflow-receipt"
                        data-meeting-id={meetingId}
                        onClick={() => onOpenMeeting(meetingId)}
                        className="w-full px-4 py-3 text-left transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
                      >
                        <span className="block text-[13px] leading-5 text-gray-1000">
                          {formatWorkflowOutcome(receipt, t)}
                        </span>
                        <span className="mt-1 block font-mono text-[11px] text-gray-700">
                          {t(
                            `settings.workflows.items.${receipt.workflow_id}.name`,
                          )}
                          <span aria-hidden="true"> · </span>
                          <span className="tabular-nums">
                            {formatRelativeTime(
                              receipt.finished_at_utc_ms,
                              nowMs,
                            )}
                          </span>
                        </span>
                      </button>
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

      {hideCommitments ? null : (
        <SettingsCard aria-labelledby="overview-commitments">
          <h2 id="overview-commitments" className="px-4 pt-4 pb-2">
            <Microlabel>
              {t("settings.workflows.overview.commitments")}
            </Microlabel>
          </h2>
          {commitments.status === "loaded" ? (
            <ul role="list" className="divide-y divide-gray-alpha-400">
              {commitments.entries.map((commitment) => (
                <li
                  key={`${commitment.meeting_id}:${commitment.at_utc_ms}:${commitment.text}`}
                >
                  <button
                    type="button"
                    data-testid="overview-commitment"
                    data-meeting-id={commitment.meeting_id}
                    aria-label={t("settings.workflows.overview.openMeeting", {
                      title: commitment.title,
                    })}
                    onClick={() => onOpenMeeting(commitment.meeting_id)}
                    className="w-full px-4 py-3 text-left transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
                  >
                    <span className="block text-[13px] leading-5 text-gray-1000">
                      {commitment.text}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[11px] text-gray-700">
                      {commitment.title}
                      <span aria-hidden="true"> · </span>
                      <span className="tabular-nums">
                        {formatRelativeTime(commitment.at_utc_ms, nowMs)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <OverviewCardStateRow
              status={commitments.status}
              onRetry={onRetryCommitments}
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
  const [commitments, setCommitments] = useState<
    OverviewCardState<PersonOpenLoop>
  >({ status: "loading" });
  const requestGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    setReceipts({ status: "loading" });
    setCommitments({ status: "loading" });

    const [receiptResult, inboxResult] = await Promise.allSettled([
      loadRecentMeetingReceipts(),
      commands.openLoopsInbox(5),
    ]);
    if (requestGenerationRef.current !== requestGeneration) return;

    setReceipts(
      receiptResult.status === "fulfilled"
        ? { status: "loaded", entries: receiptResult.value }
        : { status: "error" },
    );
    setCommitments(
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
      commitments={commitments}
      onOpenMeeting={onOpenMeeting}
      onRetryReceipts={() => void refresh()}
      onRetryCommitments={() => void refresh()}
    />
  );
};
