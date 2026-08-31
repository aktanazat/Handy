use super::{
    bump_workflow_run_revision_in, calendar_facts_in, jump_target, matching_enabled_workflows_in,
    outcome_projection, stored_event_in, terminal_receipt_exists_in, StoredWorkflowEvent,
};
use crate::meeting::detection::machine::CalendarEventSummary;
use crate::meeting::document_types::DocumentId;
use crate::meeting::store::documents::{bump_document_revision_in, document_by_id_in};
use crate::meeting::store::people::{
    bump_people_revision_in, calendar_context_in, continuity_summary_in, derive_calendar_links_in,
    derive_speaker_link_in, derive_title_links_in, link_document_mentions_in,
    vocabulary_candidates_in,
};
use crate::meeting::store::{MeetingStore, StoreError};
use crate::meeting::types::MeetingSessionId;
use crate::meeting::workflow_types::{
    WorkflowEventId, WorkflowEventKind, WorkflowId, WorkflowRunId, WorkflowRunReceipt,
    WorkflowRunStatus,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use std::panic::{catch_unwind, AssertUnwindSafe};
use uuid::Uuid;

pub(super) fn run_event(
    store: &MeetingStore,
    event_id: WorkflowEventId,
    record_skips: bool,
) -> Result<Vec<WorkflowRunReceipt>, StoreError> {
    let mut connection = store.connection()?;
    let event = stored_event_in(&connection, event_id)?;
    let workflows = matching_enabled_workflows_in(&connection, event.kind)?;
    let mut receipts = Vec::with_capacity(workflows.len());
    for workflow_id in workflows {
        let mut transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(receipt) = run_workflow_in(
            &mut transaction,
            &event,
            workflow_id,
            record_skips,
            execute_workflow_in,
        )? {
            receipts.push(receipt);
        }
        transaction.commit()?;
    }
    Ok(receipts)
}

fn run_workflow_in<F>(
    transaction: &mut Transaction<'_>,
    event: &StoredWorkflowEvent,
    workflow_id: WorkflowId,
    record_skips: bool,
    execute: F,
) -> Result<Option<WorkflowRunReceipt>, StoreError>
where
    F: FnOnce(&Connection, &StoredWorkflowEvent, WorkflowId) -> Result<String, StoreError>,
{
    if terminal_receipt_exists_in(transaction, event.id, workflow_id)? {
        if !record_skips {
            return Ok(None);
        }
        let started_at_utc_ms = now_utc_ms();
        let receipt = insert_receipt_in(
            transaction,
            event,
            workflow_id,
            WorkflowRunStatus::Skipped,
            "already_processed".to_string(),
            None,
            started_at_utc_ms,
            now_utc_ms(),
        )?;
        return Ok(Some(receipt));
    }

    let started_at_utc_ms = now_utc_ms();
    let savepoint = transaction.savepoint()?;
    let outcome = catch_unwind(AssertUnwindSafe(|| execute(&savepoint, event, workflow_id)));
    let (status, summary, error) = match outcome {
        Ok(Ok(summary)) => {
            savepoint.commit()?;
            (WorkflowRunStatus::Ok, summary, None)
        }
        Ok(Err(error)) => {
            drop(savepoint);
            (
                WorkflowRunStatus::Failed,
                "failed".to_string(),
                Some(error_code(error).to_string()),
            )
        }
        Err(_) => {
            drop(savepoint);
            (
                WorkflowRunStatus::Failed,
                "failed".to_string(),
                Some("workflow_panicked".to_string()),
            )
        }
    };
    let receipt = insert_receipt_in(
        transaction,
        event,
        workflow_id,
        status,
        summary,
        error,
        started_at_utc_ms,
        now_utc_ms(),
    )?;
    Ok(Some(receipt))
}

fn execute_workflow_in(
    connection: &Connection,
    event: &StoredWorkflowEvent,
    workflow_id: WorkflowId,
) -> Result<String, StoreError> {
    match workflow_id {
        WorkflowId::PersonLinking => run_person_linking_in(connection, event),
        WorkflowId::PreMeetingBriefing => run_briefing_in(connection, event),
        WorkflowId::Continuity => run_continuity_in(connection, event),
        WorkflowId::VocabularyMining => run_vocabulary_in(connection, event),
        WorkflowId::DocumentLinking => run_document_linking_in(connection, event),
    }
}

fn run_person_linking_in(
    connection: &Connection,
    event: &StoredWorkflowEvent,
) -> Result<String, StoreError> {
    let session_id = payload_uuid(&event.payload, "session_id")?;
    let session_id = MeetingSessionId::from_uuid(session_id);
    let changes = match event.kind {
        WorkflowEventKind::MeetingStarted => {
            let Some(calendar) = calendar_facts_in(connection, session_id)? else {
                return Ok("person_links:changes=0".to_string());
            };
            derive_calendar_links_in(
                connection,
                session_id,
                &calendar.attendees,
                event.occurred_at_utc_ms,
            )?
        }
        WorkflowEventKind::SpeakerRenamed => {
            let display_name = event
                .payload
                .get("display_name")
                .and_then(serde_json::Value::as_str)
                .ok_or(StoreError::Invalid)?;
            derive_speaker_link_in(
                connection,
                session_id,
                display_name,
                event.occurred_at_utc_ms,
            )?
        }
        WorkflowEventKind::MeetingFinalized => {
            let title: String = connection
                .query_row(
                    "SELECT title FROM meeting_sessions WHERE id = ?1",
                    [session_id.uuid().to_string()],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or(StoreError::NotFound)?;
            derive_title_links_in(connection, session_id, &title, event.occurred_at_utc_ms)?
        }
        _ => return Err(StoreError::Invalid),
    };
    if changes != 0 {
        bump_people_revision_in(connection)?;
    }
    Ok(format!("person_links:changes={changes}"))
}

fn run_briefing_in(
    connection: &Connection,
    event: &StoredWorkflowEvent,
) -> Result<String, StoreError> {
    let calendar = event
        .payload
        .get("event")
        .cloned()
        .ok_or(StoreError::Invalid)?;
    let calendar: CalendarEventSummary =
        serde_json::from_value(calendar).map_err(|_| StoreError::Invalid)?;
    let context = calendar_context_in(connection, &calendar.attendees)?;
    Ok(format!("briefing:persons={}", context.rows.len()))
}

fn run_continuity_in(
    connection: &Connection,
    event: &StoredWorkflowEvent,
) -> Result<String, StoreError> {
    let session_id = MeetingSessionId::from_uuid(payload_uuid(&event.payload, "session_id")?);
    let (series, carried) = continuity_summary_in(connection, session_id)?;
    Ok(format!("continuity:series={series},carried={carried}"))
}

fn run_vocabulary_in(
    connection: &Connection,
    event: &StoredWorkflowEvent,
) -> Result<String, StoreError> {
    let known = event
        .payload
        .get("known_vocabulary")
        .and_then(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let candidates = vocabulary_candidates_in(connection, &known)?;
    Ok(format!("vocabulary:candidates={}", candidates.len()))
}

fn run_document_linking_in(
    connection: &Connection,
    event: &StoredWorkflowEvent,
) -> Result<String, StoreError> {
    let document_id = DocumentId(payload_uuid(&event.payload, "document_id")?);
    let document = document_by_id_in(connection, document_id)?;
    let links = link_document_mentions_in(
        connection,
        document_id,
        &document.content,
        event.occurred_at_utc_ms,
    )?;
    if links != 0 {
        bump_people_revision_in(connection)?;
        bump_document_revision_in(connection)?;
    }
    Ok(format!("document_links:persons={links}"))
}

fn insert_receipt_in(
    connection: &Connection,
    event: &StoredWorkflowEvent,
    workflow_id: WorkflowId,
    status: WorkflowRunStatus,
    outcome_summary: String,
    error: Option<String>,
    started_at_utc_ms: i64,
    finished_at_utc_ms: i64,
) -> Result<WorkflowRunReceipt, StoreError> {
    let run_id = WorkflowRunId::new();
    let status_db = match status {
        WorkflowRunStatus::Ok => "ok",
        WorkflowRunStatus::Failed => "failed",
        WorkflowRunStatus::Skipped => "skipped",
    };
    let (outcome_code, outcome_counts) = outcome_projection(workflow_id, status, &outcome_summary);
    connection.execute(
        "INSERT INTO workflow_runs (
            id, workflow_id, event_id, status, started_at_utc_ms,
            finished_at_utc_ms, outcome_summary, error
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            run_id.uuid().to_string(),
            workflow_id.as_str(),
            event.id.uuid().to_string(),
            status_db,
            started_at_utc_ms,
            finished_at_utc_ms,
            outcome_summary,
            error
        ],
    )?;
    bump_workflow_run_revision_in(connection)?;
    Ok(WorkflowRunReceipt {
        id: run_id,
        workflow_id,
        event_kind: event.kind,
        jump_target: jump_target(event.kind, &event.payload),
        status,
        started_at_utc_ms,
        finished_at_utc_ms,
        outcome_summary,
        outcome_code,
        outcome_counts,
        error,
    })
}

fn now_utc_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn payload_uuid(payload: &serde_json::Value, key: &str) -> Result<Uuid, StoreError> {
    payload
        .get(key)
        .and_then(serde_json::Value::as_str)
        .ok_or(StoreError::Invalid)
        .and_then(|value| Uuid::parse_str(value).map_err(|_| StoreError::Invalid))
}

fn error_code(error: StoreError) -> &'static str {
    match error {
        StoreError::NotFound => "not_found",
        StoreError::Conflict => "conflict",
        StoreError::Invalid => "invalid_event_payload",
        StoreError::EncryptionUnavailable => "encryption_unavailable",
        StoreError::Unavailable => "store_unavailable",
        StoreError::Corrupt => "store_corrupt",
        StoreError::Io => "io_error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meeting::store::workflow_core_tests::{event, store};

    #[test]
    fn panic_rolls_back_work_and_commits_failed_receipt() {
        let (_directory, store) = store();
        let dispatch = store
            .record_workflow_event(event(
                WorkflowEventKind::MeetingStarted,
                serde_json::json!({"session_id": MeetingSessionId::new().uuid().to_string()}),
                "panic-savepoint",
            ))
            .unwrap();
        let mut connection = store.connection().unwrap();
        let event = stored_event_in(&connection, dispatch.event_id).unwrap();
        let mut transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        let receipt = run_workflow_in(
            &mut transaction,
            &event,
            WorkflowId::PersonLinking,
            false,
            |connection, _, _| -> Result<String, StoreError> {
                connection.execute(
                    "UPDATE workflow_state SET revision = 999 WHERE singleton = 1",
                    [],
                )?;
                panic!("workflow panic");
            },
        )
        .unwrap()
        .unwrap();
        transaction.commit().unwrap();
        drop(connection);

        assert_eq!(receipt.status, WorkflowRunStatus::Failed);
        assert_eq!(receipt.error.as_deref(), Some("workflow_panicked"));
        assert_eq!(store.workflows_list().unwrap().revision, 0);
        assert_eq!(
            store
                .workflow_runs(Default::default())
                .unwrap()
                .entries
                .len(),
            1
        );
    }
}
