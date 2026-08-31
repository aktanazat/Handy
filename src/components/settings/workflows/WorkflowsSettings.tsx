import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsPage } from "@/components/settings/rows";
import { WorkflowList } from "./WorkflowList";
import { WorkflowRunLog } from "./WorkflowRunLog";
import { useWorkflows } from "./useWorkflows";

export const WorkflowsSettings: React.FC = () => {
  const { t } = useTranslation();
  const model = useWorkflows();

  return (
    <SettingsPage title={t("settings.workflows.title")}>
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
    </SettingsPage>
  );
};
