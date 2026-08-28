mod config;
mod protocol;
mod relay;
mod window;
mod wire;

use config::{AppliedSettings, ConfigError, SettingUndo};
use protocol::{
    SonaAgentChatRoleV1, SonaAgentChatTurnV1, SonaAgentTurnV1, SonaAllowedValuesV1,
    SonaConfigProposalV1, SonaConfirmationClassV1, SonaSettingChangeV1, MAX_RECENT_TURNS,
    MAX_RECENT_TURN_BYTES, SONA_AGENT_TURN_VERSION,
};
use relay::{RelayClient, RelayError, RelayEvent, RelayJob, RelayJobStateV1, ResponseNonceCache};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_specta::Event as _;
use window::{AgentPanelWindowController, WindowError, AGENT_PANEL_WINDOW_LABEL};

pub use relay::AgentPanelPublicIdentityV1;
pub use window::AgentPanelGeometryV1;
pub use wire::{
    AgentPanelApplyChangeRequestV1, AgentPanelCancelTurnRequestV1, AgentPanelCommandErrorV1,
    AgentPanelGeometryChangedEvent, AgentPanelGeometryStatusV1, AgentPanelProposalChangedEvent,
    AgentPanelProposalPreviewV1, AgentPanelProposalStateV1, AgentPanelRelayStatusV1,
    AgentPanelSendTurnRequestV1, AgentPanelStatusChangedEvent, AgentPanelStatusV1,
    AgentPanelTurnChangedEvent, AgentPanelTurnStateV1, AgentPanelTurnStatusV1,
    AgentPanelUndoChangeRequestV1,
};

const MAIN_WINDOW_LABEL: &str = "main";
const POLL_INTERVAL: Duration = Duration::from_millis(750);
const IDLE_POLL_INTERVAL: Duration = Duration::from_secs(2);
const IDLE_POLL_AFTER: Duration = Duration::from_secs(10);
const MAX_CONVERSATION_TURNS: usize = MAX_RECENT_TURNS * 2;

struct ActiveTurn {
    turn_id: String,
    idempotency_key: String,
    request: SonaAgentTurnV1,
    allowed: SonaAllowedValuesV1,
    job_id: Option<String>,
    state: AgentPanelTurnStateV1,
    event_cursor: u64,
    submitting: bool,
    cancel_requested: bool,
    last_progress: Instant,
}

impl ActiveTurn {
    fn status(&self) -> AgentPanelTurnStatusV1 {
        AgentPanelTurnStatusV1 {
            turn_id: self.turn_id.clone(),
            state: self.state,
            event_cursor: self.event_cursor,
        }
    }
}

struct AppliedReceipt {
    id: String,
    revision: u64,
    undo: Vec<SettingUndo>,
}

struct StoredProposal {
    id: String,
    proposal: SonaConfigProposalV1,
    allowed: SonaAllowedValuesV1,
    state: AgentPanelProposalStateV1,
    receipt: Option<AppliedReceipt>,
}

impl StoredProposal {
    fn preview(&self) -> AgentPanelProposalPreviewV1 {
        AgentPanelProposalPreviewV1 {
            proposal_id: self.id.clone(),
            summary: self.proposal.summary.clone(),
            rationale: self.proposal.rationale.clone(),
            actions: self.proposal.actions.clone(),
            follow_up_question: self.proposal.follow_up_question.clone(),
            source_settings_revision: self.proposal.source_settings_revision,
            confirmation: strongest_confirmation(&self.proposal.actions),
            state: self.state,
            receipt_id: self.receipt.as_ref().map(|receipt| receipt.id.clone()),
            applied_revision: self.receipt.as_ref().map(|receipt| receipt.revision),
        }
    }
}

struct PanelState {
    invalidation_id: u64,
    relay_status: AgentPanelRelayStatusV1,
    panel_open: bool,
    conversation_id: Option<String>,
    conversation: Vec<SonaAgentChatTurnV1>,
    turn: Option<ActiveTurn>,
    proposal: Option<StoredProposal>,
}

impl Default for PanelState {
    fn default() -> Self {
        Self {
            invalidation_id: 0,
            relay_status: AgentPanelRelayStatusV1::Disabled,
            panel_open: false,
            conversation_id: None,
            conversation: Vec::new(),
            turn: None,
            proposal: None,
        }
    }
}

impl PanelState {
    fn invalidate(&mut self) -> u64 {
        self.invalidation_id = self.invalidation_id.saturating_add(1);
        self.invalidation_id
    }

    fn status(&self, geometry: Option<AgentPanelGeometryV1>) -> AgentPanelStatusV1 {
        AgentPanelStatusV1 {
            invalidation_id: self.invalidation_id,
            relay_status: self.relay_status,
            panel_open: self.panel_open,
            conversation: self.conversation.clone(),
            turn: self.turn.as_ref().map(ActiveTurn::status),
            proposal: self.proposal.as_ref().map(StoredProposal::preview),
            geometry,
        }
    }

    fn push_conversation(&mut self, turn: SonaAgentChatTurnV1) {
        self.conversation.push(turn);
        if self.conversation.len() > MAX_CONVERSATION_TURNS {
            let excess = self.conversation.len() - MAX_CONVERSATION_TURNS;
            self.conversation.drain(..excess);
        }
    }

    fn recent_turns(&self) -> Vec<SonaAgentChatTurnV1> {
        let mut retained = Vec::with_capacity(MAX_RECENT_TURNS);
        let mut bytes = 0_usize;
        for turn in self.conversation.iter().rev().take(MAX_RECENT_TURNS) {
            let next = match bytes.checked_add(turn.message.len()) {
                Some(next) => next,
                None => break,
            };
            if next > MAX_RECENT_TURN_BYTES {
                break;
            }
            bytes = next;
            retained.push(turn.clone());
        }
        retained.reverse();
        retained
    }
}

