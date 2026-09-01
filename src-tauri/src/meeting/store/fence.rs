//! The skeleton every fenced, receipted preference write shares.
//!
//! A user preference in this app is written the same way wherever it lands: the
//! request is idempotent on its `operation_id`, fenced on the revision the
//! caller last read, and it leaves an [`OperationReceipt`] behind whether it
//! committed or was refused. Only three things differ between one preference
//! table and the next — which counter fences it, what a read of it hands back,
//! and what the receipt names as the thing it touched — so those are all a
//! caller supplies here.
//!
//! Written once because a second copy of this skeleton is a second answer to
//! "what happens when two windows save from the same read", and two answers
//! drift apart one bug fix at a time.

use super::{insert_operation_receipt, operation_receipt_in, MeetingStore, StoreError};
use crate::meeting::types::{
    MeetingCommandKind, MeetingOperationId, MeetingReasonCode, OperationActor, OperationReceipt,
    OperationResult,
};
use rusqlite::{Connection, TransactionBehavior};

/// The counter one preference table's writes are fenced on, read and bumped.
#[derive(Clone, Copy)]
pub(super) struct Fence {
    pub read: fn(&Connection) -> Result<u64, StoreError>,
    pub bump: fn(&Connection) -> Result<u64, StoreError>,
}

/// One fenced write, minus the statement that performs it.
pub(super) struct FencedWrite {
    pub fence: Fence,
    pub command: MeetingCommandKind,
    /// What this write touched — the one thing a global receipt cannot say on
    /// its own. Carried only by a receipt that committed; a refusal touched
    /// nothing.
    pub effect_ids: Vec<String>,
    pub operation_id: MeetingOperationId,
    pub expected_revision: u64,
    pub requested_at_utc_ms: i64,
}

/// Runs `write` under the idempotency check, the fence and the receipt, and
/// hands back that receipt beside a fresh read of whatever the caller shows.
///
/// A replayed `operation_id` returns the receipt it already wrote without
/// touching anything. A stale `expected_revision` is refused with the current
/// one so the caller can re-read and try again. Every path still returns the
/// snapshot, because a caller that has just been told "no" needs the truth more
/// than one that succeeded.
pub(super) fn write_fenced<S>(
    store: &MeetingStore,
    request: FencedWrite,
    snapshot: impl Fn(&Connection) -> Result<S, StoreError>,
    write: impl FnOnce(&Connection, i64) -> Result<(), StoreError>,
) -> Result<(OperationReceipt, S), StoreError> {
    let FencedWrite {
        fence,
        command,
        effect_ids,
        operation_id,
        expected_revision,
        requested_at_utc_ms,
    } = request;
    let mut connection = store.connection()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if let Some(receipt) = operation_receipt_in(&transaction, operation_id)? {
        let snapshot = snapshot(&transaction)?;
        transaction.commit()?;
        return Ok((receipt, snapshot));
    }
    let now = chrono::Utc::now().timestamp_millis();
    let receipt = |result, reason_codes, revision, effects| OperationReceipt {
        schema_version: super::STORE_SCHEMA_VERSION,
        operation_id,
        session_id: None,
        actor: OperationActor::User,
        command,
        expected_revision,
        from_phase: None,
        to_phase: None,
        requested_at_utc_ms,
        committed_at_utc_ms: Some(now),
        result,
        reason_codes,
        new_revision: Some(revision),
        effect_ids: effects,
    };
    let revision = (fence.read)(&transaction)?;
    if revision != expected_revision {
        let receipt = receipt(
            OperationResult::Rejected,
            vec![MeetingReasonCode::StaleRevision],
            revision,
            Vec::new(),
        );
        insert_operation_receipt(&transaction, &receipt, now)?;
        let snapshot = snapshot(&transaction)?;
        transaction.commit()?;
        return Ok((receipt, snapshot));
    }
    write(&transaction, now)?;
    let receipt = receipt(
        OperationResult::Committed,
        Vec::new(),
        (fence.bump)(&transaction)?,
        effect_ids,
    );
    insert_operation_receipt(&transaction, &receipt, now)?;
    let snapshot = snapshot(&transaction)?;
    transaction.commit()?;
    Ok((receipt, snapshot))
}
