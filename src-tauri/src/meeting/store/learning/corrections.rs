//! Loop 2: rewrites a human performed, often enough to be a habit.
//!
//! # Human-authored deltas only
//!
//! There are exactly two evidence sources, and both are a person editing text
//! they are looking at:
//!
//! * a meeting review segment edit — `meeting_segment_edits.replacement_text`
//!   against the immutable `base_text` it replaced;
//! * a dictation correction — the `spoken -> written` pair the history
//!   correction surface submits.
//!
//! A retry or a reprocess produces a *second machine reading* of audio a model
//! already read. The difference between two model outputs says something about
//! the models and nothing about the words the speaker meant, so it is never
//! vocabulary evidence. That exclusion is structural rather than filtered: this
//! miner does not read the dictation corpus at all, and neither source can
//! contain a model-versus-model diff. Retry lineage is loop 6's evidence, where
//! it means what it actually means.

use super::{
    insert_suggestions_in, known_vocabulary_keys, local_day, normalized, observation_totals_in,
    prune_observations_in, record_observation_in, LearningInputs, MinedCandidate,
    ObservationExample, MAX_OBSERVED_CANDIDATES_PER_RUN,
};
use crate::meeting::learning_types::{LearningLoopKind, LearningSuggestion};
use crate::meeting::store::StoreError;
use crate::meeting::types::MeetingSessionId;
use rusqlite::Connection;
use std::collections::HashSet;

/// How often a rewrite must recur before it is worth a sentence.
const MIN_OCCURRENCES: u64 = 3;
/// Across how many of the user's days.
const MIN_DISTINCT_DAYS: u64 = 2;
/// How many segment edits one pass reads from one finalized meeting. A review
/// pass on a long meeting can leave hundreds; the runner is holding a write
/// transaction, so the read is bounded like every other one here.
const MAX_MEETING_EDITS_PER_RUN: usize = 300;
/// The longest rewrite worth learning. A whole sentence someone reworded is
/// editing, not a word Sona keeps getting wrong.
const MAX_DELTA_TOKENS: usize = 3;

/// Records one human dictation correction and re-checks the floors.
pub(in crate::meeting::store) fn mine_dictation_correction_in(
    connection: &Connection,
    inputs: &dyn LearningInputs,
    spoken: &str,
    written: &str,
    occurred_at_utc_ms: i64,
    now_utc_ms: i64,
) -> Result<u64, StoreError> {
    if let Some(delta) = Delta::new(spoken, written) {
        record_observation_in(
            connection,
            LearningLoopKind::VocabularyCorrection,
            &delta.key,
            &local_day(occurred_at_utc_ms),
            1,
            0,
            &delta.display,
            None,
        )?;
    }
    evaluate_in(connection, inputs, now_utc_ms)
}