pub(crate) struct AgentPanelManager {
    app: AppHandle,
    window: AgentPanelWindowController,
    state: Mutex<PanelState>,
    nonce_cache: Arc<ResponseNonceCache>,
    poll_generation: AtomicU64,
}

impl AgentPanelManager {
    pub(crate) fn new(app: &AppHandle) -> Self {
        Self {
            app: app.clone(),
            window: AgentPanelWindowController::new(app),
            state: Mutex::new(PanelState::default()),
            nonce_cache: Arc::new(ResponseNonceCache::default()),
            poll_generation: AtomicU64::new(0),
        }
    }

    fn lock_state(&self) -> MutexGuard<'_, PanelState> {
        match self.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn current_status(&self) -> AgentPanelStatusV1 {
        let state = self.lock_state();
        let geometry = state.panel_open.then(|| self.window.geometry()).flatten();
        state.status(geometry)
    }

    fn configured_relay_status(&self) -> AgentPanelRelayStatusV1 {
        let settings = crate::settings::get_settings(&self.app);
        if !settings.agent_panel_enabled {
            AgentPanelRelayStatusV1::Disabled
        } else if !settings.agent_panel_paired {
            AgentPanelRelayStatusV1::Unpaired
        } else if settings.agent_panel_relay_url.is_none()
            || settings.agent_panel_relay_key_id.is_none()
            || settings.agent_panel_relay_public_key.is_none()
        {
            AgentPanelRelayStatusV1::InvalidConfiguration
        } else {
            AgentPanelRelayStatusV1::Ready
        }
    }

    fn refresh_configured_status_locked(&self, state: &mut PanelState) {
        if matches!(
            state.relay_status,
            AgentPanelRelayStatusV1::Disabled
                | AgentPanelRelayStatusV1::Unpaired
                | AgentPanelRelayStatusV1::InvalidConfiguration
        ) {
            state.relay_status = self.configured_relay_status();
        }
    }

