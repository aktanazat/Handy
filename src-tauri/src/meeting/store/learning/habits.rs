//! Loop 5: a mode the user keeps reaching for by shortcut.
//!
//! # What this loop was designed to suggest, and why it cannot
//!
//! The intended suggestion is *"always use mode M in application A"*, accepted
//! by writing the per-application activation rule that already exists. That
//! needs the frontmost application's identity on the run receipt, and it is not
//! there. [`crate::modes::ModeSelectionSource`] says so in as many words: *"The
//! receipt deliberately records the decision without copying a frontmost
//! application's identity."* The persisted [`crate::context::ContextReceipt`] is
//! content-free by the same design, holding per-source statuses and timestamps
//! but no application name or bundle id, and the internal
//! `ApplicationCapture` that does hold them is never written to history.
//!
//! Inventing that column would put an application's identity into permanent
//! local history that a deliberate privacy decision keeps out of it. So this
//! loop degrades to what the receipts honestly support: shortcut frequency. A
//! mode the user reaches for by explicit shortcut on most days, while a
//! different mode is the active one, is a habit worth formalising — and
//! accepting makes it the active mode.
//!
//! Two consequences follow and are not defects:
//!
//! * *Overrides count against the rule they overrode.* With no application
//!   identity there is no rule to count against: an `AppActivationRule` run
//!   names the mode it selected, never the rule that selected it. The clause has
//!   nothing to bind to and is left unimplemented rather than approximated.
//! * *Rule removal is out of scope*, as specified, and stays out: this loop
//!   writes one setting and never withdraws one.

use super::{
    advance_corpus_cursor_in, corpus_slice_in, insert_suggestions_in, local_day, normalized,
    observation_totals_in, prune_observations_in, record_observation_in, DictationCorpus,
    LearningInputs, MinedCandidate,
};
use crate::meeting::learning_types::{LearningLoopKind, LearningSuggestion};
use crate::meeting::store::StoreError;
use crate::modes::ModeSelectionSource;
use rusqlite::Connection;

/// How many explicit-shortcut runs of one mode make a habit.
const MIN_OCCURRENCES: u64 = 5;
/// Across how many of the user's days.
const MIN_DISTINCT_DAYS: u64 = 3;

pub(in crate::meeting::store) fn mine_mode_habits_in(
    connection: &Connection,
    inputs: &dyn LearningInputs,
    corpus: &DictationCorpus,
    now_utc_ms: i64,
) -> Result<u64, StoreError> {
    let loop_kind = LearningLoopKind::ModeHabit;
    let slice = corpus_slice_in(connection, loop_kind, corpus)?;
    for row in &slice {
        // A retry inherits the plan of the run it retried, so counting it would
        // count one human decision twice.
        if row.is_retry
            || row.mode.mode_selection_source != ModeSelectionSource::ExplicitModeShortcut
        {
            continue;
        }
        let mode_id = row.mode.mode_id.trim();
        if mode_id.is_empty() {
            continue;
        }
        record_observation_in(
            connection,
            loop_kind,
            &normalized(mode_id),
            &local_day(row.completed_at_ms),
            1,
            0,
            mode_id,
            None,
        )?;
    }
    if let Some(highest) = slice.last().map(|row| row.id) {
        advance_corpus_cursor_in(connection, loop_kind, highest)?;
    }
    prune_observations_in(connection, now_utc_ms)?;

    let active = inputs.active_mode_id();
    let totals = observation_totals_in(connection, loop_kind)?;
    let mut candidates = totals
        .iter()
        .filter(|(_, total)| {
            total.occurrences >= MIN_OCCURRENCES && total.distinct_days >= MIN_DISTINCT_DAYS
        })
        .filter_map(|(key, total)| {
            let mode_id = total.display_text.clone();
            // A mode that is already the default needs no suggestion, and a mode
            // that no longer exists cannot be made one.
            if active.as_deref() == Some(mode_id.as_str()) {
                return None;
            }
            let mode_name = inputs.mode_display_name(&mode_id)?;
            Some(MinedCandidate {
                key: key.clone(),
                suggestion: LearningSuggestion::ModeHabit { mode_id, mode_name },
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
