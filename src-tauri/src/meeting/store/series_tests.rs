//! D21 series preferences and D20's day counts, at the store boundary.

use super::workflow_core_tests::{event, inputs, meeting, store};
use super::*;
use crate::meeting::analytics::MeetingNotesTemplate;
use crate::meeting::series_types::MeetingSeriesTemplateSetRequest;
use crate::meeting::types::{
    MeetingCommandKind, MeetingOperationId, MeetingReasonCode, MeetingSessionId, OperationActor,
    OperationResult,
};
use crate::meeting::workflow_types::{WorkflowEventKind, WorkflowId, WorkflowRunStatus};
use rusqlite::params;

fn calendar_facts(store: &MeetingStore, session_id: MeetingSessionId, series_key: &str) {
    let event_json = serde_json::json!({
        "eventKey": format!("{series_key}#1"),
        "seriesKey": series_key,
    });
    store
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO meeting_calendar_facts(session_id, event_key, event_json)
             VALUES (?1, ?2, ?3)",
            params![
                session_id.uuid().to_string(),
                format!("{series_key}#1"),
                event_json.to_string()
            ],
        )
        .unwrap();
}

fn set(
    store: &MeetingStore,
    series_key: &str,
    template: Option<MeetingNotesTemplate>,
    expected_revision: u64,
) -> crate::meeting::series_types::MeetingSeriesTemplateMutationResult {
    store
        .set_series_template(
            &MeetingSeriesTemplateSetRequest {
                operation_id: MeetingOperationId::new(),
                series_key: series_key.to_string(),
                template,
                expected_revision,
            },
            1_000,
        )
        .unwrap()
}

#[test]
fn a_series_nobody_has_chosen_for_reports_no_template() {
    let (_directory, store) = store();
    let snapshot = store.series_template("weekly-sync").unwrap();

    assert_eq!(snapshot.series_key.as_deref(), Some("weekly-sync"));
    assert_eq!(snapshot.template, None);
    assert_eq!(snapshot.revision, 0);
}

#[test]
fn choosing_a_template_is_receipted_and_names_the_series_it_touched() {
    let (_directory, store) = store();
    let result = set(
        &store,
        "weekly-sync",
        Some(MeetingNotesTemplate::Standup),
        0,
    );

    assert_eq!(result.receipt.result, OperationResult::Committed);
    assert_eq!(
        result.receipt.command,
        MeetingCommandKind::SeriesTemplateSet
    );
    assert_eq!(result.receipt.actor, OperationActor::User);
    assert_eq!(result.receipt.effect_ids, vec!["weekly-sync".to_string()]);
    assert_eq!(result.receipt.new_revision, Some(1));
    assert_eq!(
        result.snapshot.template,
        Some(MeetingNotesTemplate::Standup)
    );
    assert_eq!(result.snapshot.revision, 1);
    assert_eq!(
        store.series_template("weekly-sync").unwrap().template,
        Some(MeetingNotesTemplate::Standup)
    );
}

#[test]
fn a_write_against_a_revision_that_moved_is_rejected_and_changes_nothing() {
    let (_directory, store) = store();
    set(
        &store,
        "weekly-sync",
        Some(MeetingNotesTemplate::Standup),
        0,
    );

    let stale = set(
        &store,
        "weekly-sync",
        Some(MeetingNotesTemplate::Interview),
        0,
    );

    assert_eq!(stale.receipt.result, OperationResult::Rejected);
    assert_eq!(
        stale.receipt.reason_codes,
        vec![MeetingReasonCode::StaleRevision]
    );
    assert_eq!(
        store.series_template("weekly-sync").unwrap().template,
        Some(MeetingNotesTemplate::Standup)
    );
}

#[test]
fn a_replayed_operation_returns_the_receipt_it_already_wrote() {
    let (_directory, store) = store();
    let operation_id = MeetingOperationId::new();
    let request = MeetingSeriesTemplateSetRequest {
        operation_id,
        series_key: "weekly-sync".to_string(),
        template: Some(MeetingNotesTemplate::OneOnOne),
        expected_revision: 0,
    };

    let first = store.set_series_template(&request, 1_000).unwrap();
    let replay = store.set_series_template(&request, 2_000).unwrap();

    assert_eq!(first.receipt, replay.receipt);
    // A replay that re-ran the write would have bumped the counter again.
    assert_eq!(replay.snapshot.revision, 1);
}