    pub(crate) fn open(&self) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
        if !crate::settings::get_settings(&self.app).agent_panel_enabled {
            return Err(AgentPanelCommandErrorV1::Disabled);
        }
        self.window.open().map_err(map_window_error)?;
        let (invalidation_id, relay_status) = {
            let mut state = self.lock_state();
            state.panel_open = true;
            self.refresh_configured_status_locked(&mut state);
            let invalidation_id = state.invalidate();
            (invalidation_id, state.relay_status)
        };
        self.emit_status(invalidation_id, relay_status);
        self.emit_geometry(invalidation_id, AgentPanelGeometryStatusV1::Attached);
        self.start_polling();
        Ok(self.current_status())
    }

    pub(crate) fn close(&self) -> AgentPanelStatusV1 {
        self.stop_polling();
        self.window.close();
        let (invalidation_id, relay_status) = {
            let mut state = self.lock_state();
            state.panel_open = false;
            let invalidation_id = state.invalidate();
            (invalidation_id, state.relay_status)
        };
        self.emit_status(invalidation_id, relay_status);
        self.emit_geometry(invalidation_id, AgentPanelGeometryStatusV1::Hidden);
        self.current_status()
    }

    pub(crate) fn on_main_hidden(&self) {
        self.window.hide_for_main();
        self.set_panel_hidden();
    }

    pub(crate) fn on_main_shown(&self) {
        if self.window.restore_after_main_show().is_some() {
            let (invalidation_id, relay_status) = {
                let mut state = self.lock_state();
                state.panel_open = true;
                self.refresh_configured_status_locked(&mut state);
                let invalidation_id = state.invalidate();
                (invalidation_id, state.relay_status)
            };
            self.emit_status(invalidation_id, relay_status);
            self.emit_geometry(invalidation_id, AgentPanelGeometryStatusV1::Attached);
            self.start_polling();
        }
    }

    pub(crate) fn sync_main_window(&self) {
        if self.window.sync_from_main().is_some() {
            let invalidation_id = {
                let mut state = self.lock_state();
                if !state.panel_open {
                    state.panel_open = true;
                }
                state.invalidate()
            };
            self.emit_geometry(invalidation_id, AgentPanelGeometryStatusV1::Attached);
        } else if self.window.is_desired_open() {
            self.set_panel_hidden();
        }
    }

    pub(crate) fn on_panel_destroyed(&self) {
        self.window.on_panel_destroyed();
        self.set_panel_hidden();
    }

    pub(crate) fn on_main_destroyed(&self) {
        self.stop_polling();
        self.window.on_main_destroyed();
        self.set_panel_hidden();
    }

    fn set_panel_hidden(&self) {
        self.stop_polling();
        let (invalidation_id, relay_status, changed) = {
            let mut state = self.lock_state();
            if !state.panel_open {
                (state.invalidation_id, state.relay_status, false)
            } else {
                state.panel_open = false;
                let invalidation_id = state.invalidate();
                (invalidation_id, state.relay_status, true)
            }
        };
        if changed {
            self.emit_status(invalidation_id, relay_status);
            self.emit_geometry(invalidation_id, AgentPanelGeometryStatusV1::Hidden);
        }
    }

    pub(crate) async fn public_identity(
        &self,
    ) -> Result<AgentPanelPublicIdentityV1, AgentPanelCommandErrorV1> {
        let enabled = crate::settings::get_settings(&self.app).agent_panel_enabled;
        let secrets = self
            .app
            .try_state::<Arc<crate::secrets::SecretManager>>()
            .ok_or(AgentPanelCommandErrorV1::SecretUnavailable)?;
        relay::public_identity(enabled, secrets.inner().as_ref())
            .await
            .map_err(map_relay_error)
    }

    pub(crate) async fn send_turn(
        &self,
        request: AgentPanelSendTurnRequestV1,
    ) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
        if !is_opaque_id(&request.turn_id) {
            return Err(AgentPanelCommandErrorV1::InvalidRequest);
        }

        if let Some(should_submit) = self.resume_matching_turn(&request)? {
            if should_submit {
                self.submit_active_turn(&request.turn_id).await?;
            }
            return Ok(self.current_status());
        }

        let context = config::build_snapshot(&self.app)
            .await
            .map_err(map_config_error)?;
        let idempotency_key = relay::new_idempotency_key().map_err(map_relay_error)?;
        let turn_id = request.turn_id.clone();
        let invalidation_id = {
            let mut state = self.lock_state();
            if state
                .turn
                .as_ref()
                .is_some_and(|active| !active.state.is_terminal())
            {
                return Err(AgentPanelCommandErrorV1::TurnActive);
            }
            let conversation_id = match state.conversation_id.clone() {
                Some(conversation_id) => conversation_id,
                None => {
                    let conversation_id = format!("conversation-{idempotency_key}");
                    state.conversation_id = Some(conversation_id.clone());
                    conversation_id
                }
            };
            let turn = SonaAgentTurnV1 {
                protocol_version: SONA_AGENT_TURN_VERSION.to_string(),
                conversation_id,
                turn_id: turn_id.clone(),
                user_message: request.message.clone(),
                recent_turns: state.recent_turns(),
                config_snapshot: context.snapshot,
                proposal_schema: SonaAgentTurnV1::proposal_schema()
                    .map_err(|_| AgentPanelCommandErrorV1::InvalidRequest)?,
                locale: request.locale,
                app_version: env!("CARGO_PKG_VERSION").to_string(),
            };
            turn.validate()
                .map_err(|_| AgentPanelCommandErrorV1::InvalidRequest)?;
            state.push_conversation(SonaAgentChatTurnV1 {
                role: SonaAgentChatRoleV1::User,
                message: turn.user_message.clone(),
            });
            state.proposal = None;
            state.turn = Some(ActiveTurn {
                turn_id: turn.turn_id.clone(),
                idempotency_key,
                request: turn,
                allowed: context.allowed,
                job_id: None,
                state: AgentPanelTurnStateV1::Submitting,
                event_cursor: 0,
                submitting: false,
                cancel_requested: false,
                last_progress: Instant::now(),
            });
            state.invalidate()
        };
        self.emit_turn(
            invalidation_id,
            Some(turn_id.clone()),
            Some(AgentPanelTurnStateV1::Submitting),
        );
        self.emit_proposal(invalidation_id, None, None);
        self.submit_active_turn(&turn_id).await?;
        Ok(self.current_status())
    }

    fn resume_matching_turn(
        &self,
        request: &AgentPanelSendTurnRequestV1,
    ) -> Result<Option<bool>, AgentPanelCommandErrorV1> {
        let state = self.lock_state();
        let Some(active) = state.turn.as_ref() else {
            return Ok(None);
        };
        if active.state.is_terminal() {
            return Ok(None);
        }
        if active.turn_id != request.turn_id {
            return Err(AgentPanelCommandErrorV1::TurnActive);
        }
        if active.request.user_message != request.message || active.request.locale != request.locale
        {
            return Err(AgentPanelCommandErrorV1::InvalidRequest);
        }
        Ok(Some(active.job_id.is_none() && !active.submitting))
    }

    async fn submit_active_turn(&self, turn_id: &str) -> Result<(), AgentPanelCommandErrorV1> {
        let submission = {
            let mut state = self.lock_state();
            let (idempotency_key, request, turn_state) = {
                let active = state
                    .turn
                    .as_mut()
                    .filter(|active| active.turn_id == turn_id)
                    .ok_or(AgentPanelCommandErrorV1::UnknownTurn)?;
                if active.job_id.is_some() || active.submitting {
                    return Ok(());
                }
                active.submitting = true;
                active.state = if active.cancel_requested {
                    AgentPanelTurnStateV1::Canceling
                } else {
                    AgentPanelTurnStateV1::Submitting
                };
                (
                    active.idempotency_key.clone(),
                    active.request.clone(),
                    active.state,
                )
            };
            let invalidation_id = state.invalidate();
            (idempotency_key, request, invalidation_id, turn_state)
        };
        self.emit_turn(submission.2, Some(turn_id.to_string()), Some(submission.3));

        let result = match RelayClient::from_settings(&self.app, self.nonce_cache.clone()).await {
            Ok(client) => client.submit_turn(&submission.0, &submission.1).await,
            Err(error) => Err(error),
        };
        match result {
            Ok(job) => {
                let follow_up = self.accept_job(turn_id, job)?;
                if follow_up.auto_apply {
                    if let Some(proposal_id) = follow_up.proposal_id.as_deref() {
                        self.apply_safe_appearance_proposal(proposal_id)?;
                    }
                }
                if follow_up.cancel_requested {
                    self.cancel_known_turn(turn_id).await?;
                } else if !follow_up.terminal {
                    self.start_polling();
                }
                Ok(())
            }
            Err(error) => {
                self.record_relay_error(turn_id, error, true);
                Err(map_relay_error(error))
            }
        }
    }

    pub(crate) async fn cancel_turn(
        &self,
        request: AgentPanelCancelTurnRequestV1,
    ) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
        let should_submit = {
            let mut state = self.lock_state();
            let active = state
                .turn
                .as_mut()
                .filter(|active| active.turn_id == request.turn_id)
                .ok_or(AgentPanelCommandErrorV1::UnknownTurn)?;
            if active.state.is_terminal() {
                return Ok(state.status(None));
            }
            active.cancel_requested = true;
            active.state = AgentPanelTurnStateV1::Canceling;
            let should_submit = active.job_id.is_none() && !active.submitting;
            let invalidation_id = state.invalidate();
            self.emit_turn(
                invalidation_id,
                Some(request.turn_id.clone()),
                Some(AgentPanelTurnStateV1::Canceling),
            );
            should_submit
        };
        if should_submit {
            self.submit_active_turn(&request.turn_id).await?;
        } else {
            self.cancel_known_turn(&request.turn_id).await?;
        }
        Ok(self.current_status())
    }

    async fn cancel_known_turn(&self, turn_id: &str) -> Result<(), AgentPanelCommandErrorV1> {
        let job_id = {
            let state = self.lock_state();
            let active = state
                .turn
                .as_ref()
                .filter(|active| active.turn_id == turn_id)
                .ok_or(AgentPanelCommandErrorV1::UnknownTurn)?;
            let Some(job_id) = active.job_id.clone() else {
                return Ok(());
            };
            if active.state.is_terminal() {
                return Ok(());
            }
            job_id
        };
        let result = match RelayClient::from_settings(&self.app, self.nonce_cache.clone()).await {
            Ok(client) => client.cancel_job(&job_id).await,
            Err(error) => Err(error),
        };
        match result {
            Ok(job) => {
                let follow_up = self.accept_job(turn_id, job)?;
                if !follow_up.terminal {
                    self.start_polling();
                }
                Ok(())
            }
            Err(error) => {
                self.record_relay_error(turn_id, error, false);
                Err(map_relay_error(error))
            }
        }
    }

    fn accept_job(
        &self,
        turn_id: &str,
        job: RelayJob,
    ) -> Result<JobFollowUp, AgentPanelCommandErrorV1> {
        let RelayJob {
            id: job_id,
            state: relay_state,
            proposal,
        } = job;
        let auto_apply_enabled =
            crate::settings::get_settings(&self.app).agent_panel_safe_appearance_auto_apply;
        let (expected_revision, allowed, existing_job_id) = {
            let state = self.lock_state();
            let active = state
                .turn
                .as_ref()
                .filter(|active| active.turn_id == turn_id)
                .ok_or(AgentPanelCommandErrorV1::UnknownTurn)?;
            (
                active.request.config_snapshot.settings_revision,
                active.allowed.clone(),
                active.job_id.clone(),
            )
        };
        if existing_job_id
            .as_deref()
            .is_some_and(|existing| existing != job_id)
        {
            self.record_relay_error(turn_id, RelayError::OwnershipRejected, false);
            return Err(AgentPanelCommandErrorV1::OwnershipRejected);
        }
        if proposal
            .as_ref()
            .is_some_and(|proposal| proposal.validate(expected_revision, &allowed).is_err())
        {
            self.record_protocol_failure(turn_id);
            return Err(AgentPanelCommandErrorV1::InvalidProposal);
        }

        let (invalidation_id, turn_state, proposal_event, follow_up) = {
            let mut state = self.lock_state();
            let (cancel_requested, turn_state) = {
                let active = state
                    .turn
                    .as_mut()
                    .filter(|active| active.turn_id == turn_id)
                    .ok_or(AgentPanelCommandErrorV1::UnknownTurn)?;
                if active
                    .job_id
                    .as_deref()
                    .is_some_and(|existing| existing != job_id)
                {
                    return Err(AgentPanelCommandErrorV1::OwnershipRejected);
                }
                active.job_id = Some(job_id);
                active.submitting = false;
                active.last_progress = Instant::now();
                active.state = turn_state_for_job(&relay_state, active.cancel_requested);
                (active.cancel_requested, active.state)
            };
            state.relay_status = AgentPanelRelayStatusV1::Ready;

            let mut proposal_event = None;
            let mut auto_apply = false;
            if let Some(proposal) = proposal {
                let proposal_id = format!("proposal-{turn_id}");
                let summary = proposal.summary.clone();
                let all_safe_appearance = !proposal.actions.is_empty()
                    && proposal
                        .actions
                        .iter()
                        .all(SonaSettingChangeV1::is_auto_eligible);
                state.push_conversation(SonaAgentChatTurnV1 {
                    role: SonaAgentChatRoleV1::Assistant,
                    message: summary,
                });
                state.proposal = Some(StoredProposal {
                    id: proposal_id.clone(),
                    proposal,
                    allowed,
                    state: AgentPanelProposalStateV1::Pending,
                    receipt: None,
                });
                proposal_event = Some((proposal_id, AgentPanelProposalStateV1::Pending));
                auto_apply = auto_apply_enabled && all_safe_appearance;
            }
            let invalidation_id = state.invalidate();
            let follow_up = JobFollowUp {
                proposal_id: proposal_event.as_ref().map(|event| event.0.clone()),
                auto_apply,
                cancel_requested,
                terminal: turn_state.is_terminal(),
            };
            (invalidation_id, turn_state, proposal_event, follow_up)
        };
        self.emit_status(invalidation_id, AgentPanelRelayStatusV1::Ready);
        self.emit_turn(invalidation_id, Some(turn_id.to_string()), Some(turn_state));
        if let Some((proposal_id, proposal_state)) = proposal_event {
            self.emit_proposal(invalidation_id, Some(proposal_id), Some(proposal_state));
        }
        Ok(follow_up)
    }

    pub(crate) fn apply_change(
        &self,
        request: AgentPanelApplyChangeRequestV1,
    ) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
        let (proposal_id, source_revision, allowed, change) = {
            let state = self.lock_state();
            let proposal = state
                .proposal
                .as_ref()
                .filter(|proposal| proposal.id == request.proposal_id)
                .ok_or(AgentPanelCommandErrorV1::UnknownProposal)?;
            if proposal.state != AgentPanelProposalStateV1::Pending {
                return Err(AgentPanelCommandErrorV1::NotUndoable);
            }
            if proposal.proposal.source_settings_revision != request.expected_revision {
                return Err(AgentPanelCommandErrorV1::StaleProposal);
            }
            let action_index = usize::try_from(request.action_index)
                .map_err(|_| AgentPanelCommandErrorV1::InvalidRequest)?;
            let change = proposal
                .proposal
                .actions
                .get(action_index)
                .cloned()
                .ok_or(AgentPanelCommandErrorV1::InvalidRequest)?;
            if change.confirmation_class() != SonaConfirmationClassV1::Automatic
                && !request.confirmed
            {
                return Err(AgentPanelCommandErrorV1::ConfirmationRequired);
            }
            (
                proposal.id.clone(),
                proposal.proposal.source_settings_revision,
                proposal.allowed.clone(),
                change,
            )
        };
        let applied = config::apply_changes(&self.app, source_revision, &[change], &allowed);
        let applied = match applied {
            Ok(applied) => applied,
            Err(error) => {
                self.record_config_error(&proposal_id, error);
                return Err(map_config_error(error));
            }
        };
        self.store_applied_receipt(&proposal_id, applied)?;
        Ok(self.current_status())
    }

    fn apply_safe_appearance_proposal(
        &self,
        proposal_id: &str,
    ) -> Result<(), AgentPanelCommandErrorV1> {
        let (source_revision, allowed, changes) = {
            let state = self.lock_state();
            let proposal = state
                .proposal
                .as_ref()
                .filter(|proposal| proposal.id == proposal_id)
                .ok_or(AgentPanelCommandErrorV1::UnknownProposal)?;
            if proposal.state != AgentPanelProposalStateV1::Pending
                || proposal.proposal.actions.is_empty()
                || !proposal
                    .proposal
                    .actions
                    .iter()
                    .all(SonaSettingChangeV1::is_auto_eligible)
            {
                return Ok(());
            }
            (
                proposal.proposal.source_settings_revision,
                proposal.allowed.clone(),
                proposal.proposal.actions.clone(),
            )
        };
        let applied = config::apply_changes(&self.app, source_revision, &changes, &allowed);
        let applied = match applied {
            Ok(applied) => applied,
            Err(error) => {
                self.record_config_error(proposal_id, error);
                return Err(map_config_error(error));
            }
        };
        self.store_applied_receipt(proposal_id, applied)
    }

    fn store_applied_receipt(
        &self,
        proposal_id: &str,
        applied: AppliedSettings,
    ) -> Result<(), AgentPanelCommandErrorV1> {
        let (invalidation_id, proposal_state) = {
            let mut state = self.lock_state();
            let proposal_state = {
                let proposal = state
                    .proposal
                    .as_mut()
                    .filter(|proposal| proposal.id == proposal_id)
                    .ok_or(AgentPanelCommandErrorV1::UnknownProposal)?;
                if proposal.state != AgentPanelProposalStateV1::Pending {
                    return Err(AgentPanelCommandErrorV1::NotUndoable);
                }
                proposal.state = AgentPanelProposalStateV1::Applied;
                proposal.receipt = Some(AppliedReceipt {
                    id: format!("receipt-{proposal_id}-{}", applied.revision),
                    revision: applied.revision,
                    undo: applied.undo().to_vec(),
                });
                proposal.state
            };
            let invalidation_id = state.invalidate();
            (invalidation_id, proposal_state)
        };
        self.emit_proposal(
            invalidation_id,
            Some(proposal_id.to_string()),
            Some(proposal_state),
        );
        Ok(())
    }

    pub(crate) fn undo_change(
        &self,
        request: AgentPanelUndoChangeRequestV1,
    ) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
        let (proposal_id, undo) = {
            let state = self.lock_state();
            let proposal = state
                .proposal
                .as_ref()
                .ok_or(AgentPanelCommandErrorV1::NotUndoable)?;
            let receipt = proposal
                .receipt
                .as_ref()
                .filter(|receipt| receipt.id == request.receipt_id)
                .ok_or(AgentPanelCommandErrorV1::NotUndoable)?;
            if proposal.state != AgentPanelProposalStateV1::Applied
                || receipt.revision != request.expected_revision
            {
                return Err(AgentPanelCommandErrorV1::StaleProposal);
            }
            (proposal.id.clone(), receipt.undo.clone())
        };
        let _revision = match config::undo_changes(&self.app, request.expected_revision, &undo) {
            Ok(revision) => revision,
            Err(error) => {
                self.record_config_error(&proposal_id, error);
                return Err(map_config_error(error));
            }
        };
        let (invalidation_id, proposal_state) = {
            let mut state = self.lock_state();
            let proposal_state = {
                let proposal = state
                    .proposal
                    .as_mut()
                    .filter(|proposal| proposal.id == proposal_id)
                    .ok_or(AgentPanelCommandErrorV1::NotUndoable)?;
                let receipt = proposal
                    .receipt
                    .as_ref()
                    .ok_or(AgentPanelCommandErrorV1::NotUndoable)?;
                if receipt.revision != request.expected_revision {
                    return Err(AgentPanelCommandErrorV1::StaleProposal);
                }
                proposal.receipt = None;
                proposal.state = AgentPanelProposalStateV1::Undone;
                proposal.state
            };
            let invalidation_id = state.invalidate();
            (invalidation_id, proposal_state)
        };
        self.emit_proposal(invalidation_id, Some(proposal_id), Some(proposal_state));
        Ok(self.current_status())
    }

    fn record_config_error(&self, proposal_id: &str, error: ConfigError) {
        let (invalidation_id, state) = {
            let mut panel = self.lock_state();
            if let Some(proposal) = panel
                .proposal
                .as_mut()
                .filter(|proposal| proposal.id == proposal_id)
            {
                proposal.state = AgentPanelProposalStateV1::Rejected;
                proposal.receipt = None;
            }
            if matches!(error, ConfigError::StaleRevision) {
                panel.relay_status = AgentPanelRelayStatusV1::Ready;
            }
            let invalidation_id = panel.invalidate();
            (
                invalidation_id,
                panel.proposal.as_ref().map(|proposal| proposal.state),
            )
        };
        self.emit_proposal(invalidation_id, Some(proposal_id.to_string()), state);
    }

    fn record_relay_error(&self, turn_id: &str, error: RelayError, submit_failure: bool) {
        let relay_status = relay_status_for_error(error);
        let retryable = matches!(error, RelayError::RequestFailed) && !submit_failure;
        let (invalidation_id, turn_state) = {
            let mut state = self.lock_state();
            state.relay_status = relay_status;
            let turn_state = state
                .turn
                .as_mut()
                .filter(|active| active.turn_id == turn_id)
                .map(|active| {
                    active.submitting = false;
                    if !retryable && !matches!(error, RelayError::RequestFailed) {
                        active.state = AgentPanelTurnStateV1::Failed;
                    }
                    active.state
                });
            let invalidation_id = state.invalidate();
            (invalidation_id, turn_state)
        };
        self.emit_status(invalidation_id, relay_status);
        self.emit_turn(invalidation_id, Some(turn_id.to_string()), turn_state);
    }

    fn record_protocol_failure(&self, turn_id: &str) {
        let (invalidation_id, turn_state) = {
            let mut state = self.lock_state();
            state.relay_status = AgentPanelRelayStatusV1::UntrustedResponse;
            let turn_state = state
                .turn
                .as_mut()
                .filter(|active| active.turn_id == turn_id)
                .map(|active| {
                    active.state = AgentPanelTurnStateV1::Failed;
                    active.state
                });
            let invalidation_id = state.invalidate();
            (invalidation_id, turn_state)
        };
        self.emit_status(invalidation_id, AgentPanelRelayStatusV1::UntrustedResponse);
        self.emit_turn(invalidation_id, Some(turn_id.to_string()), turn_state);
    }

    fn start_polling(&self) {
        let generation = self
            .poll_generation
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1);
        if self.poll_plan(generation).is_none() {
            return;
        }
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            poll_loop(app, generation).await;
        });
    }

    fn stop_polling(&self) {
        self.poll_generation.fetch_add(1, Ordering::AcqRel);
    }

    fn poll_plan(&self, generation: u64) -> Option<PollPlan> {
        if self.poll_generation.load(Ordering::Acquire) != generation {
            return None;
        }
        let state = self.lock_state();
        if !state.panel_open {
            return None;
        }
        let active = state.turn.as_ref()?;
        let job_id = active.job_id.clone()?;
        if active.state.is_terminal() {
            return None;
        }
        let delay = if active.last_progress.elapsed() >= IDLE_POLL_AFTER {
            IDLE_POLL_INTERVAL
        } else {
            POLL_INTERVAL
        };
        Some(PollPlan {
            turn_id: active.turn_id.clone(),
            job_id,
            event_cursor: active.event_cursor,
            delay,
        })
    }

    fn accept_events(
        &self,
        turn_id: &str,
        job_id: &str,
        events: Vec<RelayEvent>,
    ) -> Result<(), AgentPanelCommandErrorV1> {
        if events.is_empty() {
            return Ok(());
        }
        let (invalidation_id, turn_state) = {
            let mut state = self.lock_state();
            let turn_state = {
                let active = state
                    .turn
                    .as_mut()
                    .filter(|active| {
                        active.turn_id == turn_id && active.job_id.as_deref() == Some(job_id)
                    })
                    .ok_or(AgentPanelCommandErrorV1::OwnershipRejected)?;
                for event in events {
                    if event.id <= active.event_cursor || event.event_type.is_empty() {
                        return Err(AgentPanelCommandErrorV1::UntrustedResponse);
                    }
                    active.event_cursor = event.id;
                    active.last_progress = Instant::now();
                }
                active.state
            };
            let invalidation_id = state.invalidate();
            (invalidation_id, turn_state)
        };
        self.emit_turn(invalidation_id, Some(turn_id.to_string()), Some(turn_state));
        Ok(())
    }

    pub(crate) async fn shutdown(&self) {
        self.stop_polling();
        self.window.on_main_destroyed();
        let job_id = {
            let mut state = self.lock_state();
            state.panel_open = false;
            state.turn.as_mut().and_then(|active| {
                if active.state.is_terminal() {
                    None
                } else {
                    active.cancel_requested = true;
                    active.job_id.clone()
                }
            })
        };
        let Some(job_id) = job_id else {
            return;
        };
        if let Ok(client) = RelayClient::from_settings(&self.app, self.nonce_cache.clone()).await {
            let _ = client.cancel_job(&job_id).await;
        }
    }

    fn emit_status(&self, invalidation_id: u64, status: AgentPanelRelayStatusV1) {
        let _ = self.app.emit(
            AgentPanelStatusChangedEvent::NAME,
            AgentPanelStatusChangedEvent {
                invalidation_id,
                status,
            },
        );
    }

    fn emit_turn(
        &self,
        invalidation_id: u64,
        turn_id: Option<String>,
        state: Option<AgentPanelTurnStateV1>,
    ) {
        let _ = self.app.emit(
            AgentPanelTurnChangedEvent::NAME,
            AgentPanelTurnChangedEvent {
                invalidation_id,
                turn_id,
                state,
            },
        );
    }

    fn emit_proposal(
        &self,
        invalidation_id: u64,
        proposal_id: Option<String>,
        state: Option<AgentPanelProposalStateV1>,
    ) {
        let _ = self.app.emit(
            AgentPanelProposalChangedEvent::NAME,
            AgentPanelProposalChangedEvent {
                invalidation_id,
                proposal_id,
                state,
            },
        );
    }

    fn emit_geometry(&self, invalidation_id: u64, status: AgentPanelGeometryStatusV1) {
        let _ = self.app.emit(
            AgentPanelGeometryChangedEvent::NAME,
            AgentPanelGeometryChangedEvent {
                invalidation_id,
                status,
            },
        );
    }
}

