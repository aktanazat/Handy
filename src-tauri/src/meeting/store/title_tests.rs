//! D19: titles from content.
//!
//! `derive_title_from_headline` shipped in wave 1 with no tests, which is the
//! wrong shape for a write that fires by itself after every generation. Three
//! things have to stay true, and each is a different way of being wrong:
//!
//! - A manual recording gets its name from what was said in it.
//! - A title somebody else already supplied — typed, or from a calendar
//!   event — is never overwritten. The failure here is silent and destructive:
//!   the app argues with its user and the user's own words are gone.
//! - "Local notes" survives a meeting with nothing in it, rather than the
//!   recording being renamed to the empty string.

use super::workflow_core_tests::{meeting, store};
use crate::meeting::types::{
    MeetingSessionId, OperationActor, OperationResult, MANUAL_DEFAULT_TITLE,
};
use rusqlite::params;

const NOW: i64 = 1_700_000_000_000;

fn title_of(store: &super::MeetingStore, session_id: MeetingSessionId) -> String {
    store
        .connection()
        .unwrap()
        .query_row(
            "SELECT title FROM meeting_sessions WHERE id = ?1",
            params![session_id.uuid().to_string()],
            |row| row.get(0),
        )
        .unwrap()
}

fn revision_of(store: &super::MeetingStore, session_id: MeetingSessionId) -> u64 {
    let value: i64 = store
        .connection()
        .unwrap()
        .query_row(
            "SELECT revision FROM meeting_sessions WHERE id = ?1",
            params![session_id.uuid().to_string()],
            |row| row.get(0),
        )
        .unwrap();
    u64::try_from(value).unwrap()
}

#[test]
fn a_manual_recording_is_renamed_from_its_headline() {
    let (_directory, store) = store();
    let session_id = meeting(&store, MANUAL_DEFAULT_TITLE, NOW);

    let receipt = store
        .derive_title_from_headline(
            session_id,
            "pricing stayed open and Dana took the comparison. Billing was settled.",
        )
        .unwrap()
        .expect("a headline with a sentence in it renames the recording");

    // The first sentence, sentence-cased, without its full stop. The second
    // sentence is not part of a title.
    assert_eq!(
        title_of(&store, session_id),
        "Pricing stayed open and Dana took the comparison"
    );
    // Nobody asked for this write, so the receipt says so, and it carries the
    // new name as its effect for a reader checking what changed.
    assert_eq!(receipt.actor, OperationActor::System);
    assert_eq!(receipt.result, OperationResult::Committed);
    assert_eq!(
        receipt.effect_ids,
        vec!["Pricing stayed open and Dana took the comparison".to_string()]
    );
    assert_eq!(receipt.new_revision, Some(revision_of(&store, session_id)));
}

#[test]
fn a_title_somebody_already_supplied_is_left_alone() {
    let (_directory, store) = store();
    // The two cases that are not the manual default: a name a person typed,
    // and a name a calendar event supplied. Neither is a placeholder, so the
    // derivation must treat them identically.
    for supplied in ["Q3 pricing", "Weekly sync (Dana / Amir)"] {
        let session_id = meeting(&store, supplied, NOW);
        let revision_before = revision_of(&store, session_id);

        let outcome = store
            .derive_title_from_headline(session_id, "Pricing stayed open.")
            .unwrap();

        assert!(outcome.is_none(), "{supplied} must not be renamed");
        assert_eq!(title_of(&store, session_id), supplied);
        // Not renaming must also not bump the meeting, or every generation
        // would move a revision nothing changed at.
        assert_eq!(revision_of(&store, session_id), revision_before);
    }
}

#[test]
fn local_notes_survives_a_headline_with_no_title_in_it() {
    let (_directory, store) = store();
    // What an empty transcript produces: a headline that is blank, or nothing
    // but the punctuation a sentence would have ended with.
    for headline in ["", "   ", "\n\t ", ".", "  ...  ", "?!"] {
        let session_id = meeting(&store, MANUAL_DEFAULT_TITLE, NOW);

        let outcome = store
            .derive_title_from_headline(session_id, headline)
            .unwrap();

        assert!(
            outcome.is_none(),
            "{headline:?} yields no title, so nothing is written"
        );
        assert_eq!(title_of(&store, session_id), MANUAL_DEFAULT_TITLE);
        assert_eq!(revision_of(&store, session_id), 0);
    }
}
