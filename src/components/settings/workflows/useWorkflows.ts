import { useCallback, useEffect, useState } from "react";
import {
  commands,
  events,
  type WorkflowId,
  type WorkflowRunCursor,
  type WorkflowRunReceipt,
  type WorkflowsListResult,
} from "@/bindings";

const RUN_PAGE_SIZE = 50;

export const useWorkflows = () => {
  const [workflows, setWorkflows] = useState<WorkflowsListResult | null>(null);
  const [receipts, setReceipts] = useState<WorkflowRunReceipt[]>([]);
  const [nextCursor, setNextCursor] = useState<WorkflowRunCursor | null>(null);
  const [loadingWorkflows, setLoadingWorkflows] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [workflowError, setWorkflowError] = useState(false);
  const [runError, setRunError] = useState(false);
  const [pendingWorkflowId, setPendingWorkflowId] = useState<WorkflowId | null>(
    null,
  );

  const loadWorkflows = useCallback(async () => {
    setLoadingWorkflows(true);
    setWorkflowError(false);
    try {
      const result = await commands.workflowsList();
      if (result.status === "error") {
        setWorkflowError(true);
        return;
      }
      setWorkflows(result.data);
    } catch {
      setWorkflowError(true);
    } finally {
      setLoadingWorkflows(false);
    }
  }, []);

  const loadFirstRunPage = useCallback(async () => {
    setLoadingRuns(true);
    setRunError(false);
    try {
      const result = await commands.workflowRuns({
        workflow_id: null,
        cursor: null,
        limit: RUN_PAGE_SIZE,
      });
      if (result.status === "error") {
        setRunError(true);
        return;
      }
      setReceipts(result.data.entries);
      setNextCursor(result.data.next_cursor);
    } catch {
      setRunError(true);
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const loadMoreRuns = useCallback(async () => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setRunError(false);
    try {
      const result = await commands.workflowRuns({
        workflow_id: null,
        cursor: nextCursor,
        limit: RUN_PAGE_SIZE,
      });
      if (result.status === "error") {
        setRunError(true);
        return;
      }
      setReceipts((current) => [...current, ...result.data.entries]);
      setNextCursor(result.data.next_cursor);
    } catch {
      setRunError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  const setWorkflowEnabled = useCallback(
    async (workflowId: WorkflowId, enabled: boolean) => {
      if (workflows === null || pendingWorkflowId !== null) return;
      setPendingWorkflowId(workflowId);
      setWorkflowError(false);
      try {
        const result = await commands.workflowSetEnabled({
          workflow_id: workflowId,
          enabled,
          expected_revision: workflows.revision,
        });
        if (result.status === "error") {
          setWorkflowError(true);
          return;
        }
        setWorkflows(result.data);
      } catch {
        setWorkflowError(true);
      } finally {
        setPendingWorkflowId(null);
      }
    },
    [pendingWorkflowId, workflows],
  );

  useEffect(() => {
    void Promise.all([loadWorkflows(), loadFirstRunPage()]);
  }, [loadFirstRunPage, loadWorkflows]);

  useEffect(() => {
    const refresh = () => {
      void Promise.all([loadWorkflows(), loadFirstRunPage()]);
    };
    const subscriptions = Promise.all([
      events.meetingArtifactChanged.listen(refresh),
      events.meetingTranscriptChanged.listen(refresh),
      events.meetingSessionChanged.listen(refresh),
      events.historyUpdatePayload.listen(refresh),
    ]);

    return () => {
      void subscriptions.then((unlisteners) => {
        for (const unlisten of unlisteners) unlisten();
      });
    };
  }, [loadFirstRunPage, loadWorkflows]);

  return {
    workflows,
    receipts,
    hasMoreRuns: nextCursor !== null,
    loadingWorkflows,
    loadingRuns,
    loadingMore,
    workflowError,
    runError,
    pendingWorkflowId,
    loadWorkflows,
    loadFirstRunPage,
    loadMoreRuns,
    setWorkflowEnabled,
  };
};
