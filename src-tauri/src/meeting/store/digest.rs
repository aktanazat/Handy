//! D20: what one local day held, counted from the store.
//!
//! Three numbers, each read from the thing that already owns it: meetings from
//! the sessions that actually began capturing, loops closed from the receipts
//! D18's resolve mutation wrote, and suggestions waiting from the pending
//! learning queue. Nothing here writes, and nothing here decides whether a
//! notification is worth raising — that is `crate::meeting::digest`'s call.

use super::{MeetingStore, StoreError};
use crate::meeting::types::{MeetingCommandKind, OperationResult};
use rusqlite::{params, Connection};

/// A day's activity, in the three numbers the evening sentence is made of.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct MeetingDigestCounts {
    pub meetings: u64,
    pub loops_closed: u64,
    pub suggestions_waiting: u64,
}

impl MeetingStore {
    pub(crate) fn digest_counts(
        &self,
        day_start_utc_ms: i64,
        day_end_utc_ms: i64,
    ) -> Result<MeetingDigestCounts, StoreError> {
        let connection = self.connection()?;
        digest_counts_in(&connection, day_start_utc_ms, day_end_utc_ms)
    }
}

pub(super) fn digest_counts_in(
    connection: &Connection,
    day_start_utc_ms: i64,
    day_end_utc_ms: i64,
) -> Result<MeetingDigestCounts, StoreError> {
    Ok(MeetingDigestCounts {
        meetings: meetings_captured_in(connection, day_start_utc_ms, day_end_utc_ms)?,
        loops_closed: loops_closed_in(connection, day_start_utc_ms, day_end_utc_ms)?,
        suggestions_waiting: suggestions_waiting_in(connection)?,
    })
}

/// Meetings that actually began, bucketed by when capture started.
///
/// The dashboard trend counts by `created_at_utc_ms`, which includes a
/// preflight someone opened and abandoned. An evening sentence should not: "2
/// meetings" has to mean two meetings that happened, so the window is on
/// `started_at_utc_ms` and a session with none is not one.
fn meetings_captured_in(
    connection: &Connection,
    day_start_utc_ms: i64,
    day_end_utc_ms: i64,
) -> Result<u64, StoreError> {
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM meeting_sessions
          WHERE phase != 'deleting'
            AND started_at_utc_ms IS NOT NULL
            AND started_at_utc_ms >= ?1
            AND started_at_utc_ms < ?2",
        params![day_start_utc_ms, day_end_utc_ms],
        |row| row.get(0),
    )?;
    u64::try_from(count).map_err(|_| StoreError::Corrupt)
}

/// Loops D18's resolve mutation closed today.
///
/// One committed `loop_resolve` receipt is exactly one loop — the mutation
/// never batches — so counting receipts is counting loops. `loop_resolve`
/// covers both "done" and "dropped", and both leave the loop closed, which is
/// what the sentence says.
///
/// A rejected receipt is a write that was fenced out and changed nothing, so
/// the result is part of the predicate rather than an afterthought.
fn loops_closed_in(
    connection: &Connection,
    day_start_utc_ms: i64,
    day_end_utc_ms: i64,
) -> Result<u64, StoreError> {
    let command = serde_json::to_value(MeetingCommandKind::LoopResolve)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .ok_or(StoreError::Corrupt)?;
    let committed = serde_json::to_value(OperationResult::Committed)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .ok_or(StoreError::Corrupt)?;
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM meeting_operation_receipts
          WHERE created_at_utc_ms >= ?1
            AND created_at_utc_ms < ?2
            AND json_extract(receipt_json, '$.command') = ?3
            AND json_extract(receipt_json, '$.result') = ?4",
        params![day_start_utc_ms, day_end_utc_ms, command, committed],
        |row| row.get(0),
    )?;
    u64::try_from(count).map_err(|_| StoreError::Corrupt)
}

/// Suggestions still waiting for an answer, at any age.
///
/// Not a day count: "1 suggestion waiting" is a backlog, and a backlog that
/// built up yesterday is exactly the thing an evening nudge is for. Deciding a
/// suggestion deletes its row, so the table is the queue.
fn suggestions_waiting_in(connection: &Connection) -> Result<u64, StoreError> {
    let count: i64 =
        connection.query_row("SELECT COUNT(*) FROM learning_suggestions", [], |row| {
            row.get(0)
        })?;
    u64::try_from(count).map_err(|_| StoreError::Corrupt)
}
