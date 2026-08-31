//! The read-only external plane over a corpus that holds one of every noun.
//!
//! `crate::query::external::tests` owns the half that needs no store: which
//! request a command line names, which flag combinations are refused, and the
//! refusal an agent gets when external access is off. What needs a corpus is
//! everything here — that each verb reads what it claims to, and that the JSON
//! an outside reader receives has the fields the module documents and no
//! others. So the assertions are whole-value comparisons rather than field
//! spot-checks: a projection that quietly grows a field is a wire change, and
//! this is the test that says so.
//!
//! The fixture is built the way the app builds it. A typed note is what puts a
//! meeting in the search index and what mints its receipt; the continuity
//! workflow is what makes its ledger rows reachable corpus-wide; and the one
//! `done` row got there through the same `resolve_loop` the review screen
//! calls, rather than a hand-written state row claiming to be the result.

use super::workflow_core_tests::{event, inputs, person, store};
use super::MeetingStore;
use crate::meeting::loop_types::{
    MeetingLoopId, MeetingLoopKind, MeetingLoopResolution, MeetingLoopResolveRequest,
};
use crate::meeting::people_types::PersonId;
use crate::meeting::types::{
    ManualNote, ManualNoteId, MeetingOperationId, MeetingSessionId, SourceKind, SpeakerId,
};
use crate::meeting::workflow_types::WorkflowEventKind;
use crate::query::external::{
    loops_page, meeting_detail, meetings_page, people_page, transcript as transcript_of,
    ExternalErrorCode, ExternalLoopSide, ExternalLoopStatus, ExternalResponse,
};
use crate::query::{QueryEventsPage, QuerySearchPage, QUERY_SCHEMA_VERSION};
use rusqlite::params;
use serde_json::json;
use std::sync::Arc;
use tempfile::TempDir;
use uuid::Uuid;

const NOW: i64 = 1_700_000_000_000;
const EARLIER: i64 = NOW - 3 * 24 * 60 * 60 * 1_000;

const TITLE: &str = "Pricing review";
const OLDER_TITLE: &str = "Retro";
const SEGMENT: &str = "Dana asked which tier the trial converts into.";
const NOTE: &str = "Dana still owes the tier comparison.";
const SUMMARY: &str = "Pricing stayed open.";
const HEADLINE: &str = "Dana's tier question stayed open.";
const THREAD: &str = "Dana's trial conversion tier";
const COMMITMENT: &str = "Send the tier comparison";
/// The display name the transcript fixture gives this machine's microphone
/// speaker. A ledger row it owns is one the user owes.
const ME: &str = "Speaker 1";

struct Corpus {
    _directory: TempDir,
    store: Arc<MeetingStore>,
    session_id: MeetingSessionId,
    older_id: MeetingSessionId,
    person_id: PersonId,
    /// The thread Dana still owes: open, and waiting on somebody else.
    open_loop: MeetingLoopId,
    /// The commitment the user made and then ticked off.
    done_commitment: MeetingLoopId,
    /// When `resolve_loop` wrote that tick. The store clocks its own writes,
    /// so the fixture reads the number back rather than claiming one.
    resolved_at_utc_ms: i64,
}

fn corpus() -> Corpus {
    let (directory, store) = store();
    let session_id = meeting(&store, TITLE, NOW);
    transcript(&store, session_id, SEGMENT);
    // Before the artifact, deliberately: a note marks the current artifact out
    // of date, and a ledger nobody can read is a ledger with no loops.
    note(&store, session_id);
    artifact(&store, session_id);
    finalize(&store, session_id);
    // A second meeting with nothing in it, so the list has a row whose one
    // line is genuinely absent and a window has something to exclude.
    let older_id = meeting(&store, OLDER_TITLE, EARLIER);
    let person_id = person(&store, "Dana Reyes", &["Dana"], &["dana@example.com"]);

    let open_loop = MeetingLoopId::derive(session_id, MeetingLoopKind::Loop, THREAD);
    let done_commitment =
        MeetingLoopId::derive(session_id, MeetingLoopKind::Commitment, COMMITMENT);
    let resolved = store
        .resolve_loop(
            MeetingLoopResolveRequest {
                operation_id: MeetingOperationId::new(),
                loop_id: done_commitment.clone(),
                expected_revision: 0,
                resolution: MeetingLoopResolution::Done,
            },
            NOW,
        )
        .unwrap();
    let resolved_at_utc_ms = resolved
        .loops
        .rows
        .iter()
        .find(|row| row.loop_id == done_commitment)
        .and_then(|row| row.resolved_at_utc_ms)
        .expect("the commitment is ticked off");

    Corpus {
        _directory: directory,
        store,
        session_id,
        older_id,
        person_id,
        open_loop,
        done_commitment,
        resolved_at_utc_ms,
    }
}

