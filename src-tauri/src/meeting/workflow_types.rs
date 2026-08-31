use super::document_types::DocumentId;
use super::types::MeetingSessionId;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowId {
    PersonLinking,
    PreMeetingBriefing,
    Continuity,
    VocabularyMining,
    DocumentLinking,
    /// Loop 1. Mines the dictation corpus for spoken symbol phrases no
    /// replacement rule covers yet.
    SpokenPunctuation,
    /// Loop 2. Turns repeated human-authored rewrites into vocabulary
    /// suggestions.
    CorrectionLearning,
    /// Loop 5. Notices a mode the user keeps reaching for by shortcut.
    ModeHabits,
    /// Loop 6. Reports capture-quality statistics worth acting on.
    CaptureAdvisor,
    /// Internal projection that narrates meeting recording decisions. It is
    /// permanently enabled and never appears in the Settings workflow list.
    MeetingActivity,
    /// Loop 4. Assembles the session-scoped priming blob for a meeting in a
    /// series with standing consent. Infrastructure, not a choice: it only ever
    /// runs for a series the user has already said yes to, and its output dies
    /// with the session.
    SeriesPriming,
}

impl WorkflowId {
    pub const CONFIGURABLE: [Self; 9] = [
        Self::PersonLinking,
        Self::PreMeetingBriefing,
        Self::Continuity,
        Self::VocabularyMining,
        Self::DocumentLinking,
        Self::SpokenPunctuation,
        Self::CorrectionLearning,
        Self::ModeHabits,
        Self::CaptureAdvisor,
    ];
    pub const ALL: [Self; 11] = [
        Self::PersonLinking,
        Self::PreMeetingBriefing,
        Self::Continuity,
        Self::VocabularyMining,
        Self::DocumentLinking,
        Self::SpokenPunctuation,
        Self::CorrectionLearning,
        Self::ModeHabits,
        Self::CaptureAdvisor,
        Self::MeetingActivity,
        Self::SeriesPriming,
    ];

    /// Workflows the Settings list never shows and `set_workflow_enabled`
    /// refuses to touch.
    pub const PERMANENT: [Self; 2] = [Self::MeetingActivity, Self::SeriesPriming];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PersonLinking => "person_linking",
            Self::PreMeetingBriefing => "pre_meeting_briefing",
            Self::Continuity => "continuity",
            Self::VocabularyMining => "vocabulary_mining",
            Self::DocumentLinking => "document_linking",
            Self::SpokenPunctuation => "spoken_punctuation",
            Self::CorrectionLearning => "correction_learning",
            Self::ModeHabits => "mode_habits",
            Self::CaptureAdvisor => "capture_advisor",
            Self::MeetingActivity => "meeting_activity",
            Self::SeriesPriming => "series_priming",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|workflow| workflow.as_str() == value)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub(crate) struct WorkflowEventId(pub Uuid);

impl WorkflowEventId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub const fn uuid(self) -> Uuid {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, Type)]
#[serde(transparent)]
pub struct WorkflowRunId(pub Uuid);