#[test]
fn clearing_a_preference_hands_the_series_back_to_the_default() {
    let (_directory, store) = store();
    let chosen = set(
        &store,
        "weekly-sync",
        Some(MeetingNotesTemplate::SalesCall),
        0,
    );

    let cleared = set(&store, "weekly-sync", None, chosen.snapshot.revision);

    assert_eq!(cleared.receipt.result, OperationResult::Committed);
    assert_eq!(cleared.snapshot.template, None);
}

#[test]
fn a_meeting_with_no_calendar_event_belongs_to_no_series() {
    let (_directory, store) = store();
    let session_id = meeting(&store, "Local notes", 1);

    let snapshot = store.series_template_for_session(session_id).unwrap();

    assert_eq!(snapshot.series_key, None);
    assert_eq!(snapshot.template, None);
}

/// The middle rung of D21's precedence: what artifact generation is handed when
/// the meeting itself has chosen nothing.
#[test]
fn a_meeting_resolves_the_template_of_the_series_it_belongs_to() {
    let (_directory, store) = store();
    let session_id = meeting(&store, "Weekly sync", 1);
    calendar_facts(&store, session_id, "weekly-sync");
    set(
        &store,
        "weekly-sync",
        Some(MeetingNotesTemplate::Standup),
        0,
    );

    let snapshot = store.series_template_for_session(session_id).unwrap();

    assert_eq!(snapshot.series_key.as_deref(), Some("weekly-sync"));
    assert_eq!(snapshot.template, Some(MeetingNotesTemplate::Standup));
}

/// The top rung: a template saved on this meeting's own notes outranks its
/// series, and a meeting with no notes takes whatever it was handed — which is
/// the series' choice by the time generation calls this.
#[test]
fn a_meetings_own_notes_template_outranks_the_one_it_was_handed() {
    let (_directory, store) = store();
    let untouched = meeting(&store, "Weekly sync", 1);
    let edited = meeting(&store, "Weekly sync", 2);
    store
        .save_user_notes(edited, "ship it", MeetingNotesTemplate::Interview, 0)
        .unwrap();

    assert_eq!(
        store
            .user_notes(untouched, MeetingNotesTemplate::Standup)
            .unwrap()
            .template,
        MeetingNotesTemplate::Standup
    );
    assert_eq!(
        store
            .user_notes(edited, MeetingNotesTemplate::Standup)
            .unwrap()
            .template,
        MeetingNotesTemplate::Interview
    );
}

#[test]
fn the_digest_counts_meetings_that_started_inside_the_day() {
    let (_directory, store) = store();
    meeting(&store, "Yesterday", 500);
    meeting(&store, "Morning", 1_500);
    meeting(&store, "Afternoon", 1_900);
    meeting(&store, "Tomorrow", 2_500);

    let counts = store.digest_counts(1_000, 2_000).unwrap();

    assert_eq!(counts.meetings, 2);
}

#[test]
fn a_preflight_that_never_started_is_not_a_meeting_the_digest_counts() {
    let (_directory, store) = store();
    let abandoned = MeetingSessionId::new();
    store
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO meeting_sessions (
                id, phase, revision, title, origin_kind, preflight_json,
                created_at_utc_ms, started_at_utc_ms, processing_status,
                retention_policy_json
             ) VALUES (?1, 'preflight', 0, 'Never started', 'manual', '{}', 1500, NULL,
                       'pending', 'forever')",
            params![abandoned.uuid().to_string()],
        )
        .unwrap();

    assert_eq!(store.digest_counts(1_000, 2_000).unwrap().meetings, 0);
}

#[test]
fn only_committed_loop_resolutions_count_as_loops_closed() {
    let (_directory, store) = store();
    let session_id = meeting(&store, "Weekly sync", 1_100);
    let receipts = [
        (
            MeetingCommandKind::LoopResolve,
            OperationResult::Committed,
            1_100,
        ),
        (
            MeetingCommandKind::LoopResolve,
            OperationResult::Committed,
            1_200,
        ),
        // Fenced out: it changed nothing, so it closed nothing.
        (
            MeetingCommandKind::LoopResolve,
            OperationResult::Rejected,
            1_300,
        ),
        // Assigning an owner is not a closure.
        (
            MeetingCommandKind::LoopAssign,
            OperationResult::Committed,
            1_400,
        ),
        // Yesterday's closure belongs to yesterday's digest.
        (
            MeetingCommandKind::LoopResolve,
            OperationResult::Committed,
            500,
        ),
    ];
    let connection = store.connection().unwrap();
    for (command, result, at) in receipts {
        let operation_id = MeetingOperationId::new();
        let receipt = OperationReceipt {
            schema_version: STORE_SCHEMA_VERSION,
            operation_id,
            session_id: Some(session_id),
            actor: OperationActor::User,
            command,
            expected_revision: 0,
            from_phase: None,
            to_phase: None,
            requested_at_utc_ms: at,
            committed_at_utc_ms: Some(at),
            result,
            reason_codes: Vec::new(),
            new_revision: Some(1),
            effect_ids: Vec::new(),
        };
        connection
            .execute(
                "INSERT INTO meeting_operation_receipts (
                    operation_id, session_id, receipt_json, created_at_utc_ms
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![
                    operation_id.uuid().to_string(),
                    session_id.uuid().to_string(),
                    serde_json::to_string(&receipt).unwrap(),
                    at
                ],
            )
            .unwrap();
    }
    drop(connection);

    assert_eq!(store.digest_counts(1_000, 2_000).unwrap().loops_closed, 2);
}