/// One review-ready meeting the app could have written.
///
/// Local to this file rather than borrowed from `workflow_core_tests`: that
/// fixture's sessions carry column values the loops and people reads never
/// decode (`processing_status = 'pending'`, `health = 'healthy'`), and every
/// verb here goes through `list_sessions` or `review_snapshot`, which do.
fn meeting(store: &MeetingStore, title: &str, at_utc_ms: i64) -> MeetingSessionId {
    let session_id = MeetingSessionId::new();
    let plan_id = Uuid::new_v4();
    let connection = store.connection().unwrap();
    connection
        .execute(
            "INSERT INTO meeting_sessions (
                id, phase, revision, title, origin_kind, preflight_json,
                created_at_utc_ms, started_at_utc_ms, processing_status,
                retention_policy_json
             ) VALUES (?1, 'review_ready', 0, ?2, 'manual', '{}', ?3, ?3,
                       '{\"kind\":\"succeeded\"}', '{\"kind\":\"keep_forever\"}')",
            params![session_id.uuid().to_string(), title, at_utc_ms],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO meeting_run_plans (
                plan_id, session_id, attempt_number, schema_version, consent_id,
                canonical_plan_json, created_at_utc_ms
             ) VALUES (?1, ?2, 1, 1, ?3, '{}', ?4)",
            params![
                plan_id.to_string(),
                session_id.uuid().to_string(),
                Uuid::new_v4().to_string(),
                at_utc_ms
            ],
        )
        .unwrap();
    for source_kind in [SourceKind::Microphone, SourceKind::SystemAudio] {
        connection
            .execute(
                "INSERT INTO meeting_source_tracks (
                    track_id, session_id, plan_id, source_kind, required, requested,
                    descriptor_json, timestamp_bridge_json, health
                 ) VALUES (?1, ?2, ?3, ?4, 1, 1, '{}', '{}', '\"healthy\"')",
                params![
                    Uuid::new_v4().to_string(),
                    session_id.uuid().to_string(),
                    plan_id.to_string(),
                    source_kind.as_str()
                ],
            )
            .unwrap();
    }
    session_id
}

/// One thing somebody said, on this machine's own microphone.
fn transcript(store: &MeetingStore, session_id: MeetingSessionId, text: &str) {
    let speaker_id = SpeakerId::new();
    let revision_id = Uuid::new_v4();
    let connection = store.connection().unwrap();
    let track_id: String = connection
        .query_row(
            "SELECT track_id FROM meeting_source_tracks
              WHERE session_id = ?1 AND source_kind = 'microphone'",
            params![session_id.uuid().to_string()],
            |row| row.get(0),
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO meeting_speakers (
                speaker_id, session_id, source_kind, display_name, revision
             ) VALUES (?1, ?2, 'microphone', ?3, 0)",
            params![
                speaker_id.uuid().to_string(),
                session_id.uuid().to_string(),
                ME
            ],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO meeting_transcript_revisions (
                transcript_revision_id, session_id, engine_id, destination_json,
                source_set_json, language, state, created_at_utc_ms
             ) VALUES (?1, ?2, 'test', '{}', '[]', 'en', 'complete', 1)",
            params![revision_id.to_string(), session_id.uuid().to_string()],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO meeting_transcript_segments (
                segment_id, transcript_revision_id, track_id, ordinal,
                start_offset_ns, end_offset_ns, speaker_id, base_text
             ) VALUES (?1, ?2, ?3, 0, 0, 1500000000, ?4, ?5)",
            params![
                Uuid::new_v4().to_string(),
                revision_id.to_string(),
                track_id,
                speaker_id.uuid().to_string(),
                text
            ],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE meeting_sessions SET current_transcript_revision_id = ?1 WHERE id = ?2",
            params![revision_id.to_string(), session_id.uuid().to_string()],
        )
        .unwrap();
}

