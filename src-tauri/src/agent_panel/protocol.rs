use crate::settings::{EnglishSpelling, OverlayPosition, OverlayStyle, Theme};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const SONA_AGENT_TURN_VERSION: &str = "SonaAgentTurnV1";
pub(crate) const SONA_CONFIG_SNAPSHOT_VERSION: &str = "SonaConfigSnapshotV1";
pub(crate) const SONA_CONFIG_PROPOSAL_VERSION: &str = "SonaConfigProposalV1";
pub(crate) const MAX_USER_MESSAGE_BYTES: usize = 8 * 1024;
pub(crate) const MAX_RECENT_TURNS: usize = 8;
pub(crate) const MAX_RECENT_TURN_BYTES: usize = 32 * 1024;
pub(crate) const MAX_PROPOSAL_BYTES: usize = 32 * 1024;
pub(crate) const MAX_PROPOSAL_ACTIONS: usize = 32;
pub(crate) const SONA_CHAT_TURN_VERSION: &str = "SonaChatTurnV1";
pub(crate) const SONA_CONFIG_WORKSPACE_ID: &str = "sona-config";
pub(crate) const SONA_CHAT_WORKSPACE_ID: &str = "sona-chat";
pub(crate) const SONA_CONFIG_CAPABILITY: &str = "sona-config";
pub(crate) const SONA_CHAT_CAPABILITY: &str = "sona-chat";
pub(crate) const MAX_CONTEXT_PACK_BYTES: usize = 32 * 1024;
pub(crate) const MAX_ASSISTANT_MESSAGE_BYTES: usize = 16 * 1024;
pub(crate) const MAX_RESPONSE_STEPS: usize = 32;
pub(crate) const MAX_STEP_LABEL_BYTES: usize = 256;

