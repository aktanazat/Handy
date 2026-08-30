import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/vg/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/vg/tabs";
import { Notice, SettingsPage } from "@/components/settings/rows";
import { AgentPanelToggle } from "./AgentPanelToggle";
import { AgentBridgeControls } from "./AgentBridgeControls";
import { AgentBridgeHook } from "./AgentBridgeHook";
import { AgentBridgePendingReplies } from "./AgentBridgePendingReplies";
import { AgentBridgeProjects } from "./AgentBridgeProjects";
import { AgentBridgeReplyComposer } from "./AgentBridgeReplyComposer";
import { AgentBridgeRequests } from "./AgentBridgeRequests";
import { AgentBridgeRules } from "./AgentBridgeRules";
import { AgentBridgeSessions } from "./AgentBridgeSessions";
import type { AgentBridgeSettingsModel } from "./useAgentBridgeSettings";

export const AgentBridgeSettingsPage: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const { refreshObservations, loading, error } = model;
  const [workspace, setWorkspace] = useState<"status" | "queue" | "rules">(
    "status",
  );
  const tabs = [
    { id: "status", label: t("settings.agents.observed.title") },
    { id: "queue", label: t("settings.agents.replyQueue.title") },
    { id: "rules", label: t("settings.agents.rules.title") },
  ] as const;

  return (
    /* One refresh for the whole page: sessions, requests, runtime status and
     * the pending queue all come from the same read, so each workspace no
     * longer carries a button of its own. */
    <SettingsPage
      title={t("settings.agents.title")}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshObservations()}
          disabled={loading}
        >
          <RefreshCw
            aria-hidden="true"
            className={loading ? "animate-spin" : undefined}
          />
          {t("settings.agents.observed.refresh")}
        </Button>
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <AgentPanelToggle />
      <Tabs
        value={workspace}
        onValueChange={(id) => {
          const next = tabs.find((tab) => tab.id === id);
          if (next) setWorkspace(next.id);
        }}
        className="gap-0"
      >
        <div className="border-b border-gray-alpha-400">
          <TabsList
            variant="line"
            aria-label={t(
              "settings.agents.workspaceNavigation",
              "Agent bridge views",
            )}
            className="w-full justify-start gap-6 px-0"
          >
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="flex-none px-0 text-sm font-normal text-gray-900 hover:text-gray-1000 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none data-[state=active]:text-gray-1000 after:bg-gray-1000"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="status" className="flex flex-col gap-10 pt-8">
          <AgentBridgeControls
            bridge={model.bridge}
            status={model.status}
            mutateBridge={model.mutateBridge}
          />
          <AgentBridgeProjects
            bridge={model.bridge}
            authorizing={model.authorizing}
            authorizeProject={model.authorizeProject}
            mutateBridge={model.mutateBridge}
          />
          <AgentBridgeHook
            hookSnippet={model.hookSnippet}
            hookError={model.hookError}
            copyHookSnippet={model.copyHookSnippet}
          />
          {/* Two lists, two sections: the "Observed activity" heading only
           * repeated the tab above it, and its paragraph only described these
           * rows. */}
          <AgentBridgeSessions sessions={model.sessions} />
          <AgentBridgeRequests
            requests={model.requests}
            interactiveReady={model.interactiveReady}
            expiryTimeFormatter={model.expiryTimeFormatter}
            decidePermission={model.decidePermission}
            dismissRequest={model.dismissRequest}
          />
        </TabsContent>
        <TabsContent value="queue" className="flex flex-col gap-10 pt-8">
          <AgentBridgeReplyComposer
            replySessionId={model.replySessionId}
            replyText={model.replyText}
            replySessions={model.replySessions}
            interactiveReady={model.interactiveReady}
            updateView={model.updateView}
            createReplyPreview={model.createReplyPreview}
          />
          <AgentBridgePendingReplies
            pendingMessages={model.pendingMessages}
            confirmPending={model.confirmPending}
            cancelPending={model.cancelPending}
          />
        </TabsContent>
        <TabsContent value="rules" className="pt-8">
          <AgentBridgeRules
            bridge={model.bridge}
            mutateBridge={model.mutateBridge}
          />
        </TabsContent>
      </Tabs>
    </SettingsPage>
  );
};
