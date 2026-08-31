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
}

impl WorkflowId {
    pub const ALL: [Self; 5] = [
        Self::PersonLinking,
        Self::PreMeetingBriefing,
        Self::Continuity,
        Self::VocabularyMining,
        Self::DocumentLinking,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PersonLinking => "person_linking",
            Self::PreMeetingBriefing => "pre_meeting_briefing",
            Self::Continuity => "continuity",
            Self::VocabularyMining => "vocabulary_mining",
            Self::DocumentLinking => "document_linking",
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
            _ => None,
        }
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
