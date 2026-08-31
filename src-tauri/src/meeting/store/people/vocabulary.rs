use super::{all_people_in, identity_names, normalized, people_revision_in, SCHEMA_VERSION};
use crate::meeting::learning_types::LearningLoopKind;
use crate::meeting::people_types::{VocabularyCandidate, VocabularyCandidatesResult};
use crate::meeting::store::learning::decided_keys_in;
use crate::meeting::store::workflows::workflow_has_successful_run_in;
use crate::meeting::store::{effective_segments_for_session, MeetingStore, StoreError};
use crate::meeting::types::MeetingSessionId;
use crate::meeting::workflow_types::WorkflowId;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

impl MeetingStore {
    pub(crate) fn vocabulary_candidates(
        &self,
        known_terms: &[String],
    ) -> Result<VocabularyCandidatesResult, StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let revision = people_revision_in(&transaction)?;
        let entries = if workflow_has_successful_run_in(&transaction, WorkflowId::VocabularyMining)?
        {
            vocabulary_candidates_in(&transaction, known_terms)?
        } else {
            Vec::new()
        };
        let result = VocabularyCandidatesResult {
            schema_version: SCHEMA_VERSION,
            revision,
            entries,
        };
        transaction.commit()?;
        Ok(result)
    }
}

pub(in crate::meeting::store) fn vocabulary_candidates_in(
    connection: &Connection,
    known_terms: &[String],
) -> Result<Vec<VocabularyCandidate>, StoreError> {
    let excluded = excluded_terms(connection, known_terms)?;
    let mut statement = connection.prepare(
        "SELECT id FROM meeting_sessions
          WHERE current_transcript_revision_id IS NOT NULL
          ORDER BY created_at_utc_ms, id",
    )?;
    let sessions = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    let mut counts = HashMap::<String, CandidateCount>::new();
    for session in sessions {
        let session_id = Uuid::parse_str(&session)
            .map(MeetingSessionId::from_uuid)
            .map_err(|_| StoreError::Corrupt)?;
        let mut text = String::new();
        for segment in effective_segments_for_session(connection, session_id)? {
            if segment.removed {
                continue;
            }
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(
                segment
                    .replacement_text
                    .as_deref()
                    .unwrap_or(&segment.base.text),
            );
        }
        for candidate in candidates_in_text(&text) {
            let key = normalized(&candidate);
            if key.is_empty() || excluded.contains(&key) {
                continue;
            }
            let count = counts.entry(key).or_insert_with(|| CandidateCount {
                display: candidate,
                occurrences: 0,
                meetings: HashSet::new(),
            });
            count.occurrences = count.occurrences.saturating_add(1);
            count.meetings.insert(session_id);
        }
    }

    let mut candidates = counts
        .into_values()
        .filter(|candidate| candidate.occurrences >= 3 && candidate.meetings.len() >= 2)
        .map(|candidate| {
            Ok(VocabularyCandidate {
                text: candidate.display,
                occurrences: candidate.occurrences,
                meetings_count: u64::try_from(candidate.meetings.len())
                    .map_err(|_| StoreError::Corrupt)?,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    candidates.sort_by(|left, right| {
        right
            .occurrences
            .cmp(&left.occurrences)
            .then_with(|| left.text.cmp(&right.text))
    });
    Ok(candidates)
}

struct CandidateCount {
    display: String,
    occurrences: u64,
    meetings: HashSet<MeetingSessionId>,
}

/// Terms this list must not offer: what the user already has, who Sona already
/// knows about, and — the reason this reads the store rather than a client's
/// local storage — every term the user has already answered about.
fn excluded_terms(
    connection: &Connection,
    known_terms: &[String],
) -> Result<HashSet<String>, StoreError> {
    let mut excluded = known_terms
        .iter()
        .map(|term| normalized(term))
        .collect::<HashSet<_>>();
    for person in all_people_in(connection)? {
        excluded.extend(identity_names(&person).map(normalized));
    }
    excluded.extend(decided_keys_in(
        connection,
        LearningLoopKind::VocabularyTerm,
    )?);
    Ok(excluded)
}

fn candidates_in_text(text: &str) -> Vec<String> {
    let tokens = text
        .split_whitespace()
        .filter_map(clean_token)
        .collect::<Vec<_>>();
    let mut candidates = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        if !is_capitalized(&tokens[index]) {
            index += 1;
            continue;
        }
        let start = index;
        while index < tokens.len() && is_capitalized(&tokens[index]) {
            index += 1;
        }
        let run = &tokens[start..index];
        for chunk in run.chunks(3) {
            if chunk.len() == 1 && is_sentence_word(&chunk[0]) {
                continue;
            }
            candidates.push(chunk.join(" "));
        }
    }
    candidates
}

fn clean_token(token: &str) -> Option<String> {
    let token = token
        .trim_matches(|character: char| !character.is_alphanumeric())
        .chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, '-' | '\''))
        .collect::<String>();
    (!token.is_empty()).then_some(token)
}

fn is_capitalized(token: &str) -> bool {
    token.chars().next().is_some_and(char::is_uppercase) && token.chars().any(char::is_alphabetic)
}

fn is_sentence_word(token: &str) -> bool {
    matches!(
        token.to_ascii_lowercase().as_str(),
        "a" | "an"
            | "and"
            | "but"
            | "how"
            | "i"
            | "if"
            | "it"
            | "so"
            | "that"
            | "the"
            | "this"
            | "we"
            | "what"
            | "when"
            | "why"
            | "you"
    )
}
