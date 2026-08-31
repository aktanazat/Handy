//! D22: per-series automation preferences, and the run log that is their receipt.
//!
//! Two tables, with two different jobs.
//!
//! `meeting_series_automations` is a preference: one row per series per kind,
//! holding the switch and the thing it points at together, fenced on a shared
//! revision and written under an [`OperationReceipt`] like every other user
//! mutation in this app. It is keyed on the same `series_key` D21's template
//! preference uses, and it is a separate table from that one because it holds
//! configuration rather than a flag — a URL belongs beside the switch that sends
//! to it, not in a row of booleans.
//!
//! `meeting_automation_runs` is the run log, and it is *the* receipt for an
//! attempt rather than a copy of one: a system-actor background pass records its
//! own outcome in its own table, exactly as the workflow engine's `workflow_runs`
//! does, because `OperationReceipt` is the currency of fenced user mutations and
//! nothing here is fenced or requested. Its primary key `(artifact_id, kind)` is
//! the once-per-artifact-revision gate, enforced by SQLite rather than by
//! timing: `claim_automation_run` inserts before any effect runs, so a second
//! attempt for the same notes cannot start even if a second trigger somehow
//! arrives.
//!
//! Nothing in here retries. A row still reading `started` means the attempt
//! never reported back, and it stays that way: see
//! [`crate::meeting::automations`] for why one bounded attempt is the whole
//! doctrine.

use super::{id, insert_operation_receipt, operation_receipt_in, MeetingStore, StoreError};
use crate::meeting::automation_types::{
    MeetingAutomationFailure, MeetingAutomationKind, MeetingAutomationRoster,
    MeetingAutomationRunReceipt, MeetingAutomationRunState, MeetingAutomationSeries,
    MeetingSeriesAutomation, MeetingSeriesAutomationMutationResult,
    MeetingSeriesAutomationSetRequest, MeetingSeriesAutomationsSnapshot,
};
use crate::meeting::types::{
    MeetingArtifactId, MeetingCommandKind, MeetingOperationId, MeetingReasonCode, MeetingSessionId,
    OperationActor, OperationReceipt, OperationResult,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::collections::HashMap;

/// What one attempt is about to do, handed back by [`MeetingStore::claim_automation_run`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AutomationClaim {
    pub artifact_id: MeetingArtifactId,
    pub session_id: MeetingSessionId,
    pub series_key: String,
    pub automation: MeetingSeriesAutomation,
    pub started_at_utc_ms: i64,
}

impl MeetingStore {
    /// What one series has chosen, by its own key.
    pub(crate) fn series_automations(
        &self,
        series_key: &str,
    ) -> Result<MeetingSeriesAutomationsSnapshot, StoreError> {
        let connection = self.connection()?;
        automations_snapshot_in(&connection, Some(series_key.trim()))
    }