/// A note the reader typed, through the mutation that rebuilds the search
/// documents and records the receipt.
fn note(store: &MeetingStore, session_id: MeetingSessionId) {
    store
        .create_note(
            MeetingOperationId::new(),
            NOW,
            &ManualNote {
                note_id: ManualNoteId::new(),
                session_id,
                start_offset_ns: None,
                end_offset_ns: None,
                body: NOTE.to_string(),
                revision: 0,
                created_at_utc_ms: NOW,
                updated_at_utc_ms: NOW,
            },
            0,
        )
        .unwrap();
}

/// The current artifact revision: one thread nobody answered, and one thing
/// the user promised.
fn artifact(store: &MeetingStore, session_id: MeetingSessionId) {
    let content = json!({
        "summary": {"text": SUMMARY, "citations": []},
        "outline": [],
        "decisions": [],
        "action_items": [],
        "key_questions": [],
        "risks": [],
        "follow_up_draft": {"text": "", "citations": []},
        "ledger": {
            "headline": HEADLINE,
            "threads": [{
                "topic": THREAD,
                "state": "open",
                "substantive": true,
                "receipt": {
                    "quote": "which tier does the trial convert into",
                    "speaker": "Dana",
                    "t_ms": 12000,
                    "citations": []
                },
                "owner": "Dana Reyes"
            }],
            "open_loops": [],
            "commitments": [{
                "who": ME,
                "what": COMMITMENT,
                "firmness": "firm",
                "receipt": {
                    "quote": "I'll send the tier comparison tonight",
                    "speaker": ME,
                    "t_ms": 20000,
                    "citations": []
                }
            }],
            "stances": [],
            "caveats": [],
            "receipts": {"status": "verified"}
        }
    });
    let artifact_id = Uuid::new_v4();
    let connection = store.connection().unwrap();
    let transcript_revision_id: String = connection
        .query_row(
            "SELECT current_transcript_revision_id FROM meeting_sessions WHERE id = ?1",
            params![session_id.uuid().to_string()],
            |row| row.get(0),
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO meeting_artifact_revisions (
                artifact_id, session_id, transcript_revision_id, input_revision,
                template_id, template_version, generation_key, state,
                content_json, generated_at_utc_ms
             ) VALUES (?1, ?2, ?3, 0, 'test', 1, ?4, 'current', ?5, ?6)",
            params![
                artifact_id.to_string(),
                session_id.uuid().to_string(),
                transcript_revision_id,
                format!("test-{artifact_id}"),
                content.to_string(),
                NOW
            ],
        )
        .unwrap();
}

/// The continuity run. A meeting's ledger rows are only reachable corpus-wide
/// once the workflow that reads them has succeeded for it.
fn finalize(store: &MeetingStore, session_id: MeetingSessionId) {
    store
        .record_and_run_workflow_event(
            event(
                WorkflowEventKind::MeetingFinalized,
                json!({
                    "session_id": session_id.uuid().to_string(),
                    "known_vocabulary": []
                }),
                "external-plane-finalized",
            ),
            &inputs(),
        )
        .unwrap();
}

fn value<T: serde::Serialize>(payload: &T) -> serde_json::Value {
    serde_json::to_value(payload).unwrap()
}

#[test]
fn the_meetings_list_is_newest_first_and_says_what_each_one_left() {
    let corpus = corpus();

    let page = meetings_page(&corpus.store, None, None, 25).unwrap();

    assert_eq!(
        value(&page),
        json!({
            "schema_version": QUERY_SCHEMA_VERSION,
            "has_more": false,
            "entries": [
                {
                    "id": corpus.session_id.uuid(),
                    "title": TITLE,
                    "phase": "review_ready",
                    "when_utc_ms": NOW,
                    "recorded_duration_ms": null,
                    "speakers": [ME],
                    "headline": {"kind": "ledger", "text": HEADLINE},
                    "link": format!("sona://meeting/{}", corpus.session_id.uuid()),
                },
                {
                    "id": corpus.older_id.uuid(),
                    "title": OLDER_TITLE,
                    "phase": "review_ready",
                    "when_utc_ms": EARLIER,
                    "recorded_duration_ms": null,
                    "speakers": [],
                    // Nothing was said and nothing was written, so the row says
                    // so rather than inventing a line.
                    "headline": {"kind": "none"},
                    "link": format!("sona://meeting/{}", corpus.older_id.uuid()),
                },
            ],
        })
    );
}

