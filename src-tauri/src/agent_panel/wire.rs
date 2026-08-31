use super::protocol::{
    AgentPanelWorkspaceV1, SonaAgentChatTurnV1, SonaAgentStepV1, SonaConfirmationClassV1,
    SonaSettingChangeV1,
};
use super::window::AgentPanelGeometryV1;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentPanelRelayStatusV1 {
    Disabled,
    Unpaired,
    Ready,
    Offline,
    InvalidConfiguration,
    SecretUnavailable,
    UntrustedResponse,
    RemoteRejected,
    OwnershipRejected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentPanelTurnStateV1 {
    Submitting,
    Queued,
    Leased,
    Running,
    WaitingUser,
    WaitingApproval,
    Canceling,
    Succeeded,
    Failed,
    Canceled,
    UnverifiedExternal,
}

impl AgentPanelTurnStateV1 {
    pub(crate) const fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::Failed | Self::Canceled | Self::UnverifiedExternal
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentPanelProposalStateV1 {
    Pending,
    Applied,
    Undone,
    Rejected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentPanelGeometryStatusV1 {
    Attached,
    Hidden,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelTurnStatusV1 {
    pub turn_id: String,
    pub workspace: AgentPanelWorkspaceV1,
    pub state: AgentPanelTurnStateV1,
    pub event_cursor: u64,
    /// When the panel accepted this turn, so the activity tree can count
    /// elapsed time without inventing a start of its own every time the
    /// webview re-reads status.
    pub started_at_utc_ms: i64,
    /// What the remote side did on the way to its answer. Empty until a
    /// workspace reports steps.
    pub steps: Vec<SonaAgentStepV1>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelProposalPreviewV1 {
    pub proposal_id: String,
    pub summary: String,
    pub rationale: String,
    pub actions: Vec<SonaSettingChangeV1>,
    pub follow_up_question: Option<String>,
    pub source_settings_revision: u64,
    pub confirmation: SonaConfirmationClassV1,
    pub state: AgentPanelProposalStateV1,
    pub receipt_id: Option<String>,
    pub applied_revision: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelStatusV1 {
    pub invalidation_id: u64,
    pub relay_status: AgentPanelRelayStatusV1,
    pub panel_open: bool,
    pub conversation: Vec<SonaAgentChatTurnV1>,
    pub turn: Option<AgentPanelTurnStatusV1>,
    pub proposal: Option<AgentPanelProposalPreviewV1>,
    pub geometry: Option<AgentPanelGeometryV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelSendTurnRequestV1 {
    pub turn_id: String,
    pub message: String,
    pub locale: String,
    pub workspace: AgentPanelWorkspaceV1,
    /// Evidence for this one question: quotes, ids and `sona://` links, built
    /// by whoever is asking. The panel does not assemble packs, and a turn
    /// without one is an ordinary question.
    pub context_pack: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelCancelTurnRequestV1 {
    pub turn_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelApplyChangeRequestV1 {
    pub proposal_id: String,
    pub action_index: u32,
    pub expected_revision: u64,
    pub confirmed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelUndoChangeRequestV1 {
    pub receipt_id: String,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelPairingRequestV1 {
    pub relay_url: String,
    pub relay_key_id: String,
    pub relay_public_key: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentPanelPairingCommandV1 {
    Set,
    Clear,
    TestConnection,
}

/// What the panel is paired to, as the settings store holds it. The private
/// half of this machine's identity is never here — it stays in the secret
/// backend, and `agent_panel_public_identity` is how the relay learns the
/// public half.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelPairingStatusV1 {
    pub paired: bool,
    pub relay_url: Option<String>,
    pub relay_key_id: Option<String>,
    pub relay_public_key: Option<String>,
    pub last_successful_connection_at_utc_ms: Option<i64>,
}

/// Proof that a pairing change happened, in the shape the rest of the app
/// uses: what was asked, by whom, when it committed, and the state it left
/// behind. A refused change returns `AgentPanelCommandErrorV1` instead — the
/// error is the reason code, and nothing was written to have a receipt for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelPairingReceiptV1 {
    pub schema_version: u32,
    pub receipt_id: String,
    pub command: AgentPanelPairingCommandV1,
    pub actor: AgentPanelActorV1,
    pub requested_at_utc_ms: i64,
    pub committed_at_utc_ms: i64,
    pub pairing: AgentPanelPairingStatusV1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentPanelActorV1 {
    User,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentPanelCommandErrorV1 {
    UnauthorizedWindow,
    Disabled,
    Unpaired,
    Offline,
    InvalidConfiguration,
    SecretUnavailable,
    UntrustedResponse,
    RemoteRejected,
    OwnershipRejected,
    MainUnavailable,
    InvalidRequest,
    TurnActive,
    UnknownTurn,
    UnknownProposal,
    ConfirmationRequired,
    StaleProposal,
    InvalidProposal,
    InvalidSetting,
    NotUndoable,
    NativeWindowFailure,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelStatusChangedEvent {
    pub invalidation_id: u64,
    pub status: AgentPanelRelayStatusV1,
}

impl tauri_specta::Event for AgentPanelStatusChangedEvent {
    const NAME: &'static str = "agent-panel://status-changed";
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelTurnChangedEvent {
    pub invalidation_id: u64,
    pub turn_id: Option<String>,
    pub state: Option<AgentPanelTurnStateV1>,
}

impl tauri_specta::Event for AgentPanelTurnChangedEvent {
    const NAME: &'static str = "agent-panel://turn-changed";
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelProposalChangedEvent {
    pub invalidation_id: u64,
    pub proposal_id: Option<String>,
    pub state: Option<AgentPanelProposalStateV1>,
}

impl tauri_specta::Event for AgentPanelProposalChangedEvent {
    const NAME: &'static str = "agent-panel://proposal-changed";
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct AgentPanelGeometryChangedEvent {
    pub invalidation_id: u64,
    pub status: AgentPanelGeometryStatusV1,
}

impl tauri_specta::Event for AgentPanelGeometryChangedEvent {
    const NAME: &'static str = "agent-panel://geometry-changed";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_keep_the_frozen_panel_names() {
        assert_eq!(
            <AgentPanelStatusChangedEvent as tauri_specta::Event>::NAME,
            "agent-panel://status-changed"
        );
        assert_eq!(
            <AgentPanelTurnChangedEvent as tauri_specta::Event>::NAME,
            "agent-panel://turn-changed"
        );
        assert_eq!(
            <AgentPanelProposalChangedEvent as tauri_specta::Event>::NAME,
            "agent-panel://proposal-changed"
        );
        assert_eq!(
            <AgentPanelGeometryChangedEvent as tauri_specta::Event>::NAME,
            "agent-panel://geometry-changed"
        );
    }
}