#[test]
fn suggestions_waiting_is_the_whole_pending_queue_not_just_todays() {
    let (_directory, store) = store();
    let connection = store.connection().unwrap();
    for (candidate_key, generated_at) in [("comma", 500_i64), ("period", 1_500)] {
        connection
            .execute(
                "INSERT INTO learning_suggestions (
                    loop_kind, candidate_key, suggestion_json, evidence_json,
                    generated_at_utc_ms
                 ) VALUES ('spoken_punctuation', ?1, '{}', '{}', ?2)",
                params![candidate_key, generated_at],
            )
            .unwrap();
    }
    drop(connection);

    assert_eq!(
        store
            .digest_counts(1_000, 2_000)
            .unwrap()
            .suggestions_waiting,
        2
    );
}

/// The dedupe key is one local day, which is what makes "one evening
/// notification" true across restarts rather than only within one process.
#[test]
fn one_digest_event_and_one_run_per_local_day() {
    let (_directory, store) = store();
    meeting(&store, "Standup", 1_100);
    let payload = serde_json::json!({
        "local_day": "2026-08-31",
        "day_start_utc_ms": 1_000,
        "day_end_utc_ms": 2_000,
    });

    let first = store
        .record_workflow_event(event(
            WorkflowEventKind::DailyDigestDue,
            payload.clone(),
            "daily-digest:2026-08-31",
        ))
        .unwrap();
    let second = store
        .record_workflow_event(event(
            WorkflowEventKind::DailyDigestDue,
            payload.clone(),
            "daily-digest:2026-08-31",
        ))
        .unwrap();

    assert!(first.inserted);
    assert!(!second.inserted);
    assert_eq!(first.event_id, second.event_id);

    let receipts = store
        .run_workflow_event(first.event_id, false, &inputs())
        .unwrap();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].workflow_id, WorkflowId::DailyDigest);
    assert_eq!(receipts[0].status, WorkflowRunStatus::Ok);
    assert_eq!(receipts[0].outcome_counts.meetings, 1);

    // The second dispatch of the same day runs nothing, so no second receipt.
    let rerun = store
        .run_workflow_event(second.event_id, false, &inputs())
        .unwrap();
    assert!(rerun.is_empty());

    // A different day is a different digest.
    let tomorrow = store
        .record_workflow_event(event(
            WorkflowEventKind::DailyDigestDue,
            payload,
            "daily-digest:2026-09-01",
        ))
        .unwrap();
    assert!(tomorrow.inserted);
}

/// A digest run reports the day and writes nothing, so its counts have to
/// survive the round trip through the summary string the receipt stores.
#[test]
fn the_digest_receipt_carries_the_three_counts_it_measured() {
    let (_directory, store) = store();
    meeting(&store, "Standup", 1_100);
    meeting(&store, "Review", 1_200);
    store
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO learning_suggestions (
                loop_kind, candidate_key, suggestion_json, evidence_json,
                generated_at_utc_ms
             ) VALUES ('spoken_punctuation', 'comma', '{}', '{}', 1500)",
            [],
        )
        .unwrap();
    let dispatch = store
        .record_workflow_event(event(
            WorkflowEventKind::DailyDigestDue,
            serde_json::json!({
                "local_day": "2026-08-31",
                "day_start_utc_ms": 1_000,
                "day_end_utc_ms": 2_000,
            }),
            "daily-digest:2026-08-31",
        ))
        .unwrap();

    let receipts = store
        .run_workflow_event(dispatch.event_id, false, &inputs())
        .unwrap();

    let counts = &receipts[0].outcome_counts;
    assert_eq!(counts.meetings, 2);
    assert_eq!(counts.loops_closed, 0);
    assert_eq!(counts.suggestions_waiting, 1);
}
