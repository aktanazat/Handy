//! Loop 4: session-scoped priming for a meeting series with standing consent.
//!
//! # What this is, and what it must never become
//!
//! Standing consent for a series is permission to record that series, not
//! permission to learn from it permanently. So the context this loop assembles
//! is copied **onto one session**, the way `meeting_calendar_facts` copies
//! calendar facts onto a session, and it is read by exactly one transcription
//! run. It is never written to shared vocabulary, and it is never read by
//! another session.
//!
//! `meeting_series_priming.session_id` is `REFERENCES meeting_sessions(id) ON
//! DELETE CASCADE`. That is the whole retention story: Forget-this-series
//! revokes the standing consent, which stops any later meeting from being
//! primed, and deleting the meeting takes its blob with it. There is no second
//! place to clean up, because there is no second copy.
//!
//! # The gate
//!
//! Two conditions, both checked here rather than trusted from a payload: the
//! session's own consent must be a `StandingSeries` grant, and that series must
//! still have a live (non-revoked) row in `meeting_series_consents`. A revoked
//! series primes nothing.

use super::accepted_display_texts_in;
use crate::meeting::learning_types::{LearningLoopKind, SeriesPrimingBlob};
use crate::meeting::store::StoreError;
use crate::meeting::types::{MeetingConsent, MeetingConsentProvenance, MeetingSessionId};
use rusqlite::{params, Connection, OptionalExtension};

/// How many terms and names one session is primed with. A prompt bias is a hint,
/// not a dictionary: past this, the terms compete with each other.
const MAX_PRIMED_TERMS: usize = 24;
const MAX_PRIMED_PARTICIPANTS: usize = 12;

/// Assembles and attaches the blob. Returns how many entries it holds, or 0 when
/// the session is not in a series with live standing consent.
pub(in crate::meeting::store) fn prime_series_in(
    connection: &Connection,
    session_id: MeetingSessionId,
    now_utc_ms: i64,
) -> Result<u64, StoreError> {
    let Some(series_key) = live_standing_series_in(connection, session_id)? else {
        return Ok(0);
    };
    let terms = accepted_display_texts_in(
        connection,
        &[
            LearningLoopKind::VocabularyTerm,
            LearningLoopKind::VocabularyCorrection,
        ],
        MAX_PRIMED_TERMS,
    )?;
    let participants = series_participants_in(connection, &series_key, session_id)?;
    let blob = SeriesPrimingBlob {
        terms,
        participants,
    };
    if blob.is_empty() {
        return Ok(0);
    }
    let count = u64::try_from(blob.terms.len() + blob.participants.len())
        .map_err(|_| StoreError::Corrupt)?;
    connection.execute(
        "INSERT INTO meeting_series_priming (
            session_id, series_key, blob_json, assembled_at_utc_ms
         ) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(session_id) DO UPDATE SET
            series_key = excluded.series_key,
            blob_json = excluded.blob_json,
            assembled_at_utc_ms = excluded.assembled_at_utc_ms",
        params![
            session_id.uuid().to_string(),
            series_key,
            serde_json::to_string(&blob).map_err(|_| StoreError::Corrupt)?,
            now_utc_ms
        ],
    )?;
    Ok(count)
}

/// The blob attached to one session, for the transcription run that owns it.
pub(in crate::meeting::store) fn series_priming_for_session_in(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<Option<SeriesPrimingBlob>, StoreError> {
    let blob: Option<String> = connection
        .query_row(
            "SELECT blob_json FROM meeting_series_priming WHERE session_id = ?1",
            [session_id.uuid().to_string()],
            |row| row.get(0),
        )
        .optional()?;
    blob.map(|blob| serde_json::from_str(&blob).map_err(|_| StoreError::Corrupt))
        .transpose()
}

/// The series this session belongs to, when its consent is a standing grant that
/// has not been revoked.
fn live_standing_series_in(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<Option<String>, StoreError> {
    let acknowledgement: Option<String> = connection
        .query_row(
            "SELECT acknowledgement_json FROM meeting_consents
              WHERE session_id = ?1
              ORDER BY attempt_number DESC LIMIT 1",
            [session_id.uuid().to_string()],
            |row| row.get(0),
        )
        .optional()?;
    let Some(acknowledgement) = acknowledgement else {
        return Ok(None);
    };
    let consent: MeetingConsent =
        serde_json::from_str(&acknowledgement).map_err(|_| StoreError::Corrupt)?;
    let MeetingConsentProvenance::StandingSeries { series_key, .. } = consent.provenance else {
        return Ok(None);
    };
    let live: bool = connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM meeting_series_consents
             WHERE series_key = ?1 AND revoked_at_utc_ms IS NULL
         )",
        [&series_key],
        |row| row.get(0),
    )?;
    Ok(live.then_some(series_key))
}

/// Display names confirmed on earlier meetings in this series.
///
/// Only `confirmed` links count: a suggested link is Sona's guess, and priming a
/// transcript with a guessed name would make the guess self-fulfilling.
fn series_participants_in(
    connection: &Connection,
    series_key: &str,
    session_id: MeetingSessionId,
) -> Result<Vec<String>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT p.display_name
           FROM meeting_calendar_facts f
           JOIN meeting_person_links l ON l.meeting_id = f.session_id
           JOIN persons p ON p.id = l.person_id
          WHERE json_extract(f.event_json, '$.seriesKey') = ?1
            AND f.session_id != ?2
            AND l.confidence = 'confirmed'
          ORDER BY p.display_name
          LIMIT ?3",
    )?;
    let names = statement
        .query_map(
            params![
                series_key,
                session_id.uuid().to_string(),
                i64::try_from(MAX_PRIMED_PARTICIPANTS).unwrap_or(i64::MAX)
            ],
            |row| row.get::<_, String>(0),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(names)
}
