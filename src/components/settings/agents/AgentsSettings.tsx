import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Copy, FolderPlus, RefreshCw, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  commands,
  events,
  type AgentBridgeAgent,
  type AgentBridgeObservedRequest,
  type AgentBridgeObservedSession,
  type AgentBridgePendingMessage,
  type AgentBridgePermissionDecision,
  type AgentBridgeSettings,
  type AgentBridgeStatus,
  type Result,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/vg/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vg/select";
import { Switch } from "@/components/vg/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/vg/tabs";
import { Textarea } from "@/components/vg/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/vg/tooltip";
import {
  Microlabel,
  Notice,
  SettingsCard,
  SettingsField,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/rows";
import { AgentPanelToggle } from "./AgentPanelToggle";

const EMPTY_BRIDGE_SETTINGS: AgentBridgeSettings = {
  master_enabled: false,
  claude_enabled: false,
  codex_enabled: false,
  grok_enabled: false,
  omp_enabled: false,
  allowed_projects: [],
  permission_rules: [],
};

const AGENTS = [
  "claude",
  "codex",
  "grok",
  "omp",
] as const satisfies readonly AgentBridgeAgent[];

type BridgeMutation = Result<AgentBridgeSettings, string>;

const subscribeToAgentBridgeUpdates = (
  onUpdate: (status: AgentBridgeStatus) => void,
  onError: (message: string) => void,
) => {
  let disposed = false;
  let unlisten: (() => void) | undefined;

  void events.agentBridgeUpdateEvent
    .listen((event) => {
      if (!disposed) onUpdate(event.payload.status);
    })
    .then(
      (nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      },
      (error) =>
        onError(error instanceof Error ? error.message : String(error)),
    );

  return () => {
    disposed = true;
    unlisten?.();
  };
};

interface AgentBridgeViewState {
  bridge: AgentBridgeSettings;
  status: AgentBridgeStatus | null;
  sessions: AgentBridgeObservedSession[];
  requests: AgentBridgeObservedRequest[];
  pendingMessages: AgentBridgePendingMessage[];
  hookSnippet: string | null;
  hookError: string | null;
  error: string | null;
  loading: boolean;
  authorizing: boolean;
  replySessionId: string;
  replyText: string;
}

const agentBridgeViewReducer = (
  state: AgentBridgeViewState,
  patch: Partial<AgentBridgeViewState>,
): AgentBridgeViewState => ({ ...state, ...patch });

const useAgentBridgeSettings = () => {
  const { t, i18n } = useTranslation();
  const expiryTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }),
    [i18n.language],
  );

  const { refreshSettings, settings } = useSettings();
  const [view, updateView] = useReducer(agentBridgeViewReducer, {
    bridge: settings?.agent_bridge ?? EMPTY_BRIDGE_SETTINGS,
    status: null,
    sessions: [],
    requests: [],
    pendingMessages: [],
    hookSnippet: null,
    hookError: null,
    error: null,
    loading: true,
    authorizing: false,
    replySessionId: "",
    replyText: "",
  });
  const {
    bridge,
    status,
    sessions,
    requests,
    pendingMessages,
    hookSnippet,
    hookError,
    error,
    loading,
    authorizing,
    replySessionId,
    replyText,
  } = view;
  const mountedRef = useRef(true);
  const refreshObservationsRef = useRef<() => Promise<void>>(
    async () => undefined,
  );

  const refreshObservations = useCallback(async () => {
    updateView({ loading: true });
    try {
      const [nextStatus, nextSessions, nextRequests, nextPendingMessages] =
        await Promise.all([
          commands.getAgentBridgeStatus(),
          commands.getAgentBridgeSessions(),
          commands.getAgentBridgeRequests(),
          commands.getAgentBridgePendingMessages(),
        ]);
      if (!mountedRef.current) return;
      updateView({
        status: nextStatus,
        sessions: nextSessions,
        requests: nextRequests,
        pendingMessages: nextPendingMessages,
        error: null,
      });
    } catch (refreshError) {
      if (mountedRef.current) {
        updateView({
          error: t("settings.agents.errors.load", {
            error: String(refreshError),
          }),
        });
      }
    } finally {
      if (mountedRef.current) updateView({ loading: false });
    }
  }, [t]);

  useEffect(() => {
    refreshObservationsRef.current = refreshObservations;
  }, [refreshObservations]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshObservations();
    return () => {
      mountedRef.current = false;
    };
  }, [refreshObservations]);

  useEffect(() => {
    const unsubscribe = subscribeToAgentBridgeUpdates(
      (nextStatus) => {
        updateView({ status: nextStatus });
        void refreshObservationsRef.current();
      },
      (subscriptionError) => {
        console.error("Agent bridge subscription failed:", subscriptionError);
      },
    );

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void commands
      .getAgentBridgeHookSnippet()
      .then((result) => {
        if (disposed) return;
        if (result.status === "ok") {
          updateView({ hookSnippet: result.data, hookError: null });
        } else {
          updateView({ hookError: String(result.error) });
        }
      })
      .catch((snippetError) => {
        if (!disposed) updateView({ hookError: String(snippetError) });
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (settings?.agent_bridge) updateView({ bridge: settings.agent_bridge });
  }, [settings?.agent_bridge]);

  const replySessions = useMemo(
    () =>
      sessions.filter(
        (session) => session.agent === "claude" || session.agent === "omp",
      ),
    [sessions],
  );

  useEffect(() => {
    if (!replySessions.some((session) => session.id === replySessionId)) {
      updateView({ replySessionId: replySessions[0]?.id ?? "" });
    }
  }, [replySessions, replySessionId]);

  const mutateBridge = useCallback(
    async (operation: () => Promise<BridgeMutation>) => {
      updateView({ error: null });
      try {
        const result = await operation();
        if (result.status !== "ok") {
          updateView({
            error: t("settings.agents.errors.operation", {
              error: String(result.error),
            }),
          });
          return;
        }
        updateView({ bridge: result.data });
        void refreshSettings();
        await refreshObservations();
      } catch (mutationError) {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(mutationError),
          }),
        });
      }
    },
    [refreshObservations, refreshSettings, t],
  );

  const authorizeProject = async () => {
    updateView({ authorizing: true });
    try {
      const selectedPath = await open({ directory: true, multiple: false });
      if (selectedPath !== null && !Array.isArray(selectedPath)) {
        await mutateBridge(() =>
          commands.authorizeAgentBridgeProject(selectedPath),
        );
      }
    } catch (authorizationError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(authorizationError),
        }),
      });
    } finally {
      updateView({ authorizing: false });
    }
  };

  const createReplyPreview = async () => {
    if (!replySessionId || replyText.trim() === "") return;
    updateView({ error: null });
    try {
      const result = await commands.createAgentBridgeReplyPreview(
        replySessionId,
        replyText,
      );
      if (result.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(result.error),
          }),
        });
        return;
      }
      updateView({ replyText: "" });
      await refreshObservations();
    } catch (previewError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(previewError),
        }),
      });
    }
  };

  const confirmPending = async (pending: AgentBridgePendingMessage) => {
    updateView({ error: null });
    try {
      const result = await commands.confirmAgentBridgeReply(
        pending.id,
        pending.session_id,
        pending.text,
      );
      if (result.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(result.error),
          }),
        });
        return;
      }
      await refreshObservations();
    } catch (confirmError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(confirmError),
        }),
      });
    }
  };

  const cancelPending = async (pendingId: string) => {
    updateView({ error: null });
    try {
      const result = await commands.cancelAgentBridgeMessage(pendingId);
      if (result.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(result.error),
          }),
        });
        return;
      }
      await refreshObservations();
    } catch (cancelError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(cancelError),
        }),
      });
    }
  };

  const dismissRequest = async (requestId: string) => {
    updateView({ error: null });
    try {
      const result = await commands.dismissAgentBridgeRequest(requestId);
      if (result.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(result.error),
          }),
        });
        return;
      }
      await refreshObservations();
    } catch (dismissError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(dismissError),
        }),
      });
    }
  };

  const decidePermission = async (
    request: AgentBridgeObservedRequest,
    decision: AgentBridgePermissionDecision,
  ) => {
    updateView({ error: null });
    try {
      const ruleResult = await commands.createAgentBridgePermissionRule(
        request.id,
        decision,
      );
      if (ruleResult.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(ruleResult.error),
          }),
        });
        return;
      }
      const responseResult = await commands.respondAgentBridgePermission(
        request.id,
        ruleResult.data.id,
        decision,
      );
      if (responseResult.status !== "ok") {
        updateView({
          error: t("settings.agents.errors.operation", {
            error: String(responseResult.error),
          }),
        });
      }
      void refreshSettings();
      await refreshObservations();
    } catch (permissionError) {
      updateView({
        error: t("settings.agents.errors.operation", {
          error: String(permissionError),
        }),
      });
    }
  };

  const copyHookSnippet = async () => {
    if (!hookSnippet) return;
    try {
      await navigator.clipboard.writeText(hookSnippet);
    } catch (copyError) {
      updateView({ hookError: String(copyError) });
    }
  };

  const interactiveReady =
    bridge.master_enabled && status?.diagnostic === "active";

  return {
    bridge,
    status,
    sessions,
    requests,
    pendingMessages,
    hookSnippet,
    hookError,
    error,
    loading,
    authorizing,
    replySessionId,
    replyText,
    replySessions,
    interactiveReady,
    expiryTimeFormatter,
    updateView,
    mutateBridge,
    authorizeProject,
    createReplyPreview,
    confirmPending,
    cancelPending,
    dismissRequest,
    decidePermission,
    copyHookSnippet,
    refreshObservations,
  };
};

