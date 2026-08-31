//! Per-series preferences: the notes template, digest inclusion, and the
//! standing grant that lets a series record itself.
//!
//! One row per calendar series in `meeting_series_preferences`, holding the
//! choices, plus a join onto `meeting_series_consents` for the third. The
//! template id stored is the same stable string an artifact revision carries
//! (`meeting-one-on-one`, and so on), so a preference and an artifact never
//! disagree about what a template is called.
//!
//! Resolution order for a meeting's template, highest first: the template saved
//! on that meeting's own notes, this series' preference, the app default. This
//! module owns only the middle one — the notes row is `user_notes_row`'s, and
//! the default is `AppSettings`' — which is why nothing here reads settings.
//!
//! Always-record is deliberately *not* a column here. Permission to record is
//! consent: it lives in `meeting_series_consents`, where the grant carries its
//! policy version and acknowledged sources and where every auto-started
//! attempt revalidates it inside the transaction that writes its own receipt.
//! A duplicate boolean beside the template would be a second answer to a
//! question consent already owns.
//!
//! Every setter takes one decision at a time rather than upserting the whole
//! record. Three controls sit side by side on D28's Upcoming row, and a
//! whole-record write would let the template picker silently restore a digest
//! flag the operator had just cleared in another window.

use super::{
    grant_series_consent_in, id, insert_operation_receipt, live_series_consent_in,
    operation_receipt_in, revoke_series_consent_in, MeetingStore, StoreError,
};
use crate::meeting::analytics::MeetingNotesTemplate;
use crate::meeting::series_types::{
    MeetingSeriesAlwaysRecordSetRequest, MeetingSeriesDigestSetRequest,
    MeetingSeriesMutationResult, MeetingSeriesPreferences, MeetingSeriesRemoteOptOutSetRequest,
    MeetingSeriesRemoteRoster, MeetingSeriesRemoteRow, MeetingSeriesTemplateSetRequest,
};
use crate::meeting::types::{
    MeetingCommandKind, MeetingOperationId, MeetingReasonCode, MeetingSessionId, OperationActor,
    OperationReceipt, OperationResult,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::collections::HashMap;

/// How many series the meeting-intelligence roster offers.
///
/// A settings list is a place to make a decision, not an archive: two dozen
/// covers a working life's recurring meetings, and the number lives here rather
/// than in a caller so one surface cannot ask for a longer list than another.
const REMOTE_ROSTER_LIMIT: usize = 24;

impl MeetingStore {
    /// What one series has decided, by its own key.
    pub(crate) fn series_preferences(
        &self,
        series_key: &str,
    ) -> Result<MeetingSeriesPreferences, StoreError> {
        let connection = self.connection()?;
        series_preferences_in(&connection, Some(series_key.trim()))
    }

    /// The fence every series write carries, on its own.
    ///
    /// A surface showing many series holds one counter, not one per row, so it
    /// reads the counter rather than picking it off whichever record happened
    /// to come back first.
    pub(crate) fn series_revision(&self) -> Result<u64, StoreError> {
        let connection = self.connection()?;
        series_revision_in(&connection)
    }

    /// What the series behind one meeting has decided.
    ///
    /// A meeting with no calendar event has no series, and the record says so
    /// with a `None` key rather than an error: "this meeting is not part of a
    /// series" is an answer the review surface has to render.
    pub(crate) fn series_preferences_for_session(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingSeriesPreferences, StoreError> {
        let connection = self.connection()?;
        let series_key = session_series_key_in(&connection, session_id)?;
        series_preferences_in(&connection, series_key.as_deref())
    }

    /// The same record for many series at once, keyed by series key.
    ///
    /// One read for a whole week of calendar rows. Series with no stored row
    /// and no standing grant are present in the map with their defaults, so the
    /// caller never has to decide what an absent key means.
    pub(crate) fn series_preferences_many(
        &self,
        series_keys: &[String],
    ) -> Result<HashMap<String, MeetingSeriesPreferences>, StoreError> {
        let connection = self.connection()?;
        let revision = series_revision_in(&connection)?;
        let mut records = HashMap::with_capacity(series_keys.len());
        for series_key in series_keys {
            let series_key = series_key.trim();
            if series_key.is_empty() || records.contains_key(series_key) {
                continue;
            }
            records.insert(
                series_key.to_string(),
                stored_series_preferences_in(&connection, series_key, revision)?,
            );
        }
        Ok(records)
    }

    /// D14. The series this Mac has actually met with, newest first, each with
    /// the one preference the meeting-intelligence surface can change.
    ///
    /// A settings surface cannot offer a per-series switch without a list of
    /// series to offer it for, and there is no series table to read: a series
    /// is known only through the meetings that carried it. So the roster is
    /// derived from the calendar facts those meetings recorded, which is also
    /// what makes it honest — a series Sona has never sat in cannot be excluded
    /// from something it was never part of.
    pub(crate) fn series_remote_roster(&self) -> Result<MeetingSeriesRemoteRoster, StoreError> {
        let connection = self.connection()?;
        let revision = series_revision_in(&connection)?;
        let mut statement = connection.prepare(
            "SELECT g.series_key,
                    (SELECT json_extract(inner_facts.event_json, '$.title')
                       FROM meeting_calendar_facts inner_facts
                       JOIN meeting_sessions inner_sessions
                         ON inner_sessions.id = inner_facts.session_id
                      WHERE json_extract(inner_facts.event_json, '$.seriesKey') = g.series_key
                      ORDER BY COALESCE(inner_sessions.started_at_utc_ms,
                                        inner_sessions.created_at_utc_ms) DESC
                      LIMIT 1) AS title,
                    g.last_met_at,
                    g.meetings,
                    COALESCE(preferences.remote_intelligence_opt_out, 0)
               FROM (SELECT json_extract(facts.event_json, '$.seriesKey') AS series_key,
                            MAX(COALESCE(sessions.started_at_utc_ms,
                                         sessions.created_at_utc_ms)) AS last_met_at,
                            COUNT(*) AS meetings
                       FROM meeting_calendar_facts facts
                       JOIN meeting_sessions sessions ON sessions.id = facts.session_id
                      WHERE json_extract(facts.event_json, '$.seriesKey') IS NOT NULL
                        AND trim(json_extract(facts.event_json, '$.seriesKey')) <> ''
                      GROUP BY series_key) g
               LEFT JOIN meeting_series_preferences preferences
                      ON preferences.series_key = g.series_key
              ORDER BY g.last_met_at DESC, g.series_key
              LIMIT ?1",
        )?;
        let mut rows = statement.query(params![
            i64::try_from(REMOTE_ROSTER_LIMIT).map_err(|_| StoreError::Corrupt)?
        ])?;
        let mut roster = Vec::new();
        while let Some(row) = rows.next()? {
            let title: Option<String> = row.get(1)?;
            roster.push(MeetingSeriesRemoteRow {
                series_key: row.get(0)?,
                title: title.unwrap_or_default(),
                last_met_at_utc_ms: row.get(2)?,
                meetings: u32::try_from(row.get::<_, i64>(3)?).unwrap_or(u32::MAX),
                remote_intelligence_opt_out: row.get(4)?,
            });
        }
        Ok(MeetingSeriesRemoteRoster {
            rows: roster,
            revision,
        })
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
    ) -> Result<MeetingSeriesMutationResult, StoreError> {
        self.write_series_preference(
            &request.series_key,
            request.operation_id,
            request.expected_revision,
            requested_at_utc_ms,
            MeetingCommandKind::SeriesTemplateSet,
            |connection, series_key, now| {
                match request.template {
                    Some(template) => {
                        connection.execute(
                            "INSERT INTO meeting_series_preferences (
                                series_key, template_id, digest_included, updated_at_utc_ms
                             ) VALUES (?1, ?2, 1, ?3)
                             ON CONFLICT(series_key) DO UPDATE SET
                                template_id = excluded.template_id,
                                updated_at_utc_ms = excluded.updated_at_utc_ms",
                            params![series_key, encode_series_template(template), now],
                        )?;
                    }
                    // Clearing the template does not delete the row: it may
                    // still carry a digest choice. The row goes only when it
                    // holds nothing.
                    None => {
                        connection.execute(
                            "UPDATE meeting_series_preferences
                                SET template_id = NULL, updated_at_utc_ms = ?2
                              WHERE series_key = ?1",
                            params![series_key, now],
                        )?;
                        delete_default_row_in(connection, series_key)?;
                    }
                }
                Ok(())
            },
        )
    }

    /// D28. Keeps this series in the evening digest, or takes it out.
    pub(crate) fn set_series_digest(
        &self,
        request: &MeetingSeriesDigestSetRequest,
        requested_at_utc_ms: i64,
    ) -> Result<MeetingSeriesMutationResult, StoreError> {
        self.write_series_preference(
            &request.series_key,
            request.operation_id,
            request.expected_revision,
            requested_at_utc_ms,
            MeetingCommandKind::SeriesDigestSet,
            |connection, series_key, now| {
                connection.execute(
                    "INSERT INTO meeting_series_preferences (
                        series_key, template_id, digest_included, updated_at_utc_ms
                     ) VALUES (?1, NULL, ?2, ?3)
                     ON CONFLICT(series_key) DO UPDATE SET
                        digest_included = excluded.digest_included,
                        updated_at_utc_ms = excluded.updated_at_utc_ms",
                    params![series_key, request.digest_included, now],
                )?;
                delete_default_row_in(connection, series_key)?;
                Ok(())
            },
        )
    }

    /// D14. Keeps this series' text on this Mac, or hands it back to the global
    /// meeting-intelligence setting.
    ///
    /// One column, one decision, one receipt — the same shape as the template
    /// and digest writes, and for the same reason: the exclusion must survive
    /// another pane saving a template from a stale read.
    pub(crate) fn set_series_remote_opt_out(
        &self,
        request: &MeetingSeriesRemoteOptOutSetRequest,
        requested_at_utc_ms: i64,
    ) -> Result<MeetingSeriesMutationResult, StoreError> {
        self.write_series_preference(
            &request.series_key,
            request.operation_id,
            request.expected_revision,
            requested_at_utc_ms,
            MeetingCommandKind::SeriesRemoteOptOutSet,
            |connection, series_key, now| {
                connection.execute(
                    "INSERT INTO meeting_series_preferences (
                        series_key, template_id, digest_included,
                        remote_intelligence_opt_out, updated_at_utc_ms
                     ) VALUES (?1, NULL, 1, ?2, ?3)
                     ON CONFLICT(series_key) DO UPDATE SET
                        remote_intelligence_opt_out = excluded.remote_intelligence_opt_out,
                        updated_at_utc_ms = excluded.updated_at_utc_ms",
                    params![series_key, request.remote_intelligence_opt_out, now],
                )?;
                delete_default_row_in(connection, series_key)?;
                Ok(())
            },
        )
    }

    /// D28. Grants or revokes the standing consent that lets this series record
    /// itself.
    ///
    /// The write goes to `meeting_series_consents` through the same two
    /// primitives the consent panel uses, so an auto-start authorized from this
    /// toggle is indistinguishable — to the revalidation that gates it — from
    /// one authorized in the panel. Granting with no acknowledged source is
    /// rejected by that primitive, which is the invariant that keeps a grant
    /// from meaning "record something, unspecified".
    pub(crate) fn set_series_always_record(
        &self,
        request: &MeetingSeriesAlwaysRecordSetRequest,
        requested_at_utc_ms: i64,
    ) -> Result<MeetingSeriesMutationResult, StoreError> {
        self.write_series_preference(
            &request.series_key,
            request.operation_id,
            request.expected_revision,
            requested_at_utc_ms,
            MeetingCommandKind::SeriesAlwaysRecordSet,
            |connection, series_key, now| {
                if request.always_record {
                    grant_series_consent_in(
                        connection,
                        series_key,
                        request.policy_version,
                        &request.acknowledged_sources,
                        now,
                    )?;
                } else {
                    revoke_series_consent_in(connection, series_key, now)?;
                }
                Ok(())
            },
        )
    }

    /// The one write path all three setters share: idempotency, the fence, the
    /// receipt, and the revision bump, with only the statement differing.
    fn write_series_preference(
        &self,
        series_key: &str,
        operation_id: MeetingOperationId,
        expected_revision: u64,
        requested_at_utc_ms: i64,
        command: MeetingCommandKind,
        write: impl FnOnce(&Connection, &str, i64) -> Result<(), StoreError>,
    ) -> Result<MeetingSeriesMutationResult, StoreError> {
        let series_key = series_key.trim();
        if series_key.is_empty() {
            return Err(StoreError::Invalid);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(receipt) = operation_receipt_in(&transaction, operation_id)? {
            let preferences = series_preferences_in(&transaction, Some(series_key))?;
            transaction.commit()?;
            return Ok(MeetingSeriesMutationResult {
                receipt,
                preferences,
            });
        }
        let revision = series_revision_in(&transaction)?;
        if revision != expected_revision {
            let receipt = rejected_series_receipt(
                operation_id,
                command,
                expected_revision,
                revision,
                requested_at_utc_ms,
            );
            insert_operation_receipt(&transaction, &receipt, now_utc_ms())?;
            let preferences = series_preferences_in(&transaction, Some(series_key))?;
            transaction.commit()?;
            return Ok(MeetingSeriesMutationResult {
                receipt,
                preferences,
            });
        }
        let now = now_utc_ms();
        write(&transaction, series_key, now)?;
        let next = bump_series_revision_in(&transaction)?;
        let receipt = committed_series_receipt(
            operation_id,
            command,
            expected_revision,
            requested_at_utc_ms,
            now,
            next,
            series_key,
        );
        insert_operation_receipt(&transaction, &receipt, now)?;
        let preferences = series_preferences_in(&transaction, Some(series_key))?;
        transaction.commit()?;
        Ok(MeetingSeriesMutationResult {
            receipt,
            preferences,
        })
    }
}

