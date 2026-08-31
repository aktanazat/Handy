import React from "react";
import { WorkflowList } from "../workflows/WorkflowList";
import { WorkflowRunLog } from "../workflows/WorkflowRunLog";
import { useWorkflows } from "../workflows/useWorkflows";

/* The five things Sona does on its own after a meeting, and what they did.
 *
 * This was a tab; it is two sections now, and it reads the same model it
 * always did. The switches say what they do in plain language — the names live
 * in the catalogue, not here — because "Person linking" named a subsystem and
 * "Remember people" names the outcome. */
export const AdvancedWorkflows: React.FC = () => {
  const model = useWorkflows();

  return (
    <>
      <WorkflowList
        data={model.workflows}
        loading={model.loadingWorkflows}
        error={model.workflowError}
        pendingWorkflowId={model.pendingWorkflowId}
        onRetry={() => void model.loadWorkflows()}
        onToggle={(workflowId, enabled) =>
          void model.setWorkflowEnabled(workflowId, enabled)
        }
      />
      <WorkflowRunLog
        receipts={model.receipts}
        loading={model.loadingRuns}
        loadingMore={model.loadingMore}
        error={model.runError}
        hasMore={model.hasMoreRuns}
        onRetry={() =>
          void (model.receipts.length === 0
            ? model.loadFirstRunPage()
            : model.loadMoreRuns())
        }
        onLoadMore={() => void model.loadMoreRuns()}
      />
    </>
  );
};