type AgentBridgeSettingsModel = ReturnType<typeof useAgentBridgeSettings>;

export const AgentsSettings: React.FC = () => {
  const model = useAgentBridgeSettings();
  return <AgentBridgeSettingsPage model={model} />;
};

/** A mono status word the backend changes under the reader. */
const LiveState: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className, children }) => (
  <span aria-live="polite">
    <Microlabel className={className}>{children}</Microlabel>
  </span>
);

const AgentBridgeSettingsPage: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
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
          onClick={() => void model.refreshObservations()}
          disabled={model.loading}
        >
          <RefreshCw
            aria-hidden="true"
            className={model.loading ? "animate-spin" : undefined}
          />
          {t("settings.agents.observed.refresh")}
        </Button>
      }
    >
      {model.error ? <Notice tone="danger">{model.error}</Notice> : null}
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
          <AgentBridgeControls model={model} />
          <AgentBridgeProjects model={model} />
          <AgentBridgeHook model={model} />
          <AgentBridgeObservations model={model} />
        </TabsContent>
        <TabsContent value="queue" className="flex flex-col gap-10 pt-8">
          <AgentBridgeReplyQueue model={model} />
        </TabsContent>
        <TabsContent value="rules" className="pt-8">
          <AgentBridgeRules model={model} />
        </TabsContent>
      </Tabs>
    </SettingsPage>
  );
};

