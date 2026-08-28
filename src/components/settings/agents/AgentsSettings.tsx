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
import {
  Alert,
  Button,
  SettingsGroup,
  StatusText,
  Tabs,
  Textarea,
  ToggleSwitch,
  type TabItem,
} from "@/components/ui";
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

const AGENT_WORKSPACE_PANEL_ID = "agents-workspace-panel";

const AgentBridgeSettingsPage: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState<"status" | "queue" | "rules">(
    "status",
  );
  const tabs = [
    {
      id: "status",
      label: t("settings.agents.observed.title"),
      panelId: AGENT_WORKSPACE_PANEL_ID,
    },
    {
      id: "queue",
      label: t("settings.agents.replyQueue.title"),
      panelId: AGENT_WORKSPACE_PANEL_ID,
    },
    {
      id: "rules",
      label: t("settings.agents.rules.title"),
      panelId: AGENT_WORKSPACE_PANEL_ID,
    },
  ] as const satisfies readonly TabItem[];

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("settings.agents.title")}</h1>
        <p className="settings-page-description">
          {t("settings.agents.description")}
        </p>
      </header>
      <AgentPanelToggle />
      {model.error ? <Alert variant="error">{model.error}</Alert> : null}
      <div className="flex flex-col gap-4">
        <Tabs
          items={tabs}
          value={workspace}
          onChange={(id) => {
            const next = tabs.find((tab) => tab.id === id);
            if (next) setWorkspace(next.id);
          }}
          label={t("settings.agents.workspaceNavigation", "Agent bridge views")}
          className="self-start"
        />
        <div
          id={AGENT_WORKSPACE_PANEL_ID}
          role="tabpanel"
          aria-labelledby={`tab-${workspace}`}
          className="flex flex-col gap-7"
        >
          {workspace === "status" ? (
            <>
              <AgentBridgeControls model={model} />
              <AgentBridgeProjects model={model} />
              <AgentBridgeHook model={model} />
              <AgentBridgeObservations model={model} />
            </>
          ) : workspace === "queue" ? (
            <AgentBridgeReplyQueue model={model} />
          ) : (
            <AgentBridgeRules model={model} />
          )}
        </div>
      </div>
    </div>
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
    <SettingsGroup title={t("settings.agents.controls.title")}>
      <ToggleSwitch
        grouped
        checked={bridge.master_enabled}
        onChange={(enabled) =>
          void mutateBridge(() => commands.setAgentBridgeMaster(enabled))
        }
        label={t("settings.agents.controls.master.label")}
        description={t("settings.agents.controls.master.description")}
      />
      {!bridge.master_enabled ? (
        <div className="px-4 py-3">
          <StatusText live="polite">
            {t("settings.agents.controls.offState")}
          </StatusText>
        </div>
      ) : null}
      {AGENTS.map((agent) => (
        <ToggleSwitch
          key={agent}
          grouped
          checked={isAgentEnabled(bridge, agent)}
          disabled={!bridge.master_enabled}
          onChange={(enabled) =>
            void mutateBridge(() =>
              commands.setAgentBridgeAgentEnabled(agent, enabled),
            )
          }
          label={t("settings.agents.controls.providers." + agent + ".label")}
          description={t(
            "settings.agents.controls.providers." + agent + ".description",
          )}
        />
      ))}
      {status ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="text-[13px] leading-5 text-text-secondary">
            {t("settings.agents.controls.status")}
          </span>
          <StatusText tone="neutral" live="polite">
            {t("settings.agents.status." + status.diagnostic)}
          </StatusText>
        </div>
      ) : null}
    </SettingsGroup>
  );
};

const AgentBridgeProjects: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const { bridge, authorizing, authorizeProject, mutateBridge } = model;

  return (
    <SettingsGroup
      title={t("settings.agents.projects.title")}
      description={t("settings.agents.projects.description")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="min-w-0 text-[13px] leading-5 text-text-secondary">
          {t("settings.agents.projects.hashOnly")}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="gap-1"
          onClick={() => void authorizeProject()}
          disabled={authorizing}
        >
          <FolderPlus aria-hidden="true" className="h-4 w-4" />
          {t("settings.agents.projects.add")}
        </Button>
      </div>
      {bridge.allowed_projects.length === 0 ? (
        <div className="px-4 py-3">
          <StatusText>{t("settings.agents.projects.empty")}</StatusText>
        </div>
      ) : (
        bridge.allowed_projects.map((project) => (
          <div
            key={project.canonical_project_hash}
            className="flex min-w-0 items-center justify-between gap-3 px-4 py-3"
          >
            <code className="min-w-0 font-mono text-xs break-all text-text-primary">
              {project.canonical_project_hash}
            </code>
            <Button
              variant="danger-ghost"
              size="sm"
              className="shrink-0 px-2"
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
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        ))
      )}
    </SettingsGroup>
  );
};