/// Reads one finalized meeting's human segment edits and re-checks the floors.
pub(in crate::meeting::store) fn mine_meeting_edits_in(
    connection: &Connection,
    inputs: &dyn LearningInputs,
    session_id: MeetingSessionId,
    now_utc_ms: i64,
) -> Result<u64, StoreError> {
    let mut statement = connection.prepare(
        "SELECT s.base_text, e.replacement_text, e.operator_at_utc_ms
           FROM meeting_transcript_revisions r
           JOIN meeting_transcript_segments s
             ON s.transcript_revision_id = r.transcript_revision_id
           JOIN meeting_segment_edits e ON e.segment_id = s.segment_id
            AND e.edit_sequence = (
                SELECT MAX(edit_sequence) FROM meeting_segment_edits
                 WHERE segment_id = s.segment_id
            )
          WHERE r.session_id = ?1 AND e.removed = 0
          ORDER BY e.operator_at_utc_ms, s.segment_id
          LIMIT ?2",
    )?;
    let edits = statement
        .query_map(
            rusqlite::params![
                session_id.uuid().to_string(),
                i64::try_from(MAX_MEETING_EDITS_PER_RUN).unwrap_or(i64::MAX)
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    let mut observed = HashSet::new();
    for (base_text, replacement_text, operator_at_utc_ms) in edits {
        for delta in deltas_between(&base_text, &replacement_text) {
            if observed.len() >= MAX_OBSERVED_CANDIDATES_PER_RUN && !observed.contains(&delta.key) {
                continue;
            }
            observed.insert(delta.key.clone());
            record_observation_in(
                connection,
                LearningLoopKind::VocabularyCorrection,
                &delta.key,
                &local_day(operator_at_utc_ms),
                1,
                0,
                &delta.display,
                Some(ObservationExample {
                    context: &example_context(&replacement_text),
                    // The excerpt is a slice of this meeting's transcript, so
                    // the row dies when the meeting does.
                    session_id: Some(session_id),
                }),
            )?;
        }
    }
    evaluate_in(connection, inputs, now_utc_ms)
}

/// Applies the floors and decision memory to everything the ledger holds.
fn evaluate_in(
    connection: &Connection,
    inputs: &dyn LearningInputs,
    now_utc_ms: i64,
) -> Result<u64, StoreError> {
    let loop_kind = LearningLoopKind::VocabularyCorrection;
    prune_observations_in(connection, now_utc_ms)?;
    // Accepting a term writes it into the user's vocabulary, so settings is the
    // only place that has to be asked whether a rewrite is already covered.
    let known = known_vocabulary_keys(inputs);

    let totals = observation_totals_in(connection, loop_kind)?;
    let mut candidates = totals
        .iter()
        .filter(|(_, total)| {
            total.occurrences >= MIN_OCCURRENCES && total.distinct_days >= MIN_DISTINCT_DAYS
        })
        .filter_map(|(key, total)| {
            let (spoken, written) = total.display_text.split_once(DISPLAY_SEPARATOR)?;
            let spoken_key = normalized(spoken);
            if spoken_key.is_empty() || known.contains(&spoken_key) {
                return None;
            }
            Some(MinedCandidate {
                key: key.clone(),
                suggestion: LearningSuggestion::VocabularyCorrection {
                    spoken: spoken.to_string(),
                    written: written.to_string(),
                },
                evidence: total.evidence(),
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .evidence
            .occurrences
            .cmp(&left.evidence.occurrences)
            .then_with(|| left.key.cmp(&right.key))
    });
    let added = insert_suggestions_in(connection, loop_kind, candidates, now_utc_ms)?;
    u64::try_from(added.len()).map_err(|_| StoreError::Corrupt)
}

/// How the display form packs the two halves of a rewrite. Chosen because it
/// survives [`normalized`] and cannot appear inside a normalized key.
const DISPLAY_SEPARATOR: &str = " \u{2192} ";
const KEY_SEPARATOR: &str = "->";

/// One human-authored rewrite, normalized into a candidate identity.
struct Delta {
    key: String,
    display: String,
}

impl Delta {
    fn new(spoken: &str, written: &str) -> Option<Self> {
        let spoken = spoken.trim();
        let written = written.trim();
        if spoken.is_empty() || written.is_empty() {
            return None;
        }
        if spoken.split_whitespace().count() > MAX_DELTA_TOKENS
            || written.split_whitespace().count() > MAX_DELTA_TOKENS
        {
            return None;
        }
        let spoken_key = normalized(spoken);
        let written_key = normalized(written);
        // A rewrite that changes nothing a matcher can see is not a correction.
        if spoken_key.is_empty() || written_key.is_empty() || spoken_key == written_key {
            return None;
        }
        Some(Self {
            key: format!("{spoken_key}{KEY_SEPARATOR}{written_key}"),
            display: format!("{spoken}{DISPLAY_SEPARATOR}{written}"),
        })
    }
}

/// The rewrites one segment edit performed.
///
/// Common leading and trailing tokens are dropped, so an edit that fixed one
/// word inside a long utterance yields that word rather than the utterance.
fn deltas_between(base: &str, replacement: &str) -> Vec<Delta> {
    let base: Vec<&str> = base.split_whitespace().collect();
    let replacement: Vec<&str> = replacement.split_whitespace().collect();
    let mut prefix = 0;
    while prefix < base.len()
        && prefix < replacement.len()
        && normalized(base[prefix]) == normalized(replacement[prefix])
    {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < base.len() - prefix
        && suffix < replacement.len() - prefix
        && normalized(base[base.len() - 1 - suffix])
            == normalized(replacement[replacement.len() - 1 - suffix])
    {
        suffix += 1;
    }
    let from = base[prefix..base.len() - suffix].join(" ");
    let to = replacement[prefix..replacement.len() - suffix].join(" ");
    Delta::new(&from, &to).into_iter().collect()
}

/// The corrected text, trimmed to card length. The reader wrote it, so it is the
/// most useful context there is.
fn example_context(text: &str) -> String {
    let text = text.trim();
    if text.chars().count() > 120 {
        return text.chars().take(117).collect::<String>() + "...";
    }
    text.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_one_word_fix_inside_a_long_utterance_yields_only_that_word() {
        let deltas = deltas_between(
            "we should ship the handy build on friday",
            "we should ship the Sona build on friday",
        );
        assert_eq!(deltas.len(), 1);
        assert_eq!(deltas[0].key, "handy->sona");
        assert_eq!(deltas[0].display, "handy \u{2192} Sona");
    }

    #[test]
    fn a_reworded_sentence_is_editing_not_a_vocabulary_habit() {
        let deltas = deltas_between(
            "we should ship the build on friday",
            "let us try to get this out before the weekend arrives",
        );
        assert!(deltas.is_empty(), "a whole-clause rewrite is not a term");
    }

    #[test]
    fn a_rewrite_the_matcher_cannot_see_is_not_a_correction() {
        assert!(Delta::new("Sona", "sona").is_none(), "case-only");
        assert!(Delta::new("Sona", "  Sona ").is_none(), "whitespace-only");
        assert!(Delta::new("", "Sona").is_none(), "empty spoken");
        assert!(Delta::new("Sona", "").is_none(), "empty written");
    }

    #[test]
    fn an_unchanged_edit_yields_nothing() {
        assert!(deltas_between("same text here", "same text here").is_empty());
    }
}