struct PollPlan {
    turn_id: String,
    job_id: String,
    event_cursor: u64,
    delay: Duration,
}

struct JobFollowUp {
    proposal_id: Option<String>,
    auto_apply: bool,
    cancel_requested: bool,
    terminal: bool,
}

async fn poll_loop(app: AppHandle, generation: u64) {
    loop {
        let plan = {
            let manager = app.state::<AgentPanelManager>();
            manager.poll_plan(generation)
        };
        let Some(plan) = plan else {
            return;
        };
        let result = poll_once(&app, &plan).await;
        if result.is_err() {
            let manager = app.state::<AgentPanelManager>();
            manager.record_protocol_failure(&plan.turn_id);
            return;
        }
        tokio::time::sleep(plan.delay).await;
    }
}

async fn poll_once(app: &AppHandle, plan: &PollPlan) -> Result<(), AgentPanelCommandErrorV1> {
    let (nonce_cache, app_handle) = {
        let manager = app.state::<AgentPanelManager>();
        (manager.nonce_cache.clone(), manager.app.clone())
    };
    let client = match RelayClient::from_settings(&app_handle, nonce_cache).await {
        Ok(client) => client,
        Err(error) => {
            let manager = app.state::<AgentPanelManager>();
            manager.record_relay_error(&plan.turn_id, error, false);
            return if matches!(error, RelayError::RequestFailed) {
                Ok(())
            } else {
                Err(map_relay_error(error))
            };
        }
    };
    let job = match client.get_job(&plan.job_id).await {
        Ok(job) => job,
        Err(error) => {
            let manager = app.state::<AgentPanelManager>();
            manager.record_relay_error(&plan.turn_id, error, false);
            return if matches!(error, RelayError::RequestFailed) {
                Ok(())
            } else {
                Err(map_relay_error(error))
            };
        }
    };
    let follow_up = {
        let manager = app.state::<AgentPanelManager>();
        manager.accept_job(&plan.turn_id, job)?
    };
    if follow_up.auto_apply {
        if let Some(proposal_id) = follow_up.proposal_id.as_deref() {
            let manager = app.state::<AgentPanelManager>();
            manager.apply_safe_appearance_proposal(proposal_id)?;
        }
    }
    if follow_up.cancel_requested {
        let manager = app.state::<AgentPanelManager>();
        manager.cancel_known_turn(&plan.turn_id).await?;
        return Ok(());
    }
    let events = match client.get_events(&plan.job_id, plan.event_cursor).await {
        Ok(events) => events,
        Err(error) => {
            let manager = app.state::<AgentPanelManager>();
            manager.record_relay_error(&plan.turn_id, error, false);
            return if matches!(error, RelayError::RequestFailed) {
                Ok(())
            } else {
                Err(map_relay_error(error))
            };
        }
    };
    let manager = app.state::<AgentPanelManager>();
    manager.accept_events(&plan.turn_id, &plan.job_id, events)
}

