use super::encode_strings;
use super::linking::upsert_link_in;
use crate::meeting::detection::machine::CalendarAttendee;
use crate::meeting::document_types::DocumentId;
use crate::meeting::people_types::{Person, PersonId, PersonLinkConfidence, PersonLinkSource};
use crate::meeting::store::people::{
    all_people_in, exact_phrase_mentioned, identity_names, merge_unique_case_insensitive,
    normalized, normalized_email, person_by_id_in,
};
use crate::meeting::store::StoreError;
use crate::meeting::types::MeetingSessionId;
use rusqlite::{params, Connection};
use std::collections::HashMap;

pub(in crate::meeting::store) fn derive_calendar_links_in(
    connection: &Connection,
    meeting_id: MeetingSessionId,
    attendees: &[CalendarAttendee],
    now_utc_ms: i64,
) -> Result<usize, StoreError> {
    let mut changed = 0;
    for attendee in attendees.iter().filter(|attendee| !attendee.is_self) {
        let Some(email) = attendee.email.as_deref().map(normalized_email) else {
            continue;
        };
        if email.is_empty() {
            continue;
        }
        let person = find_person_by_email_in(connection, &email)?.unwrap_or_else(|| Person {
            id: PersonId::new(),
            display_name: attendee.name.trim().to_string(),
            aliases: Vec::new(),
            calendar_emails: vec![email.clone()],
            created_at_utc_ms: now_utc_ms,
            updated_at_utc_ms: now_utc_ms,
        });
        let (person, identity_changed) =
            save_calendar_identity_in(connection, person, attendee, &email, now_utc_ms)?;
        changed += usize::from(identity_changed);
        changed += usize::from(upsert_link_in(
            connection,
            meeting_id,
            person.id,
            PersonLinkSource::Calendar,
            PersonLinkConfidence::Confirmed,
            now_utc_ms,
        )?);
    }
    Ok(changed)
}

pub(in crate::meeting::store) fn derive_speaker_link_in(
    connection: &Connection,
    meeting_id: MeetingSessionId,
    display_name: &str,
    now_utc_ms: i64,
) -> Result<usize, StoreError> {
    let display_name = display_name.trim();
    if display_name.split_whitespace().count() < 2 {
        return Ok(0);
    }
    let mut matches = find_people_by_name_in(connection, display_name)?;
    if matches.len() > 1 {
        return Ok(0);
    }
    let person = matches.pop().unwrap_or_else(|| Person {
        id: PersonId::new(),
        display_name: display_name.to_string(),
        aliases: Vec::new(),
        calendar_emails: Vec::new(),
        created_at_utc_ms: now_utc_ms,
        updated_at_utc_ms: now_utc_ms,
    });
    let identity_changed = insert_person_if_missing_in(connection, &person)?;
    let link_changed = upsert_link_in(
        connection,
        meeting_id,
        person.id,
        PersonLinkSource::Speaker,
        PersonLinkConfidence::Confirmed,
        now_utc_ms,
    )?;
    Ok(usize::from(identity_changed) + usize::from(link_changed))
}

pub(in crate::meeting::store) fn derive_title_links_in(
    connection: &Connection,
    meeting_id: MeetingSessionId,
    title: &str,
    now_utc_ms: i64,
) -> Result<usize, StoreError> {
    let people = all_people_in(connection)?;
    let mut first_names = HashMap::<String, usize>::new();
    for person in &people {
        if let Some(first) = person.display_name.split_whitespace().next() {
            *first_names.entry(normalized(first)).or_default() += 1;
        }
    }
    let mut changed = 0;
    for person in people {
        let full_match = identity_names(&person).any(|name| exact_phrase_mentioned(title, name));
        let first_match = person
            .display_name
            .split_whitespace()
            .next()
            .is_some_and(|first| {
                first_names.get(&normalized(first)) == Some(&1)
                    && exact_phrase_mentioned(title, first)
            });
        if full_match || first_match {
            changed += usize::from(upsert_link_in(
                connection,
                meeting_id,
                person.id,
                PersonLinkSource::Title,
                PersonLinkConfidence::Suggested,
                now_utc_ms,
            )?);
        }
    }
    Ok(changed)
}

pub(in crate::meeting::store) fn link_document_mentions_in(
    connection: &Connection,
    document_id: DocumentId,
    content: &str,
    now_utc_ms: i64,
) -> Result<usize, StoreError> {
    let mut changed = 0;
    for person in all_people_in(connection)? {
        if identity_names(&person).any(|name| exact_phrase_mentioned(content, name)) {
            changed += connection.execute(
                "INSERT OR IGNORE INTO document_person_links
                    (document_id, person_id, created_at_utc_ms) VALUES (?1, ?2, ?3)",
                params![
                    document_id.uuid().to_string(),
                    person.id.uuid().to_string(),
                    now_utc_ms
                ],
            )?;
        }
    }
    Ok(changed)
}

fn insert_person_if_missing_in(
    connection: &Connection,
    person: &Person,
) -> Result<bool, StoreError> {
    let changed = connection.execute(
        "INSERT OR IGNORE INTO persons (
            id, display_name, aliases_json, calendar_emails_json,
            created_at_utc_ms, updated_at_utc_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            person.id.uuid().to_string(),
            person.display_name,
            encode_strings(&person.aliases)?,
            encode_strings(&person.calendar_emails)?,
            person.created_at_utc_ms,
            person.updated_at_utc_ms
        ],
    )? != 0;
    Ok(changed)
}

fn find_person_by_email_in(
    connection: &Connection,
    email: &str,
) -> Result<Option<Person>, StoreError> {
    Ok(all_people_in(connection)?.into_iter().find(|person| {
        person
            .calendar_emails
            .iter()
            .any(|candidate| normalized_email(candidate) == email)
    }))
}

fn find_people_by_name_in(connection: &Connection, name: &str) -> Result<Vec<Person>, StoreError> {
    let name = normalized(name);
    Ok(all_people_in(connection)?
        .into_iter()
        .filter(|person| identity_names(person).any(|candidate| normalized(candidate) == name))
        .collect())
}

fn save_calendar_identity_in(
    connection: &Connection,
    mut person: Person,
    attendee: &CalendarAttendee,
    email: &str,
    now_utc_ms: i64,
) -> Result<(Person, bool), StoreError> {
    if person_by_id_in(connection, person.id).is_err() {
        if person.display_name.is_empty() {
            person.display_name = email.to_string();
        }
        let changed = insert_person_if_missing_in(connection, &person)?;
        return Ok((person, changed));
    }
    let mut changed =
        merge_unique_case_insensitive(&mut person.calendar_emails, [email.to_string()]);
    if !attendee.name.trim().is_empty()
        && normalized(&person.display_name) != normalized(&attendee.name)
    {
        changed |= merge_unique_case_insensitive(&mut person.aliases, [attendee.name.clone()]);
    }
    if changed {
        connection.execute(
            "UPDATE persons SET aliases_json = ?1, calendar_emails_json = ?2,
                    updated_at_utc_ms = ?3 WHERE id = ?4",
            params![
                encode_strings(&person.aliases)?,
                encode_strings(&person.calendar_emails)?,
                now_utc_ms,
                person.id.uuid().to_string()
            ],
        )?;
    }
    Ok((person, changed))
}
