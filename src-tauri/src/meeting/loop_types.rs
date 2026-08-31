//! Loops that close: the mutable half of a ledger row.
//!
//! A ledger is re-read out of the transcript on every artifact regeneration,
//! so the words of a loop live in the artifact revision and only there. What a
//! person *did* about a loop — resolved it, dropped it, gave it an owner, let
//! it run into the next session of a series — cannot live there: it would be
//! thrown away the next time the model read the meeting again.
//!
//! So identity is derived from content rather than minted. Two extractions of
//! the same commitment in the same meeting produce the same
//! [`MeetingLoopId`], which is what lets a resolution survive a regeneration,
//! and what lets an agent name a loop in a `sona://` link without the store
//! having handed it a number first.

use super::ledger::LedgerFirmness;
use super::people_types::PersonId;
use super::types::{ArtifactCitation, MeetingSessionId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use uuid::Uuid;

/// How many hex characters of the content digest an id carries. Eight bytes:
/// wide enough that two different rows in one meeting colliding is not a thing
/// that happens, short enough that the whole id fits in a link.
const DIGEST_HEX_CHARS: usize = 16;

const HEX_DIGITS: &[u8; 16] = b"0123456789abcdef";

/// Which register of the ledger a row came out of. The two are separate id
/// namespaces because the same sentence can legitimately be both a commitment
/// and the question nobody answered.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MeetingLoopKind {
    /// An open loop: a question asked out loud that never got an answer, or a
    /// thread that did not land.
    Loop,
    /// A commitment: a named person said they would do something.
    Commitment,
}

impl MeetingLoopKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Loop => "loop",
            Self::Commitment => "commitment",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "loop" => Some(Self::Loop),
            "commitment" => Some(Self::Commitment),
            _ => None,
        }
    }
}

/// Where a loop stands. `Carried` is not a resolution and not an absence: the
/// same subject came up again in the next session of the series, so this
/// occurrence is closed and its successor is the live one.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MeetingLoopStatus {
    Open,
    Done,
    Dropped,
    Carried,
}

impl MeetingLoopStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Done => "done",
            Self::Dropped => "dropped",
            Self::Carried => "carried",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "open" => Some(Self::Open),
            "done" => Some(Self::Done),
            "dropped" => Some(Self::Dropped),
            "carried" => Some(Self::Carried),
            _ => None,
        }
    }

    /// Whether this row still needs somebody. The one predicate every brief,
    /// inbox and count reads, so "open" means the same thing in all of them.
    pub const fn is_open(self) -> bool {
        matches!(self, Self::Open)
    }
}

/// What a resolve mutation is allowed to write. Narrower than
/// [`MeetingLoopStatus`] on purpose: reopening is its own mutation, and only
/// the ledger pass may carry a loop forward.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MeetingLoopResolution {
    Done,
    Dropped,
}

impl MeetingLoopResolution {
    pub const fn status(self) -> MeetingLoopStatus {
        match self {
            Self::Done => MeetingLoopStatus::Done,
            Self::Dropped => MeetingLoopStatus::Dropped,
        }
    }
}

/// A loop's stable address: `<session uuid>:<kind>:<16 hex of the text>`.
///
/// The session uuid leads so a router can find the meeting without a lookup
/// table, and the digest trails so the id is stable across regenerations of the
/// same words.
#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Type)]
#[serde(transparent)]
pub struct MeetingLoopId(pub String);

