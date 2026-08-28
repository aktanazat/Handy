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
}
