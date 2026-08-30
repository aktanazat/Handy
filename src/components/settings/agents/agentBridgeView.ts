import type {
  AgentBridgeObservedRequest,
  AgentBridgeObservedSession,
  AgentBridgePendingMessage,
  AgentBridgeSettings,
  AgentBridgeStatus,
  Result,
} from "@/bindings";

export const EMPTY_BRIDGE_SETTINGS: AgentBridgeSettings = {
  master_enabled: false,
  claude_enabled: false,
  codex_enabled: false,
  grok_enabled: false,
  omp_enabled: false,
  allowed_projects: [],
  permission_rules: [],
};

export type BridgeMutation = Result<AgentBridgeSettings, string>;

export interface AgentBridgeViewState {
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

export const agentBridgeViewReducer = (
  state: AgentBridgeViewState,
  patch: Partial<AgentBridgeViewState>,
): AgentBridgeViewState => ({ ...state, ...patch });
