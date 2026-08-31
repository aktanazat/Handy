//! The wire and storage vocabulary of the local learning loops.
//!
//! Every loop follows the same shape: a signal reaches the workflow runner, a
//! miner reads a bounded slice of local evidence inside the runner's
//! transaction, and whatever clears that loop's floors becomes a *suggestion* —
//! a sentence a person reads and answers. Nothing here is ever applied on its
//! own.
//!
//! Two identities matter and are deliberately separate:
//!
//! * [`LearningLoopKind`] plus a normalized candidate key is the decision
//!   identity. It is what "never suggest this again" is keyed on, and it
//!   outlives the suggestion it came from.
//! * [`LearningSuggestion`] is the human-facing content. It is rebuilt from
//!   stored evidence on every read, so a renamed mode or a rule the user has
//!   since written cannot leave a stale sentence on screen.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Which loop a candidate belongs to.
///
/// The two vocabulary kinds are separate because their candidate identities are
/// different things: a term is a phrase Sona keeps hearing, a correction is a
/// rewrite a human performed. Collapsing them would make one dismissal silence
/// the other.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LearningLoopKind {
    /// Loop 1. A spoken symbol phrase that no replacement rule covers yet.
    SpokenPunctuation,
    /// Loop 2's sibling: a repeated term mined from meeting transcripts. The
    /// candidates themselves are computed live; only decisions are stored.
    VocabularyTerm,
    /// Loop 2. A rewrite a human performed, seen often enough to be a habit.
    VocabularyCorrection,
    /// Loop 5. A mode the user keeps reaching for by shortcut.
    ModeHabit,
    /// Loop 6. A capture-quality statistic worth telling the user about.
    CaptureAdvice,
}

impl LearningLoopKind {
    pub const ALL: [Self; 5] = [
        Self::SpokenPunctuation,
        Self::VocabularyTerm,
        Self::VocabularyCorrection,
        Self::ModeHabit,
        Self::CaptureAdvice,
    ];

    /// The loops that keep a corpus cursor. `VocabularyTerm` is absent because
    /// its corpus is the meeting store's own transcripts, which it rescans.
    pub const CURSORED: [Self; 3] = [
        Self::SpokenPunctuation,
        Self::ModeHabit,
        Self::CaptureAdvice,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SpokenPunctuation => "spoken_punctuation",
            Self::VocabularyTerm => "vocabulary_term",
            Self::VocabularyCorrection => "vocabulary_correction",
            Self::ModeHabit => "mode_habit",
            Self::CaptureAdvice => "capture_advice",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }
}

/// What a human answered. There is no third state: a candidate is pending
/// because no row exists for it, not because a row says so.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LearningDecisionStatus {
    Accepted,
    Dismissed,
}

impl LearningDecisionStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Dismissed => "dismissed",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "accepted" => Some(Self::Accepted),
            "dismissed" => Some(Self::Dismissed),
            _ => None,
        }
    }
}

/// Which capture statistic an advice row is about.
///
/// Each one is keyed on the identity the receipts actually carry. Receipts hold
/// no input-device provenance, so none of these can be attributed to a
/// microphone; `subject` names the transcription route instead, and the copy
/// says so.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CaptureAdviceKind {
    /// This route's runs get retried far more often than the others.
    RetryRate,
    /// This route's captures end truncated or silent far more often.
    LostCaptureRate,
    /// Measured input amplitude is low across most captures.
    InputLevel,
}

impl CaptureAdviceKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::RetryRate => "retry_rate",
            Self::LostCaptureRate => "lost_capture_rate",
            Self::InputLevel => "input_level",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "retry_rate" => Some(Self::RetryRate),
            "lost_capture_rate" => Some(Self::LostCaptureRate),
            "input_level" => Some(Self::InputLevel),
            _ => None,
        }
    }
}

/// Why a suggestion exists, counted from the corpus that produced it.
///
/// `examples` are verbatim local contexts, capped at
/// [`MAX_SUGGESTION_EXAMPLES`]. They are the difference between "trust me" and
/// a claim the reader can check, and they never leave this machine.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct LearningEvidence {
    pub occurrences: u64,
    pub distinct_days: u64,
    pub examples: Vec<String>,
}

/// How many mined contexts a card carries. Two or three is enough for a reader
/// to recognise their own dictation; more is a wall of text.
pub const MAX_SUGGESTION_EXAMPLES: usize = 3;

/// One suggestion's content, rebuilt on read from stored evidence.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LearningSuggestion {
    /// Loop 1. Accepting writes the replacement rule `spoken` -> `written`.
    SpokenPunctuation { spoken: String, written: String },
    /// Loop 2. Accepting writes the vocabulary pair `spoken` -> `written`.
    VocabularyCorrection { spoken: String, written: String },
    /// Loop 5. Accepting makes `mode_id` the active mode.
    ModeHabit { mode_id: String, mode_name: String },
    /// Loop 6. Nothing to accept: an observation is either useful or dismissed.
    CaptureAdvice {
        advice: CaptureAdviceKind,
        subject: String,
        /// The measured statistic, in parts per thousand. For the two rate
        /// advices this is the ratio against the rest of the corpus (2000 =
        /// twice as often); for `InputLevel` it is the share of measured
        /// captures that came in quiet.
        stat_permille: u32,
        sample_runs: u64,
    },
}

impl LearningSuggestion {
    /// Whether this suggestion has an accept action at all. Advice is an
    /// observation: a reader can only take it or stop seeing it.
    pub const fn is_acceptable(&self) -> bool {
        !matches!(self, Self::CaptureAdvice { .. })
    }

    pub const fn loop_kind(&self) -> LearningLoopKind {
        match self {
            Self::SpokenPunctuation { .. } => LearningLoopKind::SpokenPunctuation,
            Self::VocabularyCorrection { .. } => LearningLoopKind::VocabularyCorrection,
            Self::ModeHabit { .. } => LearningLoopKind::ModeHabit,
            Self::CaptureAdvice { .. } => LearningLoopKind::CaptureAdvice,
        }
    }
}

/// One pending suggestion as the feed reads it.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct LearningSuggestionEntry {
    pub loop_kind: LearningLoopKind,
    /// The normalized candidate identity. The feed sends this back verbatim
    /// when the reader answers, so the answer lands on the same candidate the
    /// miner generated even if the copy around it has changed.
    pub candidate_key: String,
    pub suggestion: LearningSuggestion,
    pub evidence: LearningEvidence,
    pub generated_at_utc_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct LearningSuggestionsResult {
    pub schema_version: u32,
    pub revision: u64,
    pub entries: Vec<LearningSuggestionEntry>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct LearningDecisionRequest {
    pub loop_kind: LearningLoopKind,
    pub candidate_key: String,
    pub status: LearningDecisionStatus,
    /// Human-facing text to remember alongside the decision. The candidate key
    /// is normalized and cannot be shown back to anyone, and loop 4 primes a
    /// session with the words a user actually accepted, so the display form has
    /// to survive the decision.
    pub display_text: String,
}

/// The session-scoped priming blob loop 4 assembles for a meeting in a series
/// the user has given standing consent to.
///
/// It is not vocabulary and never becomes vocabulary: it is copied onto one
/// session, read by that session's transcription run, and deleted with it.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct SeriesPrimingBlob {
    /// Terms the user accepted in a learning loop, in the form they accepted.
    pub terms: Vec<String>,
    /// Display names of people confirmed on earlier meetings in this series.
    pub participants: Vec<String>,
}

impl SeriesPrimingBlob {
    pub(crate) fn is_empty(&self) -> bool {
        self.terms.is_empty() && self.participants.is_empty()
    }
}