    /// What the series behind one meeting has chosen. A manual recording has no
    /// series, and the snapshot says so with a `None` key rather than an error.
    pub(crate) fn series_automations_for_session(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingSeriesAutomationsSnapshot, StoreError> {
        let connection = self.connection()?;
        let series_key = super::series::session_series_key_in(&connection, session_id)?;
        automations_snapshot_in(&connection, series_key.as_deref())
    }

    /// Turn one kind on or off for one series, and set what it points at.
    ///
    /// Idempotent on `operation_id` and fenced on `expected_revision`, like every
    /// other receipted mutation: a replayed request returns the receipt it
    /// already wrote, and a stale one is rejected with the current revision so
    /// the caller can re-read and try again.
    ///
    /// An unrunnable combination — on with nothing to point at, a URL off the
    /// operator's own network — is refused as invalid rather than stored and
    /// failed later, so the field the operator is still looking at is where they
    /// find out.
    pub(crate) fn set_series_automation(
        &self,
        request: &MeetingSeriesAutomationSetRequest,
        requested_at_utc_ms: i64,
    ) -> Result<MeetingSeriesAutomationMutationResult, StoreError> {
        let series_key = request.series_key.trim();
        if series_key.is_empty() {
            return Err(StoreError::Invalid);
        }
        let target = match request.kind.normalize_target(request.target.as_deref()) {
            Ok(target) => target,
            // A switch being turned off may carry a target that no longer
            // passes: forgetting the row is exactly what that means, so it is
            // allowed, and the target is dropped with it.
            Err(_) if !request.enabled => None,
            Err(_) => return Err(StoreError::Invalid),
        };
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(receipt) = operation_receipt_in(&transaction, request.operation_id)? {
            let snapshot = automations_snapshot_in(&transaction, Some(series_key))?;
            transaction.commit()?;
            return Ok(MeetingSeriesAutomationMutationResult { receipt, snapshot });
        }
        let revision = automations_revision_in(&transaction)?;
        if revision != request.expected_revision {
            let receipt = rejected_automation_receipt(
                request.operation_id,
                request.expected_revision,
                revision,
                requested_at_utc_ms,
                now_utc_ms(),
            );
            insert_operation_receipt(&transaction, &receipt, now_utc_ms())?;
            let snapshot = automations_snapshot_in(&transaction, Some(series_key))?;
            transaction.commit()?;
            return Ok(MeetingSeriesAutomationMutationResult { receipt, snapshot });
        }
        let now = now_utc_ms();
        if !request.enabled && target.is_none() {
            // Off with nothing remembered is "forget this", which is how a URL
            // leaves the machine for good.
            transaction.execute(
                "DELETE FROM meeting_series_automations WHERE series_key = ?1 AND kind = ?2",
                params![series_key, request.kind.as_str()],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO meeting_series_automations (
                    series_key, kind, enabled, target, updated_at_utc_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(series_key, kind) DO UPDATE SET
                    enabled = excluded.enabled,
                    target = excluded.target,
                    updated_at_utc_ms = excluded.updated_at_utc_ms",
                params![
                    series_key,
                    request.kind.as_str(),
                    i64::from(request.enabled),
                    target,
                    now
                ],
            )?;
        }
        let next = bump_automations_revision_in(&transaction)?;
        let receipt = committed_automation_receipt(
            request.operation_id,
            request.expected_revision,
            requested_at_utc_ms,
            now,
            next,
            series_key,
            request.kind,
        );
        insert_operation_receipt(&transaction, &receipt, now)?;
        let snapshot = automations_snapshot_in(&transaction, Some(series_key))?;
        transaction.commit()?;
        Ok(MeetingSeriesAutomationMutationResult { receipt, snapshot })
    }

    /// Every series this machine has actually recorded a meeting for, newest
    /// first, with whatever automations it carries.
    ///
    /// Assembled from calendar facts rather than from the calendar: the settings
    /// surface offers automations for meetings that happen, not for every event
    /// in an account. A series whose meetings have all been deleted disappears
    /// from the list, and its rows are left alone — turning an automation on for
    /// a series, deleting the meetings, and recording it again is one continuous
    /// choice, not two.
    pub(crate) fn automation_roster(&self) -> Result<MeetingAutomationRoster, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT json_extract(f.event_json, '$.seriesKey') AS series_key,
                    json_extract(f.event_json, '$.title'),
                    COALESCE(s.started_at_utc_ms, s.created_at_utc_ms)
               FROM meeting_calendar_facts f
               JOIN meeting_sessions s ON s.id = f.session_id
              WHERE s.phase != 'deleting'
                AND series_key IS NOT NULL
                AND length(trim(series_key)) > 0
              ORDER BY 3 ASC",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let configured = all_automations_in(&connection)?;

        // Ascending above, so the last write of each key is the most recent
        // occurrence: one pass, and the title a person sees is the one their
        // calendar shows today rather than whatever the series was called first.
        let mut order = Vec::new();
        let mut series = HashMap::<String, MeetingAutomationSeries>::new();
        for (series_key, title, at_utc_ms) in rows {
            let entry = series.entry(series_key.clone()).or_insert_with(|| {
                order.push(series_key.clone());
                MeetingAutomationSeries {
                    series_key: series_key.clone(),
                    title: String::new(),
                    last_met_at_utc_ms: at_utc_ms,
                    meeting_count: 0,
                    automations: configured.get(&series_key).cloned().unwrap_or_default(),
                }
            });
            entry.meeting_count = entry.meeting_count.saturating_add(1);
            entry.last_met_at_utc_ms = at_utc_ms;
            if let Some(title) = title.map(|title| title.trim().to_string()) {
                if !title.is_empty() {
                    entry.title = title;
                }
            }
        }
        let mut listed = order
            .into_iter()
            .filter_map(|key| series.remove(&key))
            .collect::<Vec<_>>();
        listed.sort_by(|left, right| {
            right
                .last_met_at_utc_ms
                .cmp(&left.last_met_at_utc_ms)
                .then_with(|| left.series_key.cmp(&right.series_key))
        });
        Ok(MeetingAutomationRoster {
            series: listed,
            revision: automations_revision_in(&connection)?,
        })
    }

    /// Take the one attempt this artifact revision gets for this kind.
    ///
    /// `Ok(None)` means somebody already has it — the same notes, the same kind,
    /// already attempted — and the caller must not run the effect. The insert is
    /// the claim, so it is durable before anything leaves this process.
    pub(crate) fn claim_automation_run(
        &self,
        artifact_id: MeetingArtifactId,
        session_id: MeetingSessionId,
        series_key: &str,
        automation: &MeetingSeriesAutomation,
        started_at_utc_ms: i64,
    ) -> Result<Option<AutomationClaim>, StoreError> {
        let connection = self.connection()?;
        let inserted = connection.execute(
            "INSERT OR IGNORE INTO meeting_automation_runs (
                artifact_id, kind, session_id, series_key, state,
                failure, detail, effects, started_at_utc_ms, finished_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, 0, ?6, NULL)",
            params![
                id(artifact_id),
                automation.kind.as_str(),
                id(session_id),
                series_key,
                MeetingAutomationRunState::Started.as_str(),
                started_at_utc_ms
            ],
        )?;
        if inserted == 0 {
            return Ok(None);
        }
        Ok(Some(AutomationClaim {
            artifact_id,
            session_id,
            series_key: series_key.to_string(),
            automation: automation.clone(),
            started_at_utc_ms,
        }))
    }