const AgentBridgeHook: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();

  return (
    <SettingsGroup title={t("settings.agents.hook.title")}>
      <div className="space-y-3 px-4 py-3">
        <p className="text-sm text-text-secondary">
          {t("settings.agents.hook.description")}
        </p>
        {model.hookError ? (
          <Alert variant="error">
            {t("settings.agents.hook.error")}: {model.hookError}
          </Alert>
        ) : null}
        {model.hookSnippet ? (
          <>
            <pre className="max-w-full overflow-hidden rounded-md border border-border bg-canvas p-3 font-mono text-xs whitespace-pre-wrap break-all text-text-primary">
              <code>{model.hookSnippet}</code>
            </pre>
            <Button
              variant="secondary"
              size="sm"
              className="gap-1"
              onClick={() => void model.copyHookSnippet()}
            >
              <Copy aria-hidden="true" className="h-4 w-4" />
              {t("settings.agents.hook.copy")}
            </Button>
          </>
        ) : null}
      </div>
    </SettingsGroup>
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
    <SettingsGroup
      title={t("settings.agents.replyQueue.title")}
      description={t("settings.agents.replyQueue.description")}
    >
      <div className="space-y-3 px-4 py-3">
        {interactiveReady ? null : (
          <StatusText live="polite">
            {t(
              "settings.agents.replyQueue.notReady",
              "Replies need the bridge on and at least one agent enabled.",
            )}
          </StatusText>
        )}
        <label
          className="block text-[13px] leading-5 font-medium text-text-primary"
          htmlFor="agent-reply-session"
        >
          {t("settings.agents.replyQueue.session")}
        </label>
        <select
          id="agent-reply-session"
          value={replySessionId}
          onChange={(event) =>
            updateView({ replySessionId: event.target.value })
          }
          disabled={!interactiveReady || replySessions.length === 0}
          className="control-surface w-full border px-3 text-[13px] text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {replySessions.length === 0 ? (
            <option value="">
              {t("settings.agents.replyQueue.noSession")}
            </option>
          ) : (
            replySessions.map((session) => (
              <option key={session.id} value={session.id}>
                {t(
                  "settings.agents.controls.providers." +
                    session.agent +
                    ".label",
                )}
                {" · "}
                {session.id}
              </option>
            ))
          )}
        </select>
        <label
          className="block text-[13px] leading-5 font-medium text-text-primary"
          htmlFor="agent-reply-text"
        >
          {t("settings.agents.replyQueue.message")}
        </label>
        <Textarea
          id="agent-reply-text"
          value={replyText}
          onChange={(event) => updateView({ replyText: event.target.value })}
          disabled={!interactiveReady || !replySessionId}
          className="w-full"
        />
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
      {pendingMessages.length === 0 ? (
        <div className="px-4 py-3">
          <StatusText>{t("settings.agents.pending.empty")}</StatusText>
        </div>
      ) : (
        pendingMessages.map((pending) => (
          <div
            key={pending.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-[12px] leading-4 text-text-secondary">
                {t(
                  "settings.agents.controls.providers." +
                    pending.agent +
                    ".label",
                )}
                {" · "}
                {t("settings.agents.replyQueue.session")}:{" "}
                <code className="font-mono break-all text-text-primary">
                  {pending.session_id}
                </code>
              </p>
              <p className="mt-1 text-[13px] leading-5 break-words whitespace-pre-wrap text-text-primary">
                {pending.text}
              </p>
              <p className="mt-1">
                <StatusText
                  tone={pending.confirmed ? "success" : "muted"}
                  live="polite"
                >
                  {pending.state === "held"
                    ? pending.confirmed
                      ? t("settings.agents.pending.confirmed")
                      : t("settings.agents.pending.preview")
                    : t("settings.agents.pending.states." + pending.state)}
                </StatusText>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!pending.confirmed && pending.state === "held" ? (
                <Button size="sm" onClick={() => void confirmPending(pending)}>
                  {t("settings.agents.pending.confirm")}
                </Button>
              ) : null}
              {pending.state === "held" || pending.state === "copy_only" ? (
                <Button
                  variant="secondary"
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
    </SettingsGroup>
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
    loading,
    expiryTimeFormatter,
    refreshObservations,
    decidePermission,
    dismissRequest,
  } = model;

  return (
    <SettingsGroup title={t("settings.agents.observed.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="min-w-0 text-[13px] leading-5 text-text-secondary">
          {t("settings.agents.observed.description")}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="gap-1"
          onClick={() => void refreshObservations()}
          disabled={loading}
        >
          <RefreshCw
            aria-hidden="true"
            className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"}
          />
          {t("settings.agents.observed.refresh")}
        </Button>
      </div>
      <div className="px-4 py-3">
        <h3 className="text-[13px] leading-5 font-semibold text-text-primary">
          {t("settings.agents.observed.sessions")}
        </h3>
        {sessions.length === 0 ? (
          <p className="mt-1">
            <StatusText>{t("settings.agents.observed.noSessions")}</StatusText>
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="min-w-0 text-[13px] leading-5 text-text-secondary"
              >
                <span className="font-medium text-text-primary">
                  {t(
                    "settings.agents.controls.providers." +
                      session.agent +
                      ".label",
                  )}
                </span>
                {" · "}
                <code className="break-all font-mono text-xs">
                  {session.id}
                </code>
                {" · "}
                <code className="break-all font-mono text-xs">
                  {session.canonical_project_hash}
                </code>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="px-4 py-3">
        <h3 className="text-[13px] leading-5 font-semibold text-text-primary">
          {t("settings.agents.observed.requests")}
        </h3>
        {requests.length === 0 ? (
          <p className="mt-1">
            <StatusText>{t("settings.agents.observed.noRequests")}</StatusText>
          </p>
        ) : (
          <ul className="mt-2 space-y-3">
            {requests.map((request) => {
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
                <li
                  key={request.id}
                  className="min-w-0 text-[13px] leading-5 text-text-secondary"
                >
                  <p className="break-words">
                    <span className="font-medium text-text-primary">
                      {t(
                        "settings.agents.controls.providers." +
                          request.agent +
                          ".label",
                      )}
                    </span>
                    {" · "}
                    {t("settings.agents.observed.requestKinds." + request.kind)}
                    {request.tool_name ? " · " + request.tool_name : ""}
                  </p>
                  <p className="mt-1 text-xs">
                    {t("settings.agents.observed.expires", {
                      time: expiryTimeFormatter.format(
                        new Date(request.expires_at_ms),
                      ),
                    })}
                  </p>
                  {ompPermissionObserveOnly ? (
                    <p className="mt-2">
                      <StatusText>
                        {t("settings.agents.observed.ompPermissionObserveOnly")}
                      </StatusText>
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canRespondToPermission ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void decidePermission(request, "allow")
                          }
                        >
                          {t("settings.agents.observed.allowExact")}
                        </Button>
                        <Button
                          variant="danger-ghost"
                          size="sm"
                          onClick={() => void decidePermission(request, "deny")}
                        >
                          {t("settings.agents.observed.denyExact")}
                        </Button>
                      </>
                    ) : null}
                    {request.agent === "claude" &&
                    request.state === "observed" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void dismissRequest(request.id)}
                      >
                        {t("settings.agents.observed.dismiss")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SettingsGroup>
  );
};

const AgentBridgeRules: React.FC<{
  model: AgentBridgeSettingsModel;
}> = ({ model }) => {
  const { t } = useTranslation();
  const { bridge, mutateBridge } = model;

  return (
    <SettingsGroup title={t("settings.agents.rules.title")}>
      <p className="px-4 py-3 text-[13px] leading-5 text-text-secondary">
        {t("settings.agents.rules.description")}
      </p>
      {bridge.permission_rules.length === 0 ? (
        <div className="px-4 pb-3">
          <StatusText>{t("settings.agents.rules.empty")}</StatusText>
        </div>
      ) : (
        bridge.permission_rules.map((rule) => (
          <div
            key={rule.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0 text-[13px] leading-5 text-text-secondary">
              <p className="break-words text-text-primary">
                {rule.tool_name}
                {" · "}
                {t("settings.agents.rules.decisions." + rule.decision)}
              </p>
              <code className="mt-1 block break-all font-mono text-xs">
                {rule.canonical_project_hash}
              </code>
            </div>
            {rule.agent === "claude" ? (
              <Button
                variant="danger-ghost"
                size="sm"
                className="shrink-0 px-2"
                title={t("settings.agents.rules.remove")}
                aria-label={t("settings.agents.rules.remove")}
                onClick={() =>
                  void mutateBridge(() =>
                    commands.deleteAgentBridgePermissionRule(rule.id),
                  )
                }
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        ))
      )}
    </SettingsGroup>
  );
};