const isAgentEnabled = (
  bridge: AgentBridgeSettingsModel["bridge"],
  agent: AgentBridgeAgent,
) => {
  if (agent === "claude") return bridge.claude_enabled;
  if (agent === "codex") return bridge.codex_enabled;
  if (agent === "grok") return bridge.grok_enabled;
  return bridge.omp_enabled;
};

const AgentBridgeControls: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const { bridge, status, mutateBridge } = model;

  return (
    <SettingsSection label={t("settings.agents.controls.title")}>
      <SettingsRow
        label={t("settings.agents.controls.master.label")}
        controlId="agent-bridge-master"
      >
        <Switch
          id="agent-bridge-master"
          checked={bridge.master_enabled}
          onCheckedChange={(enabled) =>
            void mutateBridge(() => commands.setAgentBridgeMaster(enabled))
          }
        />
      </SettingsRow>
      {/* Each agent's reply capability is the one thing the label cannot
       * carry, so it is a hint; the sentence that also repeated the label is
       * gone. */}
      {AGENTS.map((agent) => (
        <SettingsRow
          key={agent}
          label={t("settings.agents.controls.providers." + agent + ".label")}
          hint={t(
            "settings.agents.controls.providers." + agent + ".description",
          )}
          controlId={"agent-bridge-" + agent}
          disabled={!bridge.master_enabled}
        >
          <Switch
            id={"agent-bridge-" + agent}
            checked={isAgentEnabled(bridge, agent)}
            disabled={!bridge.master_enabled}
            onCheckedChange={(enabled) =>
              void mutateBridge(() =>
                commands.setAgentBridgeAgentEnabled(agent, enabled),
              )
            }
          />
        </SettingsRow>
      ))}
      {status ? (
        <SettingsRow label={t("settings.agents.controls.status")}>
          <LiveState>
            {t("settings.agents.status." + status.diagnostic)}
          </LiveState>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
};

const AgentBridgeProjects: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const { bridge, authorizing, authorizeProject, mutateBridge } = model;

  return (
    <SettingsSection
      label={t("settings.agents.projects.title")}
      action={
        /* The permission boundary is the hash, and the rows below are hashes:
         * the two paragraphs that said so now sit behind the button that
         * creates one. */
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void authorizeProject()}
              disabled={authorizing}
            >
              <FolderPlus aria-hidden="true" />
              {t("settings.agents.projects.add")}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            {t("settings.agents.projects.hashOnly")}
          </TooltipContent>
        </Tooltip>
      }
    >
      {bridge.allowed_projects.length === 0 ? (
        <div className="px-4 py-2.5">
          <Notice>{t("settings.agents.projects.empty")}</Notice>
        </div>
      ) : (
        bridge.allowed_projects.map((project) => (
          <div
            key={project.canonical_project_hash}
            className="flex min-h-[52px] min-w-0 items-center justify-between gap-4 px-4 py-2.5"
          >
            <code className="min-w-0 font-mono text-xs break-all text-gray-1000">
              {project.canonical_project_hash}
            </code>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-red-900"
              title={t("settings.agents.projects.remove")}
              aria-label={t("settings.agents.projects.remove")}
              onClick={() =>
                void mutateBridge(() =>
                  commands.removeAgentBridgeProject(
                    project.canonical_project_hash,
                  ),
                )
              }
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))
      )}
    </SettingsSection>
  );
};