const PROPOSAL_SCHEMA_JSON: &str = r#"{"$id":"SonaConfigProposalV1","type":"object","additionalProperties":false,"required":["version","summary","rationale","actions","follow_up_question","source_settings_revision"],"properties":{"version":{"const":"SonaConfigProposalV1"},"summary":{"type":"string","minLength":1,"maxLength":2048},"rationale":{"type":"string","minLength":1,"maxLength":4096},"actions":{"type":"array","maxItems":32,"items":{"type":"object","additionalProperties":false,"required":["key","value"],"properties":{"key":{"enum":["audio_feedback","audio_output_device_id","audio_volume","default_transcription_model","language","local_retention_period","material_preference","microphone_excluded_ids","microphone_favorite_order","microphone_id","mode_selection","mode_toggles","mute_while_recording","overlay_position","overlay_style","spelling_behavior","start_hidden","theme","tray_visibility","update_note_visibility"]},"value":{"type":["string","number","boolean","array","object"]}}}},"follow_up_question":{"type":["string","null"],"maxLength":2048},"source_settings_revision":{"type":"integer","minimum":0}}}"#;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SonaAgentChatRoleV1 {
    User,
    Assistant,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaAgentChatTurnV1 {
    pub role: SonaAgentChatRoleV1,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaAppearanceSnapshotV1 {
    pub theme: String,
    pub available_themes: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaOverlaySnapshotV1 {
    pub style: String,
    pub position: String,
    pub available_styles: Vec<String>,
    pub available_positions: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaAudioSnapshotV1 {
    pub feedback_enabled: bool,
    pub volume: f32,
    pub mute_while_recording: bool,
    pub output_device_id: String,
    pub available_output_device_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaMicrophoneSnapshotV1 {
    pub selected_device_id: String,
    pub available_device_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaInstalledModelsSnapshotV1 {
    pub default_transcription_model: String,
    pub available_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaLanguageSnapshotV1 {
    pub language: String,
    pub spelling_behavior: String,
    pub available_languages: Vec<String>,
    pub available_spelling_behaviors: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaModesSnapshotV1 {
    pub selected: String,
    pub available: Vec<String>,
    pub toggles: BTreeMap<String, bool>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaPrivacySnapshotV1 {
    pub clipboard_enabled: bool,
    pub url_context_enabled: bool,
    pub selected_text_enabled: bool,
    pub application_context_enabled: bool,
    pub context_ceiling: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaRetentionSnapshotV1 {
    pub local_retention_days: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaCloudProvidersSnapshotV1 {
    pub states: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaPlatformSnapshotV1 {
    pub capabilities: BTreeMap<String, bool>,
    pub permissions: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaStartupSnapshotV1 {
    pub start_hidden: bool,
    pub tray_visibility: bool,
    pub update_note_visibility: bool,
}

/// Secret-free state passed to the fixed relay capability. Its field names and
/// value shapes are the relay's strict SonaConfigSnapshotV1 contract.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaConfigSnapshotV1 {
    pub version: String,
    pub settings_revision: u64,
    pub appearance: SonaAppearanceSnapshotV1,
    pub overlay: SonaOverlaySnapshotV1,
    pub audio: SonaAudioSnapshotV1,
    pub microphone: SonaMicrophoneSnapshotV1,
    pub installed_models: SonaInstalledModelsSnapshotV1,
    pub language: SonaLanguageSnapshotV1,
    pub modes: SonaModesSnapshotV1,
    pub privacy: SonaPrivacySnapshotV1,
    pub retention: SonaRetentionSnapshotV1,
    pub cloud_providers: SonaCloudProvidersSnapshotV1,
    pub platform: SonaPlatformSnapshotV1,
    pub startup: SonaStartupSnapshotV1,
}

/// Which capability-scoped brain a turn is addressed to. The relay registry
/// declares one sandbox per workspace, so this is the only thing that decides
/// what the remote side is allowed to be: `sona-config` is the zero-tool
/// settings proposer, `sona-chat` is the assistant that answers from a context
/// pack and may never touch settings.
///
/// The two are separate workspaces rather than one prompt with two moods
/// because their inputs differ in kind — one carries the whole settings
/// snapshot, the other carries evidence quotes — and because a brain that can
/// both read your configuration and answer open questions is a wider grant
/// than either job needs.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentPanelWorkspaceV1 {
    #[default]
    SonaChat,
    SonaConfig,
}

impl AgentPanelWorkspaceV1 {
    pub(crate) const fn id(self) -> &'static str {
        match self {
            Self::SonaChat => SONA_CHAT_WORKSPACE_ID,
            Self::SonaConfig => SONA_CONFIG_WORKSPACE_ID,
        }
    }

    pub(crate) const fn capability(self) -> &'static str {
        match self {
            Self::SonaChat => SONA_CHAT_CAPABILITY,
            Self::SonaConfig => SONA_CONFIG_CAPABILITY,
        }
    }
}

/// The settings-proposal turn. Its field set is frozen: the relay's
/// `sona-config` validator requires exactly these nine keys, so widening the
/// panel adds a second turn shape rather than a tenth field here.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SonaAgentTurnV1 {
    pub protocol_version: String,
    pub conversation_id: String,
    pub turn_id: String,
    pub user_message: String,
    pub recent_turns: Vec<SonaAgentChatTurnV1>,
    pub config_snapshot: SonaConfigSnapshotV1,
    pub proposal_schema: serde_json::Value,
    pub locale: String,
    pub app_version: String,
}

/// The assistant turn. Same conversation machinery as the config turn, with
/// the settings snapshot replaced by a context pack: quotes, ids and
/// `sona://` links assembled locally for this one question. The pack is
/// caller-supplied — the panel never assembles evidence itself — and `None`
/// is an ordinary turn with no evidence to cite.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SonaChatTurnV1 {
    pub protocol_version: String,
    pub conversation_id: String,
    pub turn_id: String,
    pub user_message: String,
    pub recent_turns: Vec<SonaAgentChatTurnV1>,
    pub context_pack: Option<String>,
    pub locale: String,
    pub app_version: String,
}

/// One turn, addressed to one workspace. Untagged because the workspace is
/// already named on the submission envelope the relay routes on; repeating it
/// inside the request would be a second source of truth for the same fact.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub(crate) enum PanelTurnV1 {
    Config(SonaAgentTurnV1),
    Chat(SonaChatTurnV1),
}

impl PanelTurnV1 {
    pub(crate) const fn workspace(&self) -> AgentPanelWorkspaceV1 {
        match self {
            Self::Config(_) => AgentPanelWorkspaceV1::SonaConfig,
            Self::Chat(_) => AgentPanelWorkspaceV1::SonaChat,
        }
    }

    pub(crate) fn turn_id(&self) -> &str {
        match self {
            Self::Config(turn) => &turn.turn_id,
            Self::Chat(turn) => &turn.turn_id,
        }
    }

    pub(crate) fn user_message(&self) -> &str {
        match self {
            Self::Config(turn) => &turn.user_message,
            Self::Chat(turn) => &turn.user_message,
        }
    }

    pub(crate) fn context_pack(&self) -> Option<&str> {
        match self {
            Self::Config(_) => None,
            Self::Chat(turn) => turn.context_pack.as_deref(),
        }
    }

    pub(crate) fn locale(&self) -> &str {
        match self {
            Self::Config(turn) => &turn.locale,
            Self::Chat(turn) => &turn.locale,
        }
    }

    /// The settings revision a proposal must match. Chat turns carry no
    /// snapshot, so a proposal can never be validated against one — which is
    /// the same thing as saying the chat workspace may not propose.
    pub(crate) const fn settings_revision(&self) -> Option<u64> {
        match self {
            Self::Config(turn) => Some(turn.config_snapshot.settings_revision),
            Self::Chat(_) => None,
        }
    }

    pub(crate) fn validate(&self) -> Result<(), ProposalValidationError> {
        match self {
            Self::Config(turn) => turn.validate(),
            Self::Chat(turn) => turn.validate(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "key", content = "value", rename_all = "snake_case")]
pub enum SonaSettingChangeV1 {
    Theme(Theme),
    OverlayStyle(OverlayStyle),
    OverlayPosition(OverlayPosition),
    AudioFeedback(bool),
    AudioVolume(f32),
    MuteWhileRecording(bool),
    AudioOutputDeviceId(String),
    MicrophoneId(String),
    DefaultTranscriptionModel(String),
    Language(String),
    SpellingBehavior(EnglishSpelling),
    ModeSelection(String),
    ModeToggles(BTreeMap<String, bool>),
    LocalRetentionPeriod(u32),
    StartHidden(bool),
    TrayVisibility(bool),
    UpdateNoteVisibility(bool),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SonaConfirmationClassV1 {
    Automatic,
    Review,
    Explicit,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaConfigProposalV1 {
    pub version: String,
    pub summary: String,
    pub rationale: String,
    pub actions: Vec<SonaSettingChangeV1>,
    pub follow_up_question: Option<String>,
    pub source_settings_revision: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SonaAgentStepStateV1 {
    Running,
    Done,
    Failed,
}

/// One row of the panel's activity tree: what the remote side did on the way
/// to its answer. The relay does not report steps yet, so every response today
/// carries an empty list; the field exists now so that the day a workspace
/// gains tools the panel already has somewhere to draw them, and so both
/// mirrors agree on the shape before anything depends on it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(deny_unknown_fields)]
pub struct SonaAgentStepV1 {
    pub id: String,
    pub label: String,
    pub state: SonaAgentStepStateV1,
}

/// What a finished job returned. `kind` is required and fail-closed: a
/// response that does not say which of the two things it is, is not one of
/// them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum SonaAgentResponseV1 {
    Text {
        message: String,
        #[serde(default)]
        steps: Vec<SonaAgentStepV1>,
    },
    Proposal {
        #[serde(flatten)]
        proposal: SonaConfigProposalV1,
        #[serde(default)]
        steps: Vec<SonaAgentStepV1>,
    },
}

impl SonaAgentResponseV1 {
    pub(crate) fn steps(&self) -> &[SonaAgentStepV1] {
        match self {
            Self::Text { steps, .. } | Self::Proposal { steps, .. } => steps,
        }
    }

    /// A workspace may only answer in its own currency. The settings proposer
    /// does not chat and the assistant does not propose: crossing that line is
    /// a remote side claiming authority it was never granted, so it fails the
    /// same way a bad signature does.
    pub(crate) fn validate(
        &self,
        workspace: AgentPanelWorkspaceV1,
        expected_revision: Option<u64>,
        allowed: &SonaAllowedValuesV1,
    ) -> Result<(), ProposalValidationError> {
        validate_steps(self.steps())?;
        match (self, workspace) {
            (Self::Text { message, .. }, AgentPanelWorkspaceV1::SonaChat) => {
                if is_message_text(message, MAX_ASSISTANT_MESSAGE_BYTES) {
                    Ok(())
                } else {
                    Err(ProposalValidationError::InvalidAssistantMessage)
                }
            }
            (Self::Proposal { proposal, .. }, AgentPanelWorkspaceV1::SonaConfig) => {
                let revision =
                    expected_revision.ok_or(ProposalValidationError::WorkspaceMismatch)?;
                proposal.validate(revision, allowed)
            }
            _ => Err(ProposalValidationError::WorkspaceMismatch),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct SonaAllowedValuesV1 {
    pub(crate) model_ids: BTreeSet<String>,
    pub(crate) input_device_names: BTreeMap<String, String>,
    pub(crate) output_device_names: BTreeMap<String, String>,
    pub(crate) language_codes: BTreeSet<String>,
    pub(crate) mode_ids: BTreeSet<String>,
    pub(crate) mode_toggle_names: BTreeSet<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProposalValidationError {
    InvalidVersion,
    InvalidTurnIdentifier,
    OversizedUserMessage,
    TooManyRecentTurns,
    OversizedRecentTurns,
    InvalidProposalSchema,
    InvalidLocale,
    InvalidAppVersion,
    InvalidSnapshot,
    EmptySummary,
    EmptyRationale,
    OversizedFollowUpQuestion,
    TooManyActions,
    StaleSnapshot,
    InvalidSettingValue,
    UnknownModel,
    UnknownInputDevice,
    UnknownOutputDevice,
    UnknownLanguage,
    UnknownMode,
    UnknownModeToggle,
    DuplicateAction,
    OversizedContextPack,
    InvalidAssistantMessage,
    TooManySteps,
    InvalidStep,
    WorkspaceMismatch,
}

impl SonaAgentTurnV1 {
    pub(crate) fn proposal_schema() -> Result<serde_json::Value, ProposalValidationError> {
        serde_json::from_str(PROPOSAL_SCHEMA_JSON)
            .map_err(|_| ProposalValidationError::InvalidProposalSchema)
    }

    pub(crate) fn validate(&self) -> Result<(), ProposalValidationError> {
        if self.protocol_version != SONA_AGENT_TURN_VERSION {
            return Err(ProposalValidationError::InvalidVersion);
        }
        if !is_identifier(&self.conversation_id) || !is_identifier(&self.turn_id) {
            return Err(ProposalValidationError::InvalidTurnIdentifier);
        }
        if !is_safe_text(&self.user_message, MAX_USER_MESSAGE_BYTES) {
            return Err(ProposalValidationError::OversizedUserMessage);
        }
        if self.recent_turns.len() > MAX_RECENT_TURNS {
            return Err(ProposalValidationError::TooManyRecentTurns);
        }
        if self
            .recent_turns
            .iter()
            .map(|turn| turn.message.len())
            .sum::<usize>()
            > MAX_RECENT_TURN_BYTES
        {
            return Err(ProposalValidationError::OversizedRecentTurns);
        }
        if self.proposal_schema != Self::proposal_schema()? {
            return Err(ProposalValidationError::InvalidProposalSchema);
        }
        if !is_safe_text(&self.locale, 64) {
            return Err(ProposalValidationError::InvalidLocale);
        }
        if !is_safe_text(&self.app_version, 128) {
            return Err(ProposalValidationError::InvalidAppVersion);
        }
        if !self.config_snapshot.is_valid() {
            return Err(ProposalValidationError::InvalidSnapshot);
        }
        Ok(())
    }
}

impl SonaChatTurnV1 {
    pub(crate) fn validate(&self) -> Result<(), ProposalValidationError> {
        if self.protocol_version != SONA_CHAT_TURN_VERSION {
            return Err(ProposalValidationError::InvalidVersion);
        }
        if !is_identifier(&self.conversation_id) || !is_identifier(&self.turn_id) {
            return Err(ProposalValidationError::InvalidTurnIdentifier);
        }
        if !is_safe_text(&self.user_message, MAX_USER_MESSAGE_BYTES) {
            return Err(ProposalValidationError::OversizedUserMessage);
        }
        if self.recent_turns.len() > MAX_RECENT_TURNS {
            return Err(ProposalValidationError::TooManyRecentTurns);
        }
        if self
            .recent_turns
            .iter()
            .map(|turn| turn.message.len())
            .sum::<usize>()
            > MAX_RECENT_TURN_BYTES
        {
            return Err(ProposalValidationError::OversizedRecentTurns);
        }
        /* A pack quotes the corpus back at the model, so it carries the one
         * thing the rest of this protocol refuses: `sona://` links. It is
         * checked for size and control bytes, not for the shape of its
         * contents, because its contents are evidence. */
        if self
            .context_pack
            .as_deref()
            .is_some_and(|pack| !is_message_text(pack, MAX_CONTEXT_PACK_BYTES))
        {
            return Err(ProposalValidationError::OversizedContextPack);
        }
        if !is_safe_text(&self.locale, 64) {
            return Err(ProposalValidationError::InvalidLocale);
        }
        if !is_safe_text(&self.app_version, 128) {
            return Err(ProposalValidationError::InvalidAppVersion);
        }
        Ok(())
    }
}

impl SonaConfigSnapshotV1 {
    pub(crate) fn allowed_values(&self, device_names: &DeviceNames) -> SonaAllowedValuesV1 {
        SonaAllowedValuesV1 {
            model_ids: self
                .installed_models
                .available_ids
                .iter()
                .cloned()
                .collect(),
            input_device_names: device_names.input.clone(),
            output_device_names: device_names.output.clone(),
            language_codes: self.language.available_languages.iter().cloned().collect(),
            mode_ids: self.modes.available.iter().cloned().collect(),
            mode_toggle_names: self.modes.toggles.keys().cloned().collect(),
        }
    }

    fn is_valid(&self) -> bool {
        self.version == SONA_CONFIG_SNAPSHOT_VERSION
            && self.settings_revision > 0
            && self.audio.volume.is_finite()
            && (0.0..=1.0).contains(&self.audio.volume)
            && identifier_list_is_valid(&self.appearance.available_themes)
            && identifier_list_is_valid(&self.overlay.available_styles)
            && identifier_list_is_valid(&self.overlay.available_positions)
            && identifier_list_is_valid(&self.audio.available_output_device_ids)
            && identifier_list_is_valid(&self.microphone.available_device_ids)
            && identifier_list_is_valid(&self.installed_models.available_ids)
            && identifier_list_is_valid(&self.language.available_languages)
            && identifier_list_is_valid(&self.language.available_spelling_behaviors)
            && identifier_list_is_valid(&self.modes.available)
            && self.modes.toggles.keys().all(|key| is_identifier(key))
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct DeviceNames {
    pub(crate) input: BTreeMap<String, String>,
    pub(crate) output: BTreeMap<String, String>,
}

impl SonaConfigProposalV1 {
    pub(crate) fn validate(
        &self,
        expected_revision: u64,
        allowed: &SonaAllowedValuesV1,
    ) -> Result<(), ProposalValidationError> {
        if self.version != SONA_CONFIG_PROPOSAL_VERSION {
            return Err(ProposalValidationError::InvalidVersion);
        }
        if self.source_settings_revision != expected_revision {
            return Err(ProposalValidationError::StaleSnapshot);
        }
        if !is_safe_text(&self.summary, 2048) {
            return Err(ProposalValidationError::EmptySummary);
        }
        if !is_safe_text(&self.rationale, 4096) {
            return Err(ProposalValidationError::EmptyRationale);
        }
        if self
            .follow_up_question
            .as_deref()
            .is_some_and(|question| !is_safe_text(question, 2048))
        {
            return Err(ProposalValidationError::OversizedFollowUpQuestion);
        }
        if self.actions.len() > MAX_PROPOSAL_ACTIONS {
            return Err(ProposalValidationError::TooManyActions);
        }
        let mut keys = BTreeSet::new();
        for change in &self.actions {
            if !keys.insert(change.key_name()) {
                return Err(ProposalValidationError::DuplicateAction);
            }
            change.validate(allowed)?;
        }
        Ok(())
    }
}

impl SonaSettingChangeV1 {
    pub(crate) fn confirmation_class(&self) -> SonaConfirmationClassV1 {
        match self {
            Self::Theme(_) | Self::OverlayStyle(_) | Self::OverlayPosition(_) => {
                SonaConfirmationClassV1::Automatic
            }
            Self::LocalRetentionPeriod(_) => SonaConfirmationClassV1::Explicit,
            Self::AudioFeedback(_)
            | Self::AudioVolume(_)
            | Self::MuteWhileRecording(_)
            | Self::AudioOutputDeviceId(_)
            | Self::MicrophoneId(_)
            | Self::DefaultTranscriptionModel(_)
            | Self::Language(_)
            | Self::SpellingBehavior(_)
            | Self::ModeSelection(_)
            | Self::ModeToggles(_)
            | Self::StartHidden(_)
            | Self::TrayVisibility(_)
            | Self::UpdateNoteVisibility(_) => SonaConfirmationClassV1::Review,
        }
    }

    pub(crate) fn is_auto_eligible(&self) -> bool {
        self.confirmation_class() == SonaConfirmationClassV1::Automatic
    }

    pub(crate) fn key_name(&self) -> &'static str {
        match self {
            Self::Theme(_) => "theme",
            Self::OverlayStyle(_) => "overlay_style",
            Self::OverlayPosition(_) => "overlay_position",
            Self::AudioFeedback(_) => "audio_feedback",
            Self::AudioVolume(_) => "audio_volume",
            Self::MuteWhileRecording(_) => "mute_while_recording",
            Self::AudioOutputDeviceId(_) => "audio_output_device_id",
            Self::MicrophoneId(_) => "microphone_id",
            Self::DefaultTranscriptionModel(_) => "default_transcription_model",
            Self::Language(_) => "language",
            Self::SpellingBehavior(_) => "spelling_behavior",
            Self::ModeSelection(_) => "mode_selection",
            Self::ModeToggles(_) => "mode_toggles",
            Self::LocalRetentionPeriod(_) => "local_retention_period",
            Self::StartHidden(_) => "start_hidden",
            Self::TrayVisibility(_) => "tray_visibility",
            Self::UpdateNoteVisibility(_) => "update_note_visibility",
        }
    }

    fn validate(&self, allowed: &SonaAllowedValuesV1) -> Result<(), ProposalValidationError> {
        match self {
            Self::AudioVolume(value) if !value.is_finite() || !(0.0..=1.0).contains(value) => {
                Err(ProposalValidationError::InvalidSettingValue)
            }
            Self::AudioOutputDeviceId(id) if !allowed.output_device_names.contains_key(id) => {
                Err(ProposalValidationError::UnknownOutputDevice)
            }
            Self::MicrophoneId(id) if !allowed.input_device_names.contains_key(id) => {
                Err(ProposalValidationError::UnknownInputDevice)
            }
            Self::DefaultTranscriptionModel(id) if !allowed.model_ids.contains(id) => {
                Err(ProposalValidationError::UnknownModel)
            }
            Self::Language(value) if !allowed.language_codes.contains(value) => {
                Err(ProposalValidationError::UnknownLanguage)
            }
            Self::ModeSelection(id) if !allowed.mode_ids.contains(id) => {
                Err(ProposalValidationError::UnknownMode)
            }
            Self::ModeToggles(values)
                if values.is_empty()
                    || values
                        .keys()
                        .any(|key| !allowed.mode_toggle_names.contains(key)) =>
            {
                Err(ProposalValidationError::UnknownModeToggle)
            }
            Self::LocalRetentionPeriod(days) if !matches!(days, 0 | 3 | 14 | 90) => {
                Err(ProposalValidationError::InvalidSettingValue)
            }
            _ => Ok(()),
        }
    }
}

fn is_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn identifier_list_is_valid(values: &[String]) -> bool {
    values.len() <= 128
        && values.iter().all(|value| is_identifier(value))
        && values.iter().collect::<BTreeSet<_>>().len() == values.len()
}

fn is_safe_text(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && !value.contains('\0')
        && !value.starts_with('/')
        && !value.starts_with("~/")
        && !value.contains("://")
}

/// Prose, as opposed to an identifier or a setting value.
///
/// `is_safe_text` refuses anything containing `://` because nothing in the
/// settings protocol has any business naming an endpoint. An assistant answer
/// is the opposite case: citing `sona://meeting/<id>` is the whole point of
/// giving it evidence, so the rule here is only that the string is non-empty,
/// bounded, and free of the control bytes that would let it forge structure in
/// a log or a terminal. Rendering escapes the rest.
fn is_message_text(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && !value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
}

fn validate_steps(steps: &[SonaAgentStepV1]) -> Result<(), ProposalValidationError> {
    if steps.len() > MAX_RESPONSE_STEPS {
        return Err(ProposalValidationError::TooManySteps);
    }
    let mut ids = BTreeSet::new();
    for step in steps {
        if !is_identifier(&step.id)
            || !is_message_text(&step.label, MAX_STEP_LABEL_BYTES)
            || !ids.insert(step.id.as_str())
        {
            return Err(ProposalValidationError::InvalidStep);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> (SonaConfigSnapshotV1, DeviceNames) {
        let mut input = BTreeMap::new();
        input.insert("input-1".to_string(), "Microphone".to_string());
        let mut output = BTreeMap::new();
        output.insert("output-1".to_string(), "Speakers".to_string());
        (
            SonaConfigSnapshotV1 {
                version: SONA_CONFIG_SNAPSHOT_VERSION.to_string(),
                settings_revision: 7,
                appearance: SonaAppearanceSnapshotV1 {
                    theme: "system".to_string(),
                    available_themes: vec!["system".to_string(), "dark".to_string()],
                },
                overlay: SonaOverlaySnapshotV1 {
                    style: "live".to_string(),
                    position: "bottom".to_string(),
                    available_styles: vec![
                        "none".to_string(),
                        "minimal".to_string(),
                        "live".to_string(),
                    ],
                    available_positions: vec!["top".to_string(), "bottom".to_string()],
                },
                audio: SonaAudioSnapshotV1 {
                    feedback_enabled: true,
                    volume: 0.5,
                    mute_while_recording: false,
                    output_device_id: "output-1".to_string(),
                    available_output_device_ids: vec!["output-1".to_string()],
                },
                microphone: SonaMicrophoneSnapshotV1 {
                    selected_device_id: "input-1".to_string(),
                    available_device_ids: vec!["input-1".to_string()],
                },
                installed_models: SonaInstalledModelsSnapshotV1 {
                    default_transcription_model: "small".to_string(),
                    available_ids: vec!["small".to_string()],
                },
                language: SonaLanguageSnapshotV1 {
                    language: "auto".to_string(),
                    spelling_behavior: "as_spoken".to_string(),
                    available_languages: vec!["auto".to_string(), "en".to_string()],
                    available_spelling_behaviors: vec![
                        "as_spoken".to_string(),
                        "british".to_string(),
                    ],
                },
                modes: SonaModesSnapshotV1 {
                    selected: "default".to_string(),
                    available: vec!["default".to_string()],
                    toggles: BTreeMap::from([("translate_to_english".to_string(), false)]),
                },
                privacy: SonaPrivacySnapshotV1 {
                    clipboard_enabled: false,
                    url_context_enabled: false,
                    selected_text_enabled: false,
                    application_context_enabled: false,
                    context_ceiling: 0,
                },
                retention: SonaRetentionSnapshotV1 {
                    local_retention_days: 0,
                },
                cloud_providers: SonaCloudProvidersSnapshotV1 {
                    states: BTreeMap::new(),
                },
                platform: SonaPlatformSnapshotV1 {
                    capabilities: BTreeMap::from([("agent_panel".to_string(), true)]),
                    permissions: BTreeMap::from([(
                        "microphone".to_string(),
                        "unavailable".to_string(),
                    )]),
                },
                startup: SonaStartupSnapshotV1 {
                    start_hidden: false,
                    tray_visibility: true,
                    update_note_visibility: true,
                },
            },
            DeviceNames { input, output },
        )
    }

    fn proposal(change: SonaSettingChangeV1) -> SonaConfigProposalV1 {
        SonaConfigProposalV1 {
            version: SONA_CONFIG_PROPOSAL_VERSION.to_string(),
            summary: "Use the selected setting.".to_string(),
            rationale: "It matches the local preference.".to_string(),
            actions: vec![change],
            follow_up_question: None,
            source_settings_revision: 7,
        }
    }

    #[test]
    fn turn_matches_the_relay_schema_contract() {
        let (config_snapshot, _) = snapshot();
        let turn = SonaAgentTurnV1 {
            protocol_version: SONA_AGENT_TURN_VERSION.to_string(),
            conversation_id: "conversation-0001".to_string(),
            turn_id: "turn-00000001".to_string(),
            user_message: "Use dark mode".to_string(),
            recent_turns: Vec::new(),
            config_snapshot,
            proposal_schema: SonaAgentTurnV1::proposal_schema().expect("static schema parses"),
            locale: "en".to_string(),
            app_version: "1.0.0".to_string(),
        };
        assert_eq!(turn.validate(), Ok(()));
    }

    #[test]
    fn proposal_rejects_unknown_local_ids() {
        let (snapshot, names) = snapshot();
        let allowed = snapshot.allowed_values(&names);
        assert_eq!(
            proposal(SonaSettingChangeV1::DefaultTranscriptionModel(
                "not-installed".to_string(),
            ))
            .validate(7, &allowed),
            Err(ProposalValidationError::UnknownModel)
        );
        assert_eq!(
            proposal(SonaSettingChangeV1::MicrophoneId("not-present".to_string()))
                .validate(7, &allowed),
            Err(ProposalValidationError::UnknownInputDevice)
        );
    }

    #[test]
    fn sensitive_retention_needs_explicit_confirmation() {
        assert_eq!(
            SonaSettingChangeV1::LocalRetentionPeriod(3).confirmation_class(),
            SonaConfirmationClassV1::Explicit
        );
        assert_eq!(
            SonaSettingChangeV1::Theme(Theme::Dark).confirmation_class(),
            SonaConfirmationClassV1::Automatic
        );
    }

    #[test]
    fn malformed_proposal_json_fails_closed() {
        let result = serde_json::from_str::<SonaConfigProposalV1>(
            r#"{"version":"SonaConfigProposalV1","summary":"x","rationale":"x","actions":[],"follow_up_question":null,"source_settings_revision":7,"unexpected":true}"#,
        );
        assert!(result.is_err());
    }

    fn chat_turn() -> SonaChatTurnV1 {
        SonaChatTurnV1 {
            protocol_version: SONA_CHAT_TURN_VERSION.to_string(),
            conversation_id: "conversation-0001".to_string(),
            turn_id: "turn-00000002".to_string(),
            user_message: "What did I promise Steven?".to_string(),
            recent_turns: Vec::new(),
            context_pack: Some(
                "sona://meeting/m-1 \"I will send the deck on Friday.\"".to_string(),
            ),
            locale: "en".to_string(),
            app_version: "1.0.0".to_string(),
        }
    }

    #[test]
    fn a_chat_turn_carries_a_pack_where_the_config_turn_carries_a_snapshot() {
        let turn = chat_turn();
        assert_eq!(turn.validate(), Ok(()));
        let wire = serde_json::to_value(PanelTurnV1::Chat(turn)).expect("chat turn serializes");
        let object = wire.as_object().expect("turn is an object");
        assert_eq!(
            object.keys().map(String::as_str).collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "protocol_version",
                "conversation_id",
                "turn_id",
                "user_message",
                "recent_turns",
                "context_pack",
                "locale",
                "app_version",
            ])
        );
        assert_eq!(object["protocol_version"], SONA_CHAT_TURN_VERSION);
    }

    #[test]
    fn the_frozen_config_turn_gained_no_fields() {
        let (config_snapshot, _) = snapshot();
        let turn = PanelTurnV1::Config(SonaAgentTurnV1 {
            protocol_version: SONA_AGENT_TURN_VERSION.to_string(),
            conversation_id: "conversation-0001".to_string(),
            turn_id: "turn-00000001".to_string(),
            user_message: "Use dark mode".to_string(),
            recent_turns: Vec::new(),
            config_snapshot,
            proposal_schema: SonaAgentTurnV1::proposal_schema().expect("static schema parses"),
            locale: "en".to_string(),
            app_version: "1.0.0".to_string(),
        });
        let wire = serde_json::to_value(&turn).expect("config turn serializes");
        assert_eq!(
            wire.as_object()
                .expect("turn is an object")
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "protocol_version",
                "conversation_id",
                "turn_id",
                "user_message",
                "recent_turns",
                "config_snapshot",
                "proposal_schema",
                "locale",
                "app_version",
            ])
        );
        assert_eq!(turn.workspace(), AgentPanelWorkspaceV1::SonaConfig);
        assert_eq!(turn.workspace().id(), "sona-config");
    }

    #[test]
    fn a_context_pack_may_cite_sona_links_but_not_exceed_its_ceiling() {
        let mut turn = chat_turn();
        turn.context_pack = Some("sona://person/steven".to_string());
        assert_eq!(turn.validate(), Ok(()));
        turn.context_pack = Some("x".repeat(MAX_CONTEXT_PACK_BYTES + 1));
        assert_eq!(
            turn.validate(),
            Err(ProposalValidationError::OversizedContextPack)
        );
        turn.context_pack = None;
        assert_eq!(turn.validate(), Ok(()));
    }

    #[test]
    fn both_response_kinds_round_trip_through_the_envelope() {
        let text = SonaAgentResponseV1::Text {
            message: "You promised Steven the deck. sona://meeting/m-1".to_string(),
            steps: vec![SonaAgentStepV1 {
                id: "step-1".to_string(),
                label: "Searched meetings".to_string(),
                state: SonaAgentStepStateV1::Done,
            }],
        };
        let encoded = serde_json::to_value(&text).expect("text response serializes");
        assert_eq!(encoded["kind"], "text");
        assert_eq!(
            serde_json::from_value::<SonaAgentResponseV1>(encoded).expect("text round-trips"),
            text
        );

        let proposal = SonaAgentResponseV1::Proposal {
            proposal: proposal(SonaSettingChangeV1::AudioVolume(0.25)),
            steps: Vec::new(),
        };
        let encoded = serde_json::to_value(&proposal).expect("proposal response serializes");
        assert_eq!(encoded["kind"], "proposal");
        /* The proposal variant is the existing proposal object with `kind`
         * beside its fields, not a proposal nested under a key: the settings
         * half of the contract did not move. */
        assert_eq!(encoded["version"], SONA_CONFIG_PROPOSAL_VERSION);
        assert_eq!(encoded["source_settings_revision"], 7);
        assert_eq!(
            serde_json::from_value::<SonaAgentResponseV1>(encoded).expect("proposal round-trips"),
            proposal
        );
    }

    #[test]
    fn a_response_without_a_kind_is_not_a_response() {
        assert!(serde_json::from_str::<SonaAgentResponseV1>(
            r#"{"version":"SonaConfigProposalV1","summary":"x","rationale":"y","actions":[],"follow_up_question":null,"source_settings_revision":7}"#
        )
        .is_err());
        assert!(serde_json::from_str::<SonaAgentResponseV1>(
            r#"{"kind":"whatever","message":"hi"}"#
        )
        .is_err());
    }

    #[test]
    fn a_workspace_may_only_answer_in_its_own_currency() {
        let (snapshot, names) = snapshot();
        let allowed = snapshot.allowed_values(&names);
        let text = SonaAgentResponseV1::Text {
            message: "Here is what I found.".to_string(),
            steps: Vec::new(),
        };
        assert_eq!(
            text.validate(AgentPanelWorkspaceV1::SonaChat, None, &allowed),
            Ok(())
        );
        assert_eq!(
            text.validate(AgentPanelWorkspaceV1::SonaConfig, Some(7), &allowed),
            Err(ProposalValidationError::WorkspaceMismatch)
        );

        let settings_change = SonaAgentResponseV1::Proposal {
            proposal: proposal(SonaSettingChangeV1::Theme(Theme::Dark)),
            steps: Vec::new(),
        };
        assert_eq!(
            settings_change.validate(AgentPanelWorkspaceV1::SonaConfig, Some(7), &allowed),
            Ok(())
        );
        /* The assistant has no snapshot, so it has nothing to propose against
         * — and a chat workspace that proposes settings anyway is refused. */
        assert_eq!(
            settings_change.validate(AgentPanelWorkspaceV1::SonaChat, None, &allowed),
            Err(ProposalValidationError::WorkspaceMismatch)
        );
    }

    #[test]
    fn steps_are_bounded_and_uniquely_identified() {
        let step = |id: &str| SonaAgentStepV1 {
            id: id.to_string(),
            label: "Read the transcript".to_string(),
            state: SonaAgentStepStateV1::Running,
        };
        assert_eq!(validate_steps(&[step("a"), step("b")]), Ok(()));
        assert_eq!(
            validate_steps(&[step("a"), step("a")]),
            Err(ProposalValidationError::InvalidStep)
        );
        let too_many = (0..=MAX_RESPONSE_STEPS)
            .map(|index| step(&format!("step-{index}")))
            .collect::<Vec<_>>();
        assert_eq!(
            validate_steps(&too_many),
            Err(ProposalValidationError::TooManySteps)
        );
    }
}