impl MeetingLoopId {
    /// The id these words have in this meeting. Deterministic: the same
    /// session, register and text always produce the same id, which is the
    /// whole reason a resolution survives the next artifact pass.
    pub fn derive(session_id: MeetingSessionId, kind: MeetingLoopKind, text: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(normalized_loop_text(text).as_bytes());
        let digest = hasher.finalize();
        let mut value = String::with_capacity(36 + 1 + 10 + 1 + DIGEST_HEX_CHARS);
        value.push_str(&session_id.uuid().to_string());
        value.push(':');
        value.push_str(kind.as_str());
        value.push(':');
        for byte in digest.iter().take(DIGEST_HEX_CHARS / 2) {
            value.push(char::from(HEX_DIGITS[usize::from(byte >> 4)]));
            value.push(char::from(HEX_DIGITS[usize::from(byte & 0x0f)]));
        }
        Self(value)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The meeting this loop belongs to, read straight out of the id. `None`
    /// when the string did not come from [`Self::derive`].
    pub fn session_id(&self) -> Option<MeetingSessionId> {
        let uuid = self.0.split(':').next()?;
        Uuid::parse_str(uuid).ok().map(MeetingSessionId::from_uuid)
    }

    /// The half of the id that is not the meeting: `<kind>:<digest>`. Two
    /// occurrences of the same loop in different sessions of a series share
    /// this and nothing else, which is how one is matched to the next.
    pub fn content_key(&self) -> Option<&str> {
        self.0.split_once(':').map(|(_, rest)| rest)
    }
}

/// The text an id is derived from: whitespace collapsed, case folded. Matches
/// the store's own `normalized`, so a loop carried into the next session
/// matches the same way people do.
fn normalized_loop_text(value: &str) -> String {
    value
        .split_whitespace()
        .flat_map(str::chars)
        .flat_map(char::to_lowercase)
        .collect()
}

/// One actionable ledger row: the words from the artifact, the state from the
/// store.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingLoopRow {
    pub loop_id: MeetingLoopId,
    pub session_id: MeetingSessionId,
    pub kind: MeetingLoopKind,
    /// The question, or what was promised.
    pub text: String,
    /// Who the ledger read the row as belonging to, verbatim from the
    /// transcript. Kept beside `owner_person_id` because a name the model read
    /// and a person the user picked are different claims.
    pub owner_text: Option<String>,
    pub owner_person_id: Option<PersonId>,
    pub owner_display_name: Option<String>,
    pub status: MeetingLoopStatus,
    pub resolved_at_utc_ms: Option<i64>,
    /// The operation that put this row in its current state, so a caller can
    /// look the receipt back up.
    pub resolving_operation_id: Option<String>,
    /// The successor this loop ran into, when it was carried forward.
    pub carried_into_loop_id: Option<MeetingLoopId>,
    /// The occurrence this loop was first raised at, when it is itself a
    /// successor.
    pub carried_since_at_utc_ms: Option<i64>,
    /// Offset into the meeting the row was read at, for the transcript jump.
    pub at_ms: u64,
    pub revision: u64,
    /// What happened instead of an answer, for a question that never got one.
    pub instead: Option<String>,
    /// How firmly a commitment was made. Absent for loops.
    pub firmness: Option<LedgerFirmness>,
    /// The transcript quote the row was read from. Questions that were never
    /// answered are cited but not quoted, so this is absent for them.
    pub quote: Option<String>,
    pub speaker: Option<String>,
    pub citations: Vec<ArtifactCitation>,
}

impl MeetingLoopRow {
    pub const fn is_open(&self) -> bool {
        self.status.is_open()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingLoopsResult {
    pub schema_version: u32,
    /// The session revision the rows were read at.
    pub revision: u64,
    pub rows: Vec<MeetingLoopRow>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingLoopResolveRequest {
    pub operation_id: super::types::MeetingOperationId,
    pub loop_id: MeetingLoopId,
    pub expected_revision: u64,
    pub resolution: MeetingLoopResolution,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingLoopReopenRequest {
    pub operation_id: super::types::MeetingOperationId,
    pub loop_id: MeetingLoopId,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingLoopAssignRequest {
    pub operation_id: super::types::MeetingOperationId,
    pub loop_id: MeetingLoopId,
    pub expected_revision: u64,
    /// `None` clears the owner.
    pub owner_person_id: Option<PersonId>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingLoopMutationResult {
    pub receipt: super::types::OperationReceipt,
    /// Every loop in the meeting, re-read after the write, so a caller never
    /// has to guess what its own mutation did to the rest of the list.
    pub loops: MeetingLoopsResult,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_words_in_the_same_meeting_get_the_same_id() {
        let session_id = MeetingSessionId::new();
        let first = MeetingLoopId::derive(
            session_id,
            MeetingLoopKind::Commitment,
            "Send the tier comparison",
        );
        let regenerated = MeetingLoopId::derive(
            session_id,
            MeetingLoopKind::Commitment,
            "  send   the Tier   comparison\n",
        );

        assert_eq!(first, regenerated, "a regeneration must not move an id");
    }

    #[test]
    fn kind_and_session_are_separate_namespaces() {
        let session_id = MeetingSessionId::new();
        let text = "Which tier does the trial convert into?";
        let as_loop = MeetingLoopId::derive(session_id, MeetingLoopKind::Loop, text);
        let as_commitment = MeetingLoopId::derive(session_id, MeetingLoopKind::Commitment, text);
        let elsewhere = MeetingLoopId::derive(MeetingSessionId::new(), MeetingLoopKind::Loop, text);

        assert_ne!(as_loop, as_commitment);
        assert_ne!(as_loop, elsewhere);
    }

    #[test]
    fn an_id_routes_to_its_meeting_without_a_lookup() {
        let session_id = MeetingSessionId::new();
        let loop_id = MeetingLoopId::derive(session_id, MeetingLoopKind::Loop, "Pricing");

        assert_eq!(loop_id.session_id(), Some(session_id));
        assert_eq!(MeetingLoopId("not-an-id".to_string()).session_id(), None);
    }
}