fn turn_state_for_job(state: &RelayJobStateV1, cancel_requested: bool) -> AgentPanelTurnStateV1 {
    if cancel_requested && !state.is_terminal() {
        return AgentPanelTurnStateV1::Canceling;
    }
    match state {
        RelayJobStateV1::Queued => AgentPanelTurnStateV1::Queued,
        RelayJobStateV1::Leased => AgentPanelTurnStateV1::Leased,
        RelayJobStateV1::Running => AgentPanelTurnStateV1::Running,
        RelayJobStateV1::WaitingUser => AgentPanelTurnStateV1::WaitingUser,
        RelayJobStateV1::WaitingApproval => AgentPanelTurnStateV1::WaitingApproval,
        RelayJobStateV1::Succeeded => AgentPanelTurnStateV1::Succeeded,
        RelayJobStateV1::Failed => AgentPanelTurnStateV1::Failed,
        RelayJobStateV1::Canceled => AgentPanelTurnStateV1::Canceled,
        RelayJobStateV1::UnverifiedExternal => AgentPanelTurnStateV1::UnverifiedExternal,
    }
}

fn strongest_confirmation(changes: &[SonaSettingChangeV1]) -> SonaConfirmationClassV1 {
    if changes
        .iter()
        .any(|change| change.confirmation_class() == SonaConfirmationClassV1::Explicit)
    {
        SonaConfirmationClassV1::Explicit
    } else if changes
        .iter()
        .any(|change| change.confirmation_class() == SonaConfirmationClassV1::Review)
    {
        SonaConfirmationClassV1::Review
    } else {
        SonaConfirmationClassV1::Automatic
    }
}

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn relay_status_for_error(error: RelayError) -> AgentPanelRelayStatusV1 {
    match error {
        RelayError::Disabled => AgentPanelRelayStatusV1::Disabled,
        RelayError::Unpaired => AgentPanelRelayStatusV1::Unpaired,
        RelayError::InvalidConfiguration | RelayError::CleartextRejected => {
            AgentPanelRelayStatusV1::InvalidConfiguration
        }
        RelayError::SecretUnavailable => AgentPanelRelayStatusV1::SecretUnavailable,
        RelayError::RequestFailed => AgentPanelRelayStatusV1::Offline,
        RelayError::ResponseSignatureInvalid
        | RelayError::ResponseMalformed
        | RelayError::ResponseTooLarge => AgentPanelRelayStatusV1::UntrustedResponse,
        RelayError::RemoteRejected | RelayError::RandomUnavailable => {
            AgentPanelRelayStatusV1::RemoteRejected
        }
        RelayError::OwnershipRejected => AgentPanelRelayStatusV1::OwnershipRejected,
    }
}