    /// Write what the attempt did. One row, updated once, never again.
    pub(crate) fn finish_automation_run(
        &self,
        artifact_id: MeetingArtifactId,
        kind: MeetingAutomationKind,
        state: MeetingAutomationRunState,
        failure: Option<MeetingAutomationFailure>,
        detail: Option<&str>,
        effects: u32,
        finished_at_utc_ms: i64,
    ) -> Result<MeetingAutomationRunReceipt, StoreError> {
        let connection = self.connection()?;
        let updated = connection.execute(
            "UPDATE meeting_automation_runs
                SET state = ?3, failure = ?4, detail = ?5, effects = ?6,
                    finished_at_utc_ms = ?7
              WHERE artifact_id = ?1 AND kind = ?2 AND finished_at_utc_ms IS NULL",
            params![
                id(artifact_id),
                kind.as_str(),
                state.as_str(),
                failure.map(MeetingAutomationFailure::as_str),
                detail,
                i64::from(effects),
                finished_at_utc_ms
            ],
        )?;
        if updated == 0 {
            return Err(StoreError::Conflict);
        }
        run_in(&connection, artifact_id, kind)?.ok_or(StoreError::NotFound)
    }

    /// Every attempt made for one meeting, newest first.
    pub(crate) fn automation_runs(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<Vec<MeetingAutomationRunReceipt>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT artifact_id, kind, session_id, series_key, state, failure,
                    detail, effects, started_at_utc_ms, finished_at_utc_ms
               FROM meeting_automation_runs
              WHERE session_id = ?1
              ORDER BY started_at_utc_ms DESC, kind ASC",
        )?;
        let rows = statement
            .query_map(params![id(session_id)], run_columns)?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        rows.into_iter().map(run_from_columns).collect()
    }
}

/// The columns of one run row, still as SQLite spelled them.
///
/// Read and decoded in two steps, like the rest of this store: `query_map`'s
/// closure can only fail with a `rusqlite::Error`, and "this row holds a kind
/// this build does not know" is corruption of ours, not of SQLite's.
type RunColumns = (
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    i64,
    i64,
    Option<i64>,
);

fn run_columns(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunColumns> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
    ))
}

/// One row, or the corruption it is. A stored kind, state or failure this build
/// does not know is not silently dropped: a receipt that quietly forgot which
/// automation it was about would be worse than an error.
fn run_from_columns(columns: RunColumns) -> Result<MeetingAutomationRunReceipt, StoreError> {
    let (
        artifact_id,
        kind,
        session_id,
        series_key,
        state,
        failure,
        detail,
        effects,
        started_at_utc_ms,
        finished_at_utc_ms,
    ) = columns;
    Ok(MeetingAutomationRunReceipt {
        artifact_id: MeetingArtifactId::from_uuid(super::parse_uuid(&artifact_id)?),
        session_id: MeetingSessionId::from_uuid(super::parse_uuid(&session_id)?),
        series_key,
        kind: MeetingAutomationKind::from_str(&kind).ok_or(StoreError::Corrupt)?,
        state: MeetingAutomationRunState::from_str(&state).ok_or(StoreError::Corrupt)?,
        failure: failure
            .as_deref()
            .map(|value| MeetingAutomationFailure::from_str(value).ok_or(StoreError::Corrupt))
            .transpose()?,
        detail,
        effects: u32::try_from(effects).map_err(|_| StoreError::Corrupt)?,
        started_at_utc_ms,
        finished_at_utc_ms,
    })
}

fn run_in(
    connection: &Connection,
    artifact_id: MeetingArtifactId,
    kind: MeetingAutomationKind,
) -> Result<Option<MeetingAutomationRunReceipt>, StoreError> {
    connection
        .query_row(
            "SELECT artifact_id, kind, session_id, series_key, state, failure,
                    detail, effects, started_at_utc_ms, finished_at_utc_ms
               FROM meeting_automation_runs WHERE artifact_id = ?1 AND kind = ?2",
            params![id(artifact_id), kind.as_str()],
            run_columns,
        )
        .optional()?
        .map(run_from_columns)
        .transpose()
}

