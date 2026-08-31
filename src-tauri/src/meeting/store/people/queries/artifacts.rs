use crate::meeting::analytics::MeetingAnalytics;
use crate::meeting::ledger::LedgerOutcome;
use crate::meeting::people_types::{
    Person, PersonCommitment, PersonId, PersonMeetingHeadline, PersonMeetingSummary, PersonOpenLoop,
};
use crate::meeting::store::people::{all_people_in, normalized, owner_matches};
use crate::meeting::store::StoreError;
use crate::meeting::types::{GeneratedMeetingArtifacts, MeetingSessionId};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use uuid::Uuid;

pub(super) struct PersonFacts {
    pub meetings: Vec<PersonMeetingSummary>,
    pub open_loops: Vec<PersonOpenLoop>,
    pub commitments: Vec<PersonCommitment>,
}

pub(super) fn meeting_summary_in(
    connection: &Connection,
    meeting_id: MeetingSessionId,
    person_id: PersonId,
) -> Result<PersonMeetingSummary, StoreError> {
    let row = connection
        .query_row(
            "SELECT m.title, COALESCE(m.started_at_utc_ms, m.created_at_utc_ms),
                    (SELECT a.content_json
                       FROM meeting_artifact_revisions a
                      WHERE a.session_id = m.id AND a.state = 'current'
                        AND a.content_json IS NOT NULL
                      ORDER BY a.generated_at_utc_ms DESC LIMIT 1)
               FROM meeting_sessions m WHERE m.id = ?1",
            [meeting_id.uuid().to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or(StoreError::NotFound)?;
    let series_number: i64 = connection.query_row(
        "SELECT COUNT(*)
           FROM meeting_person_links l
           JOIN meeting_sessions m ON m.id = l.meeting_id
          WHERE l.person_id = ?1 AND l.confidence = 'confirmed'
            AND COALESCE(m.started_at_utc_ms, m.created_at_utc_ms) <= ?2",
        params![person_id.uuid().to_string(), row.1],
        |row| row.get(0),
    )?;
    let content = decode_artifacts(row.2.as_deref())?;
    Ok(PersonMeetingSummary {
        id: meeting_id,
        title: row.0,
        at_utc_ms: row.1,
        headline: content.as_ref().and_then(artifact_headline),
        series_number: u64::try_from(series_number).map_err(|_| StoreError::Corrupt)?,
    })
}

pub(super) fn facts_for_person_in(
    connection: &Connection,
    person: &Person,
) -> Result<PersonFacts, StoreError> {
    let mut statement = connection.prepare(
        "SELECT m.id, m.title, COALESCE(m.started_at_utc_ms, m.created_at_utc_ms),
                (SELECT a.content_json
                   FROM meeting_artifact_revisions a
                  WHERE a.session_id = m.id AND a.state = 'current'
                    AND a.content_json IS NOT NULL
                  ORDER BY a.generated_at_utc_ms DESC LIMIT 1)
           FROM meeting_sessions m
           JOIN meeting_person_links l ON l.meeting_id = m.id
          WHERE l.person_id = ?1 AND l.confidence = 'confirmed'
          ORDER BY COALESCE(m.started_at_utc_ms, m.created_at_utc_ms) DESC, m.id DESC",
    )?;
    let rows = statement
        .query_map([person.id.uuid().to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    let total = u64::try_from(rows.len()).map_err(|_| StoreError::Corrupt)?;
    let mut meetings = Vec::with_capacity(rows.len());
    let mut open_loops = Vec::new();
    let mut commitments = Vec::new();
    for (index, (meeting_id, title, at_utc_ms, content_json)) in rows.into_iter().enumerate() {
        let meeting_id = parse_meeting_id(&meeting_id)?;
        let content = decode_artifacts(content_json.as_deref())?;
        let headline = content.as_ref().and_then(artifact_headline);
        let index = u64::try_from(index).map_err(|_| StoreError::Corrupt)?;
        meetings.push(PersonMeetingSummary {
            id: meeting_id,
            title: title.clone(),
            at_utc_ms,
            headline,
            series_number: total.saturating_sub(index),
        });
        let Some(ledger) = content.and_then(|content| content.ledger) else {
            continue;
        };
        open_loops.extend(
            ledger
                .threads
                .into_iter()
                .filter(|thread| {
                    thread.state.outcome() != LedgerOutcome::Landed
                        && thread
                            .owner
                            .as_deref()
                            .is_some_and(|owner| owner_matches(person, owner))
                })
                .map(|thread| PersonOpenLoop {
                    meeting_id,
                    title: title.clone(),
                    at_utc_ms,
                    text: thread.topic,
                    owner_person_id: Some(person.id),
                    carried_since_at_utc_ms: None,
                }),
        );
        commitments.extend(
            ledger
                .commitments
                .into_iter()
                .filter(|commitment| owner_matches(person, &commitment.who))
                .map(|commitment| PersonCommitment {
                    meeting_id,
                    title: title.clone(),
                    at_utc_ms,
                    text: commitment.what,
                }),
        );
    }
    mark_carried_loops(&mut open_loops);
    Ok(PersonFacts {
        meetings,
        open_loops,
        commitments,
    })
}

pub(super) fn all_open_loops_in(
    connection: &Connection,
) -> Result<Vec<PersonOpenLoop>, StoreError> {
    let people = all_people_in(connection)?;
    let mut statement = connection.prepare(
        "SELECT m.id, m.title, COALESCE(m.started_at_utc_ms, m.created_at_utc_ms),
                (SELECT a.content_json
                   FROM meeting_artifact_revisions a
                  WHERE a.session_id = m.id AND a.state = 'current'
                    AND a.content_json IS NOT NULL
                  ORDER BY a.generated_at_utc_ms DESC LIMIT 1)
           FROM meeting_sessions m
          ORDER BY COALESCE(m.started_at_utc_ms, m.created_at_utc_ms) DESC, m.id DESC",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    let mut loops = Vec::new();
    for (meeting_id, title, at_utc_ms, content_json) in rows {
        let meeting_id = parse_meeting_id(&meeting_id)?;
        let Some(ledger) =
            decode_artifacts(content_json.as_deref())?.and_then(|value| value.ledger)
        else {
            continue;
        };
        loops.extend(
            ledger
                .open_loops
                .into_iter()
                .map(|open_loop| PersonOpenLoop {
                    meeting_id,
                    title: title.clone(),
                    at_utc_ms,
                    text: open_loop.question,
                    owner_person_id: None,
                    carried_since_at_utc_ms: None,
                }),
        );
        loops.extend(
            ledger
                .threads
                .into_iter()
                .filter(|thread| thread.state.outcome() != LedgerOutcome::Landed)
                .map(|thread| {
                    let owner_person_id = thread.owner.as_deref().and_then(|owner| {
                        people
                            .iter()
                            .find(|person| owner_matches(person, owner))
                            .map(|person| person.id)
                    });
                    PersonOpenLoop {
                        meeting_id,
                        title: title.clone(),
                        at_utc_ms,
                        text: thread.topic,
                        owner_person_id,
                        carried_since_at_utc_ms: None,
                    }
                }),
        );
    }
    mark_carried_loops(&mut loops);
    Ok(loops)
}

pub(super) fn talk_share_average_in(
    connection: &Connection,
    person: &Person,
) -> Result<Option<u32>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT c.metrics_json, s.speaker_id, s.display_name
           FROM meeting_person_links l
           JOIN meeting_conversation_metrics c ON c.session_id = l.meeting_id
           JOIN meeting_speakers s ON s.session_id = l.meeting_id
          WHERE l.person_id = ?1 AND l.confidence = 'confirmed'
            AND s.merged_into_speaker_id IS NULL",
    )?;
    let rows = statement
        .query_map([person.id.uuid().to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut shares = Vec::new();
    for (metrics_json, speaker_id, display_name) in rows {
        if !owner_matches(person, &display_name) {
            continue;
        }
        let metrics: MeetingAnalytics =
            serde_json::from_str(&metrics_json).map_err(|_| StoreError::Corrupt)?;
        let speaker_id = Uuid::parse_str(&speaker_id).map_err(|_| StoreError::Corrupt)?;
        if let Some(share) = metrics
            .talk
            .speakers
            .iter()
            .find(|share| share.speaker_id.uuid() == speaker_id)
        {
            shares.push(u64::from(share.share_permille));
        }
    }
    if shares.is_empty() {
        return Ok(None);
    }
    let total: u64 = shares.iter().sum();
    let count = u64::try_from(shares.len()).map_err(|_| StoreError::Corrupt)?;
    u32::try_from((total + count / 2) / count)
        .map(Some)
        .map_err(|_| StoreError::Corrupt)
}

pub(super) fn document_summaries_in(
    connection: &Connection,
    person_id: PersonId,
) -> Result<Vec<crate::meeting::document_types::DocumentSummary>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT d.id, d.title, d.source_name, d.media_type, d.created_at_utc_ms
           FROM documents d
           JOIN document_person_links l ON l.document_id = d.id
          WHERE l.person_id = ?1
          ORDER BY d.created_at_utc_ms DESC, d.id DESC",
    )?;
    let summaries = statement
        .query_map([person_id.uuid().to_string()], |row| {
            let id: String = row.get(0)?;
            let id = Uuid::parse_str(&id).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(crate::meeting::document_types::DocumentSummary {
                id: crate::meeting::document_types::DocumentId(id),
                title: row.get(1)?,
                source_name: row.get(2)?,
                media_type: row.get(3)?,
                created_at_utc_ms: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(summaries)
}

fn decode_artifacts(
    content_json: Option<&str>,
) -> Result<Option<GeneratedMeetingArtifacts>, StoreError> {
    content_json
        .map(|content| serde_json::from_str(content).map_err(|_| StoreError::Corrupt))
        .transpose()
}

pub(super) fn person_meeting_headline_from_json(
    content_json: Option<&str>,
) -> Result<Option<PersonMeetingHeadline>, StoreError> {
    Ok(decode_artifacts(content_json)?
        .as_ref()
        .and_then(|content| {
            content
                .ledger
                .as_ref()
                .map(|ledger| ledger.headline.trim())
                .filter(|headline| !headline.is_empty())
                .map(|headline| PersonMeetingHeadline::Ledger {
                    text: headline.to_string(),
                })
                .or_else(|| {
                    let summary = content.summary.text.trim();
                    (!summary.is_empty()).then(|| PersonMeetingHeadline::Summary {
                        text: summary.to_string(),
                    })
                })
        }))
}

fn artifact_headline(content: &GeneratedMeetingArtifacts) -> Option<String> {
    content
        .ledger
        .as_ref()
        .map(|ledger| ledger.headline.trim())
        .filter(|headline| !headline.is_empty())
        .or_else(|| {
            let summary = content.summary.text.trim();
            (!summary.is_empty()).then_some(summary)
        })
        .map(str::to_string)
}

fn parse_meeting_id(value: &str) -> Result<MeetingSessionId, StoreError> {
    Uuid::parse_str(value)
        .map(MeetingSessionId::from_uuid)
        .map_err(|_| StoreError::Corrupt)
}

fn mark_carried_loops(loops: &mut [PersonOpenLoop]) {
    let mut earliest = HashMap::<(Option<PersonId>, String), i64>::new();
    for open_loop in loops.iter().rev() {
        let key = (open_loop.owner_person_id, normalized(&open_loop.text));
        earliest.entry(key).or_insert(open_loop.at_utc_ms);
    }
    for open_loop in loops {
        let key = (open_loop.owner_person_id, normalized(&open_loop.text));
        if let Some(first) = earliest.get(&key).copied() {
            if first < open_loop.at_utc_ms {
                open_loop.carried_since_at_utc_ms = Some(first);
            }
        }
    }
}