fn map_relay_error(error: RelayError) -> AgentPanelCommandErrorV1 {
    match error {
        RelayError::Disabled => AgentPanelCommandErrorV1::Disabled,
        RelayError::Unpaired => AgentPanelCommandErrorV1::Unpaired,
        RelayError::InvalidConfiguration | RelayError::CleartextRejected => {
            AgentPanelCommandErrorV1::InvalidConfiguration
        }
        RelayError::SecretUnavailable => AgentPanelCommandErrorV1::SecretUnavailable,
        RelayError::RequestFailed => AgentPanelCommandErrorV1::Offline,
        RelayError::ResponseSignatureInvalid
        | RelayError::ResponseMalformed
        | RelayError::ResponseTooLarge => AgentPanelCommandErrorV1::UntrustedResponse,
        RelayError::RemoteRejected | RelayError::RandomUnavailable => {
            AgentPanelCommandErrorV1::RemoteRejected
        }
        RelayError::OwnershipRejected => AgentPanelCommandErrorV1::OwnershipRejected,
    }
}

fn map_config_error(error: ConfigError) -> AgentPanelCommandErrorV1 {
    match error {
        ConfigError::SnapshotUnavailable => AgentPanelCommandErrorV1::Offline,
        ConfigError::StaleRevision => AgentPanelCommandErrorV1::StaleProposal,
        ConfigError::InvalidProposal => AgentPanelCommandErrorV1::InvalidProposal,
        ConfigError::InvalidSetting => AgentPanelCommandErrorV1::InvalidSetting,
    }
}

