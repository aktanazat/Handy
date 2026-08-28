use super::protocol::{SonaAgentChatTurnV1, SonaConfirmationClassV1, SonaSettingChangeV1};
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
    pub state: AgentPanelTurnStateV1,
    pub event_cursor: u64,
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