#[test]
fn a_bounded_list_says_there_is_more() {
    let corpus = corpus();

    let page = meetings_page(&corpus.store, None, None, 1).unwrap();

    assert_eq!(
        page.entries
            .iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>(),
        [corpus.session_id.uuid()]
    );
    assert!(page.has_more);
}

/// `--from`/`--to` is one window: the store's cursor is its upper bound, and
/// the lower bound cuts the tail of a newest-first page.
#[test]
fn a_window_keeps_only_the_meetings_inside_it() {
    let corpus = corpus();

    let recent = meetings_page(&corpus.store, Some(NOW - 1_000), None, 25).unwrap();
    let old = meetings_page(&corpus.store, None, Some(NOW), 25).unwrap();
    let empty = meetings_page(&corpus.store, Some(NOW + 1), None, 25).unwrap();

    assert_eq!(
        recent
            .entries
            .iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>(),
        [corpus.session_id.uuid()],
        "a lower bound drops what is older than it"
    );
    assert_eq!(
        old.entries.iter().map(|entry| entry.id).collect::<Vec<_>>(),
        [corpus.older_id.uuid()],
        "the upper bound is exclusive, so the meeting at that instant is out"
    );
    assert!(empty.entries.is_empty());
    assert!(!empty.has_more, "an empty window has no next page");
}

#[test]
fn one_meeting_comes_back_with_its_summary_and_every_row_it_left() {
    let corpus = corpus();

    let detail = meeting_detail(&corpus.store, corpus.session_id).unwrap();

    assert_eq!(
        value(&detail),
        json!({
            "schema_version": QUERY_SCHEMA_VERSION,
            "id": corpus.session_id.uuid(),
            "title": TITLE,
            "phase": "review_ready",
            "started_at_utc_ms": NOW,
            "speakers": [ME],
            "summary": SUMMARY,
            "headline": HEADLINE,
            "notes": [NOTE],
            "loops": [
                {
                    "id": corpus.open_loop.as_str(),
                    "meeting_id": corpus.session_id.uuid(),
                    "meeting_title": TITLE,
                    "kind": "loop",
                    "status": "open",
                    "direction": "waiting_on",
                    "text": THREAD,
                    "owner": "Dana Reyes",
                    "when_utc_ms": NOW,
                    "resolved_at_utc_ms": null,
                    "link": format!("sona://loop/{}", corpus.open_loop.as_str()),
                },
                {
                    "id": corpus.done_commitment.as_str(),
                    "meeting_id": corpus.session_id.uuid(),
                    "meeting_title": TITLE,
                    "kind": "commitment",
                    "status": "done",
                    // The microphone speaker is the user, so a row that speaker
                    // owns is one the user owes.
                    "direction": "mine",
                    "text": COMMITMENT,
                    "owner": ME,
                    "when_utc_ms": NOW,
                    "resolved_at_utc_ms": corpus.resolved_at_utc_ms,
                    "link": format!("sona://loop/{}", corpus.done_commitment.as_str()),
                },
            ],
            "link": format!("sona://meeting/{}", corpus.session_id.uuid()),
        })
    );
}

#[test]
fn an_id_the_corpus_does_not_hold_is_not_found() {
    let corpus = corpus();
    let absent = MeetingSessionId::new();

    for error in [
        meeting_detail(&corpus.store, absent).unwrap_err(),
        transcript_of(&corpus.store, absent).unwrap_err(),
    ] {
        assert_eq!(error.error, ExternalErrorCode::NotFound);
        assert_eq!(error.settings_path, None, "this is not a consent problem");
    }
}

#[test]
fn a_transcript_comes_back_speaker_labeled() {
    let corpus = corpus();

    let lines = transcript_of(&corpus.store, corpus.session_id).unwrap();

    assert_eq!(
        value(&lines),
        json!({
            "schema_version": QUERY_SCHEMA_VERSION,
            "meeting_id": corpus.session_id.uuid(),
            "title": TITLE,
            "started_at_utc_ms": NOW,
            "lines": [{
                "speaker": ME,
                "start_ms": 0,
                "end_ms": 1_500,
                "text": SEGMENT,
            }],
            "link": format!("sona://meeting/{}", corpus.session_id.uuid()),
        })
    );
}