fn map_window_error(error: WindowError) -> AgentPanelCommandErrorV1 {
    match error {
        WindowError::MainUnavailable => AgentPanelCommandErrorV1::MainUnavailable,
        WindowError::NativeFailure => AgentPanelCommandErrorV1::NativeWindowFailure,
    }
}

fn require_caller(
    caller: &WebviewWindow,
    allowed_labels: &[&str],
) -> Result<(), AgentPanelCommandErrorV1> {
    if allowed_labels.iter().any(|label| *label == caller.label()) {
        Ok(())
    } else {
        Err(AgentPanelCommandErrorV1::UnauthorizedWindow)
    }
}

#[tauri::command]
#[specta::specta]
pub fn agent_panel_open(
    caller: WebviewWindow,
    manager: State<'_, AgentPanelManager>,
) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
    require_caller(&caller, &[MAIN_WINDOW_LABEL])?;
    manager.open()
}

#[tauri::command]
#[specta::specta]
pub fn agent_panel_close(
    caller: WebviewWindow,
    manager: State<'_, AgentPanelManager>,
) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
    require_caller(&caller, &[AGENT_PANEL_WINDOW_LABEL])?;
    Ok(manager.close())
}

#[tauri::command]
#[specta::specta]
pub fn agent_panel_status(
    caller: WebviewWindow,
    manager: State<'_, AgentPanelManager>,
) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
    require_caller(&caller, &[AGENT_PANEL_WINDOW_LABEL])?;
    Ok(manager.current_status())
}