/// The series key behind one meeting, from the calendar facts the session
/// remembered when it started. `None` for a manual recording.
pub(crate) fn session_series_key_in(
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

/// True unless this series has been taken out of the evening digest. A series
/// with no preference row is in it, which is what makes the digest's own query
/// a plain `LEFT JOIN`.
pub(super) fn series_digest_included_in(
    connection: &Connection,
    series_key: &str,
) -> Result<bool, StoreError> {
    let included: Option<bool> = connection
        .query_row(
            "SELECT digest_included FROM meeting_series_preferences WHERE series_key = ?1",
            params![series_key],
            |row| row.get(0),
        )
        .optional()?;
    Ok(included.unwrap_or(true))
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
        .optional()?
        .flatten();
    stored.as_deref().map(decode_series_template).transpose()
}

/// D14. False unless this series has been kept off the operator's server. A
/// series with no preference row follows the global setting, which is what
/// makes "no row" mean "no departure from it".
pub(super) fn series_remote_opt_out_in(
    connection: &Connection,
    series_key: &str,
) -> Result<bool, StoreError> {
    let opted_out: Option<bool> = connection
        .query_row(
            "SELECT remote_intelligence_opt_out FROM meeting_series_preferences
              WHERE series_key = ?1",
            params![series_key],
            |row| row.get(0),
        )
        .optional()?;
    Ok(opted_out.unwrap_or(false))
}

fn series_preferences_in(
    connection: &Connection,
    series_key: Option<&str>,
) -> Result<MeetingSeriesPreferences, StoreError> {
    let revision = series_revision_in(connection)?;
    let Some(series_key) = series_key.filter(|key| !key.is_empty()) else {
        return Ok(MeetingSeriesPreferences {
            series_key: None,
            template: None,
            digest_included: true,
            always_record: false,
            remote_intelligence_opt_out: false,
            revision,
        });
    };
    stored_series_preferences_in(connection, series_key, revision)
}

/// The record for a key that is known to be a real series, with the revision
/// already read. Split out so a bulk read pays for the counter once.
fn stored_series_preferences_in(
    connection: &Connection,
    series_key: &str,
    revision: u64,
) -> Result<MeetingSeriesPreferences, StoreError> {
    Ok(MeetingSeriesPreferences {
        series_key: Some(series_key.to_string()),
        template: series_template_in(connection, series_key)?,
        digest_included: series_digest_included_in(connection, series_key)?,
        always_record: live_series_consent_in(connection, series_key)?.is_some(),
        remote_intelligence_opt_out: series_remote_opt_out_in(connection, series_key)?,
        revision,
    })
}

/// Drops a preference row that no longer holds a preference.
///
/// Without this, clearing every choice would leave a row that says exactly what
/// its absence says, and "has a row" would stop being usable as "has decided
/// something". Every column a decision can land in has to appear here: a row
/// kept alive only by an exclusion must survive a template being cleared.
fn delete_default_row_in(connection: &Connection, series_key: &str) -> Result<(), StoreError> {
    connection.execute(
        "DELETE FROM meeting_series_preferences
          WHERE series_key = ?1 AND template_id IS NULL AND digest_included = 1
            AND remote_intelligence_opt_out = 0",
        params![series_key],
    )?;
    Ok(())
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
    command: MeetingCommandKind,
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
        command,
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
    command: MeetingCommandKind,
    expected_revision: u64,
    current_revision: u64,
    requested_at_utc_ms: i64,
) -> OperationReceipt {
    OperationReceipt {
        schema_version: super::STORE_SCHEMA_VERSION,
        operation_id,
        session_id: None,
        actor: OperationActor::User,
        command,
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