#[test]
fn a_meeting_with_nothing_said_in_it_has_no_lines() {
    let corpus = corpus();

    let lines = transcript_of(&corpus.store, corpus.older_id).unwrap();

    assert!(lines.lines.is_empty());
    assert_eq!(lines.started_at_utc_ms, Some(EARLIER));
}

#[test]
fn the_corpus_loop_list_carries_the_meeting_each_row_came_from() {
    let corpus = corpus();

    let page = loops_page(&corpus.store, None, None, 25).unwrap();

    assert_eq!(
        page.entries
            .iter()
            .map(|row| (row.id.as_str(), row.meeting_title.as_str(), row.when_utc_ms))
            .collect::<Vec<_>>(),
        [
            (corpus.open_loop.as_str(), TITLE, NOW),
            (corpus.done_commitment.as_str(), TITLE, NOW),
        ]
    );
    assert!(!page.has_more);
}

#[test]
fn a_status_or_a_side_narrows_the_loop_list() {
    let corpus = corpus();

    let cases = [
        (
            Some(ExternalLoopStatus::Open),
            None,
            vec![corpus.open_loop.as_str()],
        ),
        (
            Some(ExternalLoopStatus::Done),
            None,
            vec![corpus.done_commitment.as_str()],
        ),
        (
            None,
            Some(ExternalLoopSide::Mine),
            vec![corpus.done_commitment.as_str()],
        ),
        (
            None,
            Some(ExternalLoopSide::WaitingOn),
            vec![corpus.open_loop.as_str()],
        ),
        (
            Some(ExternalLoopStatus::Open),
            Some(ExternalLoopSide::Mine),
            vec![],
        ),
    ];

    for (status, side, expected) in cases {
        let page = loops_page(&corpus.store, status, side, 25).unwrap();
        assert_eq!(
            page.entries
                .iter()
                .map(|row| row.id.clone())
                .collect::<Vec<_>>(),
            expected,
            "{status:?} / {side:?}"
        );
    }
}

#[test]
fn a_bounded_loop_list_says_there_is_more() {
    let corpus = corpus();

    let page = loops_page(&corpus.store, None, None, 1).unwrap();

    assert_eq!(page.entries.len(), 1);
    assert!(page.has_more);
}

#[test]
fn a_person_is_found_by_every_name_she_answers_to() {
    let corpus = corpus();

    for name in ["dana reyes", "Dana", "dana@example.com"] {
        let page = people_page(&corpus.store, name, 25).unwrap();
        assert_eq!(
            value(&page),
            json!({
                "schema_version": QUERY_SCHEMA_VERSION,
                "has_more": false,
                "entries": [{
                    "id": corpus.person_id.uuid(),
                    "display_name": "Dana Reyes",
                    "aliases": ["Dana"],
                    "calendar_emails": ["dana@example.com"],
                    "meetings_count": 0,
                    "last_meeting_at_utc_ms": null,
                    "last_meeting_title": null,
                    "last_meeting_headline": null,
                    "link": format!("sona://person/{}", corpus.person_id.uuid()),
                }],
            }),
            "{name:?}"
        );
    }
}

#[test]
fn a_name_nobody_answers_to_finds_nobody() {
    let corpus = corpus();

    let page = people_page(&corpus.store, "steven", 25).unwrap();

    assert!(page.entries.is_empty());
    assert!(!page.has_more);
}

#[test]
fn a_lookup_with_no_name_in_it_is_a_usage_error() {
    let corpus = corpus();

    assert_eq!(
        people_page(&corpus.store, "   ", 25).unwrap_err().error,
        ExternalErrorCode::InvalidRequest
    );
}

/// `--query` and `--events` are the plane's own pages. This surface adds a
/// wrapper and nothing else, so the wrapper has to be invisible on the wire:
/// what an agent parses is exactly what ⌘K and the panel agent already get.
#[test]
fn the_plane_pages_are_passed_through_unchanged() {
    let page = QuerySearchPage {
        schema_version: QUERY_SCHEMA_VERSION,
        entries: Vec::new(),
        next_cursor: None,
    };
    let events = QueryEventsPage {
        schema_version: QUERY_SCHEMA_VERSION,
        entries: Vec::new(),
        next_cursor: None,
    };

    assert_eq!(value(&ExternalResponse::Search(page.clone())), value(&page));
    assert_eq!(
        value(&ExternalResponse::Events(events.clone())),
        value(&events)
    );
}