fn automations_snapshot_in(
    connection: &Connection,
    series_key: Option<&str>,
) -> Result<MeetingSeriesAutomationsSnapshot, StoreError> {
    let revision = automations_revision_in(connection)?;
    let Some(series_key) = series_key.filter(|key| !key.is_empty()) else {
        return Ok(MeetingSeriesAutomationsSnapshot {
            series_key: None,
            automations: Vec::new(),
            revision,
        });
    };
    Ok(MeetingSeriesAutomationsSnapshot {
        series_key: Some(series_key.to_string()),
        automations: automations_for_series_in(connection, series_key)?,
        revision,
    })
}

fn automations_for_series_in(
    connection: &Connection,
    series_key: &str,
) -> Result<Vec<MeetingSeriesAutomation>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT kind, enabled, target FROM meeting_series_automations
          WHERE series_key = ?1 ORDER BY kind ASC",
    )?;
    let rows = statement
        .query_map(params![series_key], automation_columns)?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    rows.into_iter().map(automation_from_columns).collect()
}

fn all_automations_in(
    connection: &Connection,
) -> Result<HashMap<String, Vec<MeetingSeriesAutomation>>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT series_key, kind, enabled, target FROM meeting_series_automations
          ORDER BY series_key ASC, kind ASC",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                (row.get(1)?, row.get(2)?, row.get(3)?),
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut grouped = HashMap::<String, Vec<MeetingSeriesAutomation>>::new();
    for (series_key, columns) in rows {
        grouped
            .entry(series_key)
            .or_default()
            .push(automation_from_columns(columns)?);
    }
    Ok(grouped)
}

/// `(kind, enabled, target)`, as SQLite spelled them.
type AutomationColumns = (String, i64, Option<String>);

fn automation_columns(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationColumns> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
}

fn automation_from_columns(
    columns: AutomationColumns,
) -> Result<MeetingSeriesAutomation, StoreError> {
    let (kind, enabled, target) = columns;
    Ok(MeetingSeriesAutomation {
        kind: MeetingAutomationKind::from_str(&kind).ok_or(StoreError::Corrupt)?,
        enabled: enabled != 0,
        target,
    })
}

fn automations_revision_in(connection: &Connection) -> Result<u64, StoreError> {
    let revision: i64 = connection.query_row(
        "SELECT revision FROM meeting_automation_state WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    u64::try_from(revision).map_err(|_| StoreError::Corrupt)
}

fn bump_automations_revision_in(connection: &Connection) -> Result<u64, StoreError> {
    connection.execute(
        "UPDATE meeting_automation_state SET revision = revision + 1 WHERE singleton = 1",
        [],
    )?;
    automations_revision_in(connection)
}

/// The series and the kind this write touched: a global receipt cannot say
/// either on its own, and both are needed to read the receipt back as a decision
/// somebody made.
fn committed_automation_receipt(
    operation_id: MeetingOperationId,
    expected_revision: u64,
    requested_at_utc_ms: i64,
    committed_at_utc_ms: i64,
    new_revision: u64,
    series_key: &str,
    kind: MeetingAutomationKind,
) -> OperationReceipt {
    OperationReceipt {
        schema_version: super::STORE_SCHEMA_VERSION,
        operation_id,
        session_id: None,
        actor: OperationActor::User,
        command: MeetingCommandKind::SeriesAutomationSet,
        expected_revision,
        from_phase: None,
        to_phase: None,
        requested_at_utc_ms,
        committed_at_utc_ms: Some(committed_at_utc_ms),
        result: OperationResult::Committed,
        reason_codes: Vec::new(),
        new_revision: Some(new_revision),
        effect_ids: vec![series_key.to_string(), kind.as_str().to_string()],
    }
}

fn rejected_automation_receipt(
    operation_id: MeetingOperationId,
    expected_revision: u64,
    current_revision: u64,
    requested_at_utc_ms: i64,
    committed_at_utc_ms: i64,
) -> OperationReceipt {
    OperationReceipt {
        schema_version: super::STORE_SCHEMA_VERSION,
        operation_id,
        session_id: None,
        actor: OperationActor::User,
        command: MeetingCommandKind::SeriesAutomationSet,
        expected_revision,
        from_phase: None,
        to_phase: None,
        requested_at_utc_ms,
        committed_at_utc_ms: Some(committed_at_utc_ms),
        result: OperationResult::Rejected,
        reason_codes: vec![MeetingReasonCode::StaleRevision],
        new_revision: Some(current_revision),
        effect_ids: Vec::new(),
    }
}

fn now_utc_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