#[tauri::command]
#[specta::specta]
pub async fn agent_panel_send_turn(
    caller: WebviewWindow,
    manager: State<'_, AgentPanelManager>,
    request: AgentPanelSendTurnRequestV1,
) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
    require_caller(&caller, &[AGENT_PANEL_WINDOW_LABEL])?;
    manager.send_turn(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn agent_panel_cancel_turn(
    caller: WebviewWindow,
    manager: State<'_, AgentPanelManager>,
    request: AgentPanelCancelTurnRequestV1,
) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
    require_caller(&caller, &[AGENT_PANEL_WINDOW_LABEL])?;
    manager.cancel_turn(request).await
}

#[tauri::command]
#[specta::specta]
pub fn agent_panel_apply_change(
    caller: WebviewWindow,
    manager: State<'_, AgentPanelManager>,
    request: AgentPanelApplyChangeRequestV1,
) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
    require_caller(&caller, &[AGENT_PANEL_WINDOW_LABEL])?;
    manager.apply_change(request)
}

#[tauri::command]
#[specta::specta]
pub fn agent_panel_undo_change(
    caller: WebviewWindow,
    manager: State<'_, AgentPanelManager>,
    request: AgentPanelUndoChangeRequestV1,
) -> Result<AgentPanelStatusV1, AgentPanelCommandErrorV1> {
    require_caller(&caller, &[AGENT_PANEL_WINDOW_LABEL])?;
    manager.undo_change(request)
}

pub(crate) async fn cli_public_identity(
) -> Result<AgentPanelPublicIdentityV1, AgentPanelCommandErrorV1> {
    let secrets = crate::secrets::SecretManager::native();
    relay::public_identity(true, &secrets)
        .await
        .map_err(map_relay_error)
}

#[tauri::command]
#[specta::specta]
pub async fn agent_panel_public_identity(
    caller: WebviewWindow,
    manager: State<'_, AgentPanelManager>,
) -> Result<AgentPanelPublicIdentityV1, AgentPanelCommandErrorV1> {
    require_caller(&caller, &[MAIN_WINDOW_LABEL, AGENT_PANEL_WINDOW_LABEL])?;
    manager.public_identity().await
}

/// The panel's lifecycle owner also owns the switch that turns it off:
/// disabling closes an attached panel instead of leaving a window whose
/// commands would all be refused.
#[tauri::command]
#[specta::specta]
pub fn change_agent_panel_enabled_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    crate::settings::update_settings(&app, |settings| {
        settings.agent_panel_enabled = enabled;
    });
    if !enabled {
        if let Some(manager) = app.try_state::<AgentPanelManager>() {
            manager.close();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Theme;

    #[test]
    fn confirmation_uses_the_strictest_action() {
        assert_eq!(
            strongest_confirmation(&[
                SonaSettingChangeV1::Theme(Theme::Dark),
                SonaSettingChangeV1::LocalRetentionPeriod(3),
            ]),
            SonaConfirmationClassV1::Explicit
        );
    }

    #[test]
    fn opaque_turn_ids_reject_paths_and_urls() {
        assert!(is_opaque_id("turn-0123"));
        assert!(!is_opaque_id("/tmp/turn"));
        assert!(!is_opaque_id("https://turn"));
    }

    #[test]
    fn terminal_turns_do_not_poll() {
        assert!(AgentPanelTurnStateV1::Succeeded.is_terminal());
        assert!(!AgentPanelTurnStateV1::Running.is_terminal());
    }
}