const AgentBridgeHook: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();

  /* Nothing to copy and nothing to report: the section stays off the page
   * rather than drawing an empty surface. */
  if (model.hookSnippet === null && model.hookError === null) return null;

  return (
    <SettingsSection
      label={t("settings.agents.hook.title")}
      action={
        model.hookSnippet === null ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void model.copyHookSnippet()}
              >
                <Copy aria-hidden="true" />
                {t("settings.agents.hook.copy")}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {t("settings.agents.hook.description")}
            </TooltipContent>
          </Tooltip>
        )
      }
    >
      {model.hookError === null ? null : (
        <div className="px-4 py-2.5">
          <Notice tone="danger">
            {`${t("settings.agents.hook.error")}: ${model.hookError}`}
          </Notice>
        </div>
      )}
      {model.hookSnippet === null ? null : (
        <pre className="max-w-full overflow-hidden px-4 py-3 font-mono text-xs break-all whitespace-pre-wrap text-gray-900">
          <code>{model.hookSnippet}</code>
        </pre>
      )}
    </SettingsSection>
  );
};

const AgentBridgeReplyQueue: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const {
    replySessionId,
    replyText,
    replySessions,
    interactiveReady,
    pendingMessages,
    updateView,
    createReplyPreview,
    confirmPending,
    cancelPending,
  } = model;

  return (
    <>
      {/* The tab names this composer, so the card does not name it again, and
       * the two-step flow shows what the paragraph used to promise. */}
      <SettingsCard className="divide-y divide-gray-alpha-400">
        {interactiveReady ? null : (
          <div className="px-4 py-2.5">
            <Notice>
              {t(
                "settings.agents.replyQueue.notReady",
                "Replies need the bridge on and at least one agent enabled.",
              )}
            </Notice>
          </div>
        )}
        <SettingsField
          label={t("settings.agents.replyQueue.session")}
          controlId="agent-reply-session"
          disabled={!interactiveReady || replySessions.length === 0}
        >
          <Select
            value={replySessionId}
            onValueChange={(id) => updateView({ replySessionId: id })}
            disabled={!interactiveReady || replySessions.length === 0}
          >
            <SelectTrigger
              id="agent-reply-session"
              size="sm"
              className="w-full"
            >
              <SelectValue
                placeholder={t("settings.agents.replyQueue.noSession")}
              />
            </SelectTrigger>
            <SelectContent>
              {replySessions.map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  {t(
                    "settings.agents.controls.providers." +
                      session.agent +
                      ".label",
                  )}
                  {" · "}
                  {session.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsField>
        <SettingsField
          label={t("settings.agents.replyQueue.message")}
          controlId="agent-reply-text"
          disabled={!interactiveReady || !replySessionId}
        >
          <Textarea
            id="agent-reply-text"
            value={replyText}
            onChange={(event) => updateView({ replyText: event.target.value })}
            disabled={!interactiveReady || !replySessionId}
          />
        </SettingsField>
        <div className="flex justify-end px-4 py-2.5">
          <Button
            size="sm"
            onClick={() => void createReplyPreview()}
            disabled={
              !interactiveReady || !replySessionId || replyText.trim() === ""
            }
          >
            {t("settings.agents.replyQueue.createPreview")}
          </Button>
        </div>
      </SettingsCard>
      <SettingsSection
        label={t("settings.agents.pending.title", "Pending replies")}
      >
        {pendingMessages.length === 0 ? (
          <div className="px-4 py-2.5">
            <Notice>{t("settings.agents.pending.empty")}</Notice>
          </div>
        ) : (
          pendingMessages.map((pending) => (
            <div
              key={pending.id}
              className="flex min-w-0 flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-gray-800">
                  <span className="uppercase tracking-[0.12em]">
                    {t(
                      "settings.agents.controls.providers." +
                        pending.agent +
                        ".label",
                    )}
                  </span>
                  <code className="min-w-0 break-all">
                    {pending.session_id}
                  </code>
                </p>
                <p className="mt-1 text-[13px] leading-5 break-words whitespace-pre-wrap text-gray-1000">
                  {pending.text}
                </p>
                <p className="mt-1">
                  {/* The state, not an instruction: "review the destination
                   * before confirming" was the Confirm button said twice. */}
                  <LiveState
                    className={pending.confirmed ? "text-gray-1000" : undefined}
                  >
                    {pending.state === "held"
                      ? pending.confirmed
                        ? t("settings.agents.pending.confirmed")
                        : t("settings.agents.pending.states.held")
                      : t("settings.agents.pending.states." + pending.state)}
                  </LiveState>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {!pending.confirmed && pending.state === "held" ? (
                  <Button
                    size="sm"
                    onClick={() => void confirmPending(pending)}
                  >
                    {t("settings.agents.pending.confirm")}
                  </Button>
                ) : null}
                {pending.state === "held" || pending.state === "copy_only" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void cancelPending(pending.id)}
                  >
                    {t("settings.agents.pending.cancel")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </SettingsSection>
    </>
  );
};

const AgentBridgeObservations: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const {
    sessions,
    requests,
    interactiveReady,
    expiryTimeFormatter,
    decidePermission,
    dismissRequest,
  } = model;

  return (
    /* Two lists, two sections: the "Observed activity" heading only repeated
     * the tab above it, and its paragraph only described these rows. */
    <>
      <SettingsSection label={t("settings.agents.observed.sessions")}>
        {sessions.length === 0 ? (
          <div className="px-4 py-2.5">
            <Notice>{t("settings.agents.observed.noSessions")}</Notice>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className="flex min-h-[52px] min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
            >
              <span className="text-[13px] text-gray-1000">
                {t(
                  "settings.agents.controls.providers." +
                    session.agent +
                    ".label",
                )}
              </span>
              <code className="min-w-0 font-mono text-xs break-all text-gray-800">
                {session.id}
              </code>
              <code className="min-w-0 font-mono text-xs break-all text-gray-800">
                {session.canonical_project_hash}
              </code>
            </div>
          ))
        )}
      </SettingsSection>
      <SettingsSection label={t("settings.agents.observed.requests")}>
        {requests.length === 0 ? (
          <div className="px-4 py-2.5">
            <Notice>{t("settings.agents.observed.noRequests")}</Notice>
          </div>
        ) : (
          requests.map((request) => {
            const canRespondToPermission =
              interactiveReady &&
              request.agent === "claude" &&
              request.kind === "pre_tool_use" &&
              request.state === "observed" &&
              (request.tool_name === "AskUserQuestion" ||
                request.tool_name === "ExitPlanMode");
            const ompPermissionObserveOnly =
              request.agent === "omp" &&
              request.kind === "permission_request" &&
              request.state === "observed";

            return (
              <div
                key={request.id}
                className="flex min-w-0 flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-5 break-words text-gray-1000">
                    {t(
                      "settings.agents.controls.providers." +
                        request.agent +
                        ".label",
                    )}
                    {" · "}
                    {t("settings.agents.observed.requestKinds." + request.kind)}
                    {request.tool_name ? " · " + request.tool_name : ""}
                  </p>
                  <Microlabel className="mt-1 block">
                    {t("settings.agents.observed.expires", {
                      time: expiryTimeFormatter.format(
                        new Date(request.expires_at_ms),
                      ),
                    })}
                  </Microlabel>
                  {ompPermissionObserveOnly ? (
                    <Notice className="mt-1">
                      {t("settings.agents.observed.ompPermissionObserveOnly")}
                    </Notice>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {canRespondToPermission ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void decidePermission(request, "allow")}
                      >
                        {t("settings.agents.observed.allowExact")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-900"
                        onClick={() => void decidePermission(request, "deny")}
                      >
                        {t("settings.agents.observed.denyExact")}
                      </Button>
                    </>
                  ) : null}
                  {request.agent === "claude" &&
                  request.state === "observed" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void dismissRequest(request.id)}
                    >
                      {t("settings.agents.observed.dismiss")}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </SettingsSection>
    </>
  );
};

const AgentBridgeRules: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const { bridge, mutateBridge } = model;

  return (
    /* The tab strip already says "Exact permission rules", and each row is
     * the exact scope the paragraph used to spell out. */
    <SettingsCard className="divide-y divide-gray-alpha-400">
      {bridge.permission_rules.length === 0 ? (
        <div className="px-4 py-2.5">
          <Notice>{t("settings.agents.rules.empty")}</Notice>
        </div>
      ) : (
        bridge.permission_rules.map((rule) => (
          <div
            key={rule.id}
            className="flex min-w-0 flex-wrap items-start justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-5 break-words text-gray-1000">
                {rule.tool_name}
                {" · "}
                {t("settings.agents.rules.decisions." + rule.decision)}
              </p>
              <code className="mt-1 block font-mono text-xs break-all text-gray-800">
                {rule.canonical_project_hash}
              </code>
            </div>
            {rule.agent === "claude" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-red-900"
                title={t("settings.agents.rules.remove")}
                aria-label={t("settings.agents.rules.remove")}
                onClick={() =>
                  void mutateBridge(() =>
                    commands.deleteAgentBridgePermissionRule(rule.id),
                  )
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))
      )}
    </SettingsCard>
  );
};
