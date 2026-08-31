use super::document_types::{DocumentId, DocumentSummary};
use super::loop_types::{MeetingLoopDirection, MeetingLoopId, MeetingLoopStatus};
use super::types::MeetingSessionId;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, Type)]
#[serde(transparent)]
pub struct PersonId(pub Uuid);

impl PersonId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub const fn uuid(self) -> Uuid {
        self.0
    }
}

impl Default for PersonId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PersonLinkSource {
    Calendar,
    Speaker,
    Title,
    Manual,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PersonLinkConfidence {
    Confirmed,
    Suggested,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct Person {
    pub id: PersonId,
    pub display_name: String,
    pub aliases: Vec<String>,
    pub calendar_emails: Vec<String>,
    pub created_at_utc_ms: i64,
    pub updated_at_utc_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonMeetingSummary {
    pub id: MeetingSessionId,
    pub title: String,
    pub at_utc_ms: i64,
    pub headline: Option<String>,
    pub series_number: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonMeetingLink {
    pub meeting: PersonMeetingSummary,
    pub source: PersonLinkSource,
    pub confidence: PersonLinkConfidence,
}

/// A loop raised in a meeting with this person, as the people surfaces read it.
///
/// The words come from the meeting's ledger; `loop_id` and `status` come from
/// the loop state row that ledger row is keyed to, so a resolution made on the
/// review screen shows up here without a second copy of the state.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonOpenLoop {
    pub loop_id: MeetingLoopId,
    pub meeting_id: MeetingSessionId,
    pub title: String,
    pub at_utc_ms: i64,
    pub text: String,
    pub owner_person_id: Option<PersonId>,
    pub status: MeetingLoopStatus,
    /// Which side of the conversation this row is on: the user owes it, or
    /// this person does. What lets a page show two lists instead of one.
    pub direction: MeetingLoopDirection,
    /// This person has owed it for longer than a working week. Computed
    /// against the store's clock at read time, so it is never a cached
    /// yesterday.
    pub waiting_on_stale: bool,
    /// When this loop was first raised, if it reached this meeting by being
    /// carried forward from an earlier session in the series.
    pub carried_since_at_utc_ms: Option<i64>,
    /// The meeting this loop was carried into, if it has already moved on.
    pub carried_into_meeting_id: Option<MeetingSessionId>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonCommitment {
    pub loop_id: MeetingLoopId,
    pub meeting_id: MeetingSessionId,
    pub title: String,
    pub at_utc_ms: i64,
    pub text: String,
    pub status: MeetingLoopStatus,
    /// See [`PersonOpenLoop::direction`].
    pub direction: MeetingLoopDirection,
    /// See [`PersonOpenLoop::waiting_on_stale`].
    pub waiting_on_stale: bool,
    pub resolved_at_utc_ms: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PersonMeetingHeadline {
    Ledger { text: String },
    Summary { text: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonListLastMeeting {
    pub session_id: MeetingSessionId,
    pub title: String,
    pub at_ms: i64,
    pub headline: Option<PersonMeetingHeadline>,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonListEntry {
    pub person: Person,
    pub meetings_count: u64,
    pub last_meeting_at_utc_ms: Option<i64>,
    pub suggested_count: u64,
    pub evidence_sources: Vec<PersonLinkSource>,
    pub confirmed_count: u64,
    pub last_meeting: Option<PersonListLastMeeting>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PeopleListResult {
    pub schema_version: u32,
    pub revision: u64,
    pub entries: Vec<PersonListEntry>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonDetail {
    pub person: Person,
    pub links: Vec<PersonMeetingLink>,
    pub open_loops: Vec<PersonOpenLoop>,
    pub commitments: Vec<PersonCommitment>,
    pub talk_share_avg_permille: Option<u32>,
    pub documents: Vec<DocumentSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonDetailResult {
    pub schema_version: u32,
    pub revision: u64,
    pub detail: PersonDetail,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonBriefingLastMeeting {
    pub id: MeetingSessionId,
    pub title: String,
    pub at_utc_ms: i64,
    pub headline: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonBriefingRow {
    pub person_id: PersonId,
    pub display_name: String,
    pub meetings_count: u64,
    pub last: Option<PersonBriefingLastMeeting>,
    pub open_loops: Vec<PersonOpenLoop>,
    pub commitments: Vec<PersonCommitment>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonContextResult {
    pub schema_version: u32,
    pub revision: u64,
    pub rows: Vec<PersonBriefingRow>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingPersonContextRow {
    pub person_id: PersonId,
    pub display_name: String,
    pub evidence_source: PersonLinkSource,
    pub meetings_together: u64,
    pub last_prior_meeting: Option<PersonBriefingLastMeeting>,
    pub top_open_loop: Option<PersonOpenLoop>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingPeopleContextResult {
    pub schema_version: u32,
    pub revision: u64,
    pub rows: Vec<MeetingPersonContextRow>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct OpenLoopsInboxResult {
    pub schema_version: u32,
    pub revision: u64,
    pub entries: Vec<PersonOpenLoop>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct VocabularyCandidate {
    pub text: String,
    pub occurrences: u64,
    pub meetings_count: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct VocabularyCandidatesResult {
    pub schema_version: u32,
    pub revision: u64,
    pub entries: Vec<VocabularyCandidate>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonRenameRequest {
    pub person_id: PersonId,
    pub display_name: String,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonMergeRequest {
    pub source_person_id: PersonId,
    pub target_person_id: PersonId,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonDeleteRequest {
    pub person_id: PersonId,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonLinkRequest {
    pub meeting_id: MeetingSessionId,
    pub person_id: PersonId,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PersonSplitTarget {
    Create { display_name: String },
    Existing { person_id: PersonId },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PersonSplitRequest {
    pub source_person_id: PersonId,
    pub target: PersonSplitTarget,
    pub meeting_ids: Vec<MeetingSessionId>,
    pub aliases: Vec<String>,
    pub calendar_emails: Vec<String>,
    pub document_ids: Vec<DocumentId>,
    pub expected_revision: u64,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct PeopleMutationResult {
    pub schema_version: u32,
    pub revision: u64,
    pub person: Option<Person>,
    pub removed: bool,
}
