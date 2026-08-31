//! D21: per-series notes-template preferences.
//!
//! One row per calendar series, holding the artifact template id a recurring
//! meeting has been told to use. The id stored is the same stable string an
//! artifact revision carries (`meeting-one-on-one`, and so on), so a preference
//! and an artifact never disagree about what a template is called.
//!
//! Resolution order for a meeting, highest first: the template saved on that
//! meeting's own notes, this series' preference, the app default. This module
//! owns only the middle one — the notes row is `user_notes_row`'s, and the
//! default is `AppSettings`' — which is why nothing here reads settings.

use super::{id, insert_operation_receipt, operation_receipt_in, MeetingStore, StoreError};
use crate::meeting::analytics::MeetingNotesTemplate;
use crate::meeting::series_types::{
    MeetingSeriesTemplateMutationResult, MeetingSeriesTemplateSetRequest,
    MeetingSeriesTemplateSnapshot,
};
use crate::meeting::types::{
    MeetingCommandKind, MeetingOperationId, MeetingReasonCode, MeetingSessionId, OperationActor,
    OperationReceipt, OperationResult,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

impl MeetingStore {
    /// What one series has chosen, by its own key.
    pub(crate) fn series_template(
        &self,
        series_key: &str,
    ) -> Result<MeetingSeriesTemplateSnapshot, StoreError> {
        let connection = self.connection()?;
        series_snapshot_in(&connection, Some(series_key.trim()))
    }

    /// What the series behind one meeting has chosen.
    ///
    /// A meeting with no calendar event has no series, and the snapshot says so
    /// with a `None` key rather than an error: "this meeting is not part of a
    /// series" is an answer the review surface has to render.
    pub(crate) fn series_template_for_session(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingSeriesTemplateSnapshot, StoreError> {
        let connection = self.connection()?;
        let series_key = session_series_key_in(&connection, session_id)?;
        series_snapshot_in(&connection, series_key.as_deref())
    }

    /// Remembers, or forgets, one series' template.
    ///
    /// Idempotent on `operation_id` and fenced on `expected_revision`, like
    /// every other receipted mutation: a replayed request returns the receipt it
    /// already wrote, and a stale one is rejected with the current revision so
    /// the caller can re-read and try again.
    pub(crate) fn set_series_template(
        &self,
        request: &MeetingSeriesTemplateSetRequest,
        requested_at_utc_ms: i64,
    ) -> Result<MeetingSeriesTemplateMutationResult, StoreError> {
        let series_key = request.series_key.trim();
        if series_key.is_empty() {
            return Err(StoreError::Invalid);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(receipt) = operation_receipt_in(&transaction, request.operation_id)? {
            let snapshot = series_snapshot_in(&transaction, Some(series_key))?;
            transaction.commit()?;
            return Ok(MeetingSeriesTemplateMutationResult { receipt, snapshot });
        }
        let revision = series_revision_in(&transaction)?;
        if revision != request.expected_revision {
            let receipt = rejected_series_receipt(
                request.operation_id,
                request.expected_revision,
                revision,
                requested_at_utc_ms,
            );
            insert_operation_receipt(&transaction, &receipt, now_utc_ms())?;
            let snapshot = series_snapshot_in(&transaction, Some(series_key))?;
            transaction.commit()?;
            return Ok(MeetingSeriesTemplateMutationResult { receipt, snapshot });
        }
        let now = now_utc_ms();
        match request.template {
            Some(template) => transaction.execute(
                "INSERT INTO meeting_series_preferences (
                    series_key, template_id, updated_at_utc_ms
                 ) VALUES (?1, ?2, ?3)
                 ON CONFLICT(series_key) DO UPDATE SET
                    template_id = excluded.template_id,
                    updated_at_utc_ms = excluded.updated_at_utc_ms",
                params![series_key, encode_series_template(template), now],
            )?,
            None => transaction.execute(
                "DELETE FROM meeting_series_preferences WHERE series_key = ?1",
                params![series_key],
            )?,
        };
        let next = bump_series_revision_in(&transaction)?;
        let receipt = committed_series_receipt(
            request.operation_id,
            request.expected_revision,
            requested_at_utc_ms,
            now,
            next,
            series_key,
        );
        insert_operation_receipt(&transaction, &receipt, now)?;
        let snapshot = series_snapshot_in(&transaction, Some(series_key))?;
        transaction.commit()?;
        Ok(MeetingSeriesTemplateMutationResult { receipt, snapshot })
    }
}

/// The series key behind one meeting, from the calendar facts the session
/// remembered when it started. `None` for a manual recording.
fn session_series_key_in(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<Option<String>, StoreError> {
    let key: Option<String> = connection
        .query_row(
            "SELECT json_extract(event_json, '$.seriesKey')
               FROM meeting_calendar_facts WHERE session_id = ?1",
            params![id(session_id)],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    Ok(key.filter(|key| !key.trim().is_empty()))
}

fn series_template_in(
    connection: &Connection,
    series_key: &str,
) -> Result<Option<MeetingNotesTemplate>, StoreError> {
    let stored: Option<String> = connection
        .query_row(
            "SELECT template_id FROM meeting_series_preferences WHERE series_key = ?1",
            params![series_key],
            |row| row.get(0),
        )
        .optional()?;
    stored.as_deref().map(decode_series_template).transpose()
}

fn series_snapshot_in(
    connection: &Connection,
    series_key: Option<&str>,
) -> Result<MeetingSeriesTemplateSnapshot, StoreError> {
    let revision = series_revision_in(connection)?;
    let Some(series_key) = series_key.filter(|key| !key.is_empty()) else {
        return Ok(MeetingSeriesTemplateSnapshot {
            series_key: None,
            template: None,
            revision,
        });
    };
    Ok(MeetingSeriesTemplateSnapshot {
        series_key: Some(series_key.to_string()),
        template: series_template_in(connection, series_key)?,
        revision,
    })
}

fn series_revision_in(connection: &Connection) -> Result<u64, StoreError> {
    let revision: i64 = connection.query_row(
        "SELECT revision FROM meeting_series_state WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    u64::try_from(revision).map_err(|_| StoreError::Corrupt)
}

fn bump_series_revision_in(connection: &Connection) -> Result<u64, StoreError> {
    connection.execute(
        "UPDATE meeting_series_state SET revision = revision + 1 WHERE singleton = 1",
        [],
    )?;
    series_revision_in(connection)
}

/// The stored form is the artifact template id, not the serde name: an
/// artifact revision already persists these strings, and one spelling per
/// template is what keeps a preference and the artifact it produced legible as
/// the same choice.
fn encode_series_template(template: MeetingNotesTemplate) -> &'static str {
    template.artifact_template_id()
}

/// A stored id this build does not know is corruption, not a silent fallback:
/// answering "General" for a template a newer build wrote would show the user a
/// choice they never made.
fn decode_series_template(stored: &str) -> Result<MeetingNotesTemplate, StoreError> {
    MeetingNotesTemplate::from_artifact_template_id(stored).ok_or(StoreError::Corrupt)
}

/// The series this write touched is the one thing a global receipt cannot say
/// on its own, so it is the receipt's single effect id.
fn committed_series_receipt(
    operation_id: MeetingOperationId,
    expected_revision: u64,
    requested_at_utc_ms: i64,
    committed_at_utc_ms: i64,
    new_revision: u64,
    series_key: &str,
) -> OperationReceipt {
    OperationReceipt {
        schema_version: super::STORE_SCHEMA_VERSION,
        operation_id,
        session_id: None,
        actor: OperationActor::User,
        command: MeetingCommandKind::SeriesTemplateSet,
        expected_revision,
        from_phase: None,
        to_phase: None,
        requested_at_utc_ms,
        committed_at_utc_ms: Some(committed_at_utc_ms),
        result: OperationResult::Committed,
        reason_codes: Vec::new(),
        new_revision: Some(new_revision),
        effect_ids: vec![series_key.to_string()],
    }
}

fn rejected_series_receipt(
    operation_id: MeetingOperationId,
    expected_revision: u64,
    current_revision: u64,
    requested_at_utc_ms: i64,
) -> OperationReceipt {
    OperationReceipt {
        schema_version: super::STORE_SCHEMA_VERSION,
        operation_id,
        session_id: None,
        actor: OperationActor::User,
        command: MeetingCommandKind::SeriesTemplateSet,
        expected_revision,
        from_phase: None,
        to_phase: None,
        requested_at_utc_ms,
        committed_at_utc_ms: Some(now_utc_ms()),
        result: OperationResult::Rejected,
        reason_codes: vec![MeetingReasonCode::StaleRevision],
        new_revision: Some(current_revision),
        effect_ids: Vec::new(),
    }
}

fn now_utc_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