impl WorkflowRunId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub const fn uuid(self) -> Uuid {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowRunStatus {
    Ok,
    Failed,
    Skipped,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowOutcomeCode {
    PersonLinks,
    Briefing,
    Continuity,
    VocabularyCandidates,
    DocumentLinks,
    /// A learning loop finished a mining pass. `suggestions` counts what it
    /// added to the pending queue this run, which is the only number a reader
    /// can act on — a pass that mined a thousand runs and suggested nothing is
    /// a quiet success, not an event.
    LearningSuggestions,
    /// Loop 4 primed one session. `terms` counts what the session's own
    /// transcription will see; nothing was written to shared vocabulary.
    SeriesPrimed,
    PromptRecorded,
    PromptIgnored,
    AutoRecordStarted,
    AutoRecordStopped,
    AlreadyProcessed,
    Failed,
    Skipped,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct WorkflowOutcomeCounts {
    pub changes: u64,
    pub persons: u64,
    pub series: u64,
    pub carried: u64,
    pub candidates: u64,
    pub suggestions: u64,
    pub terms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkflowJumpTarget {
    Meeting { session_id: MeetingSessionId },
    Document { document_id: DocumentId },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct WorkflowRunReceipt {
    pub id: WorkflowRunId,
    pub workflow_id: WorkflowId,
    pub event_kind: WorkflowEventKind,
    pub jump_target: Option<WorkflowJumpTarget>,
    pub status: WorkflowRunStatus,
    pub started_at_utc_ms: i64,
    pub finished_at_utc_ms: i64,
    pub outcome_summary: String,
    pub outcome_code: WorkflowOutcomeCode,
    pub outcome_counts: WorkflowOutcomeCounts,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct WorkflowSummary {
    pub id: WorkflowId,
    pub enabled: bool,
    pub last_run: Option<WorkflowRunReceipt>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct WorkflowsListResult {
    pub schema_version: u32,
    pub revision: u64,
    pub entries: Vec<WorkflowSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct WorkflowSetEnabledRequest {
    pub workflow_id: WorkflowId,
    pub enabled: bool,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct WorkflowRunCursor {
    pub started_at_utc_ms: i64,
    pub run_id: WorkflowRunId,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct WorkflowRunsRequest {
    pub workflow_id: Option<WorkflowId>,
    pub cursor: Option<WorkflowRunCursor>,
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PaginatedWorkflowRuns {
    pub schema_version: u32,
    pub revision: u64,
    pub entries: Vec<WorkflowRunReceipt>,
    pub next_cursor: Option<WorkflowRunCursor>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowEventKind {
    MeetingFinalized,
    MeetingStarted,
    SpeakerRenamed,
    AudioImported,
    DocumentIngested,
    CalendarMeetingDetected,
    AgentHookEvent,
    MeetingPromptRecorded,
    MeetingPromptIgnored,
    MeetingAutoRecordStarted,
    MeetingAutoRecordStopped,
    /// The dictation history has runs the learning loops have not read yet.
    ///
    /// This is a wake-up, not data: it carries no transcript and its dedupe key
    /// is one local day, so a heavy dictation day produces one event and one
    /// bounded mining pass per loop rather than thousands.
    DictationCorpusSwept,
    /// A human corrected a dictation. Payload is the rewrite they performed;
    /// the dedupe key is that rewrite on that local day.
    DictationCorrectionRecorded,
}

impl WorkflowEventKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MeetingFinalized => "meeting_finalized",
            Self::MeetingStarted => "meeting_started",
            Self::SpeakerRenamed => "speaker_renamed",
            Self::AudioImported => "audio_imported",
            Self::DocumentIngested => "doc_ingested",
            Self::CalendarMeetingDetected => "calendar_meeting_detected",
            Self::AgentHookEvent => "agent_hook_event",
            Self::MeetingPromptRecorded => "meeting_prompt_recorded",
            Self::MeetingPromptIgnored => "meeting_prompt_ignored",
            Self::MeetingAutoRecordStarted => "meeting_auto_record_started",
            Self::MeetingAutoRecordStopped => "meeting_auto_record_stopped",
            Self::DictationCorpusSwept => "dictation_corpus_swept",
            Self::DictationCorrectionRecorded => "dictation_correction_recorded",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "meeting_finalized" => Some(Self::MeetingFinalized),
            "meeting_started" => Some(Self::MeetingStarted),
            "speaker_renamed" => Some(Self::SpeakerRenamed),
            "audio_imported" => Some(Self::AudioImported),
            "doc_ingested" => Some(Self::DocumentIngested),
            "calendar_meeting_detected" => Some(Self::CalendarMeetingDetected),
            "agent_hook_event" => Some(Self::AgentHookEvent),
            "meeting_prompt_recorded" => Some(Self::MeetingPromptRecorded),
            "meeting_prompt_ignored" => Some(Self::MeetingPromptIgnored),
            "meeting_auto_record_started" => Some(Self::MeetingAutoRecordStarted),
            "meeting_auto_record_stopped" => Some(Self::MeetingAutoRecordStopped),
            "dictation_corpus_swept" => Some(Self::DictationCorpusSwept),
            "dictation_correction_recorded" => Some(Self::DictationCorrectionRecorded),
            _ => None,
        }
    }

    /// Whether a failed run of this event is worth another attempt.
    ///
    /// Every other kind is raised again by its own next occurrence, so a
    /// failure costs one signal and the next one recovers. The daily corpus
    /// sweep has no next occurrence: every later dictation of the same local
    /// day collapses into the same dedupe key, so a single failure would
    /// otherwise silence all three of its loops until tomorrow. For that kind
    /// only a *successful* run is terminal, and the startup reconciliation scan
    /// is what tries again.
    pub const fn retries_after_failure(self) -> bool {
        matches!(self, Self::DictationCorpusSwept)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NewWorkflowEvent {
    pub kind: WorkflowEventKind,
    pub payload: serde_json::Value,
    pub occurred_at_utc_ms: i64,
    pub source: &'static str,
    pub dedupe_key: String,
}

#[derive(Clone, Debug)]
pub(crate) struct WorkflowDispatchResult {
    pub inserted: bool,
    pub event_id: WorkflowEventId,
    pub receipts: Vec<WorkflowRunReceipt>,
}
