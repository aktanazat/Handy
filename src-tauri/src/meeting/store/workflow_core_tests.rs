use super::people::calendar_context_in;
use super::people::{derive_calendar_links_in, derive_speaker_link_in, derive_title_links_in};
use super::*;
use crate::meeting::detection::machine::{CalendarAttendee, ParticipationStatus};
use crate::meeting::people_types::{
    PersonId, PersonLinkConfidence, PersonLinkSource, PersonSplitRequest, PersonSplitTarget,
};
use crate::meeting::workflow_types::{NewWorkflowEvent, WorkflowEventKind, WorkflowId};
use crate::secrets::SecretManager;
use rusqlite::params;
use std::sync::Arc;
use tempfile::TempDir;
use uuid::Uuid;

/// The learning-inputs boundary for tests that are not about the loops: an empty
/// corpus and settings that claim nothing, so a mining pass is a no-op.
pub(super) fn inputs() -> impl crate::meeting::store::learning::LearningInputs {
    crate::meeting::learning::no_inputs()
}

pub(crate) fn store() -> (TempDir, Arc<MeetingStore>) {
    let directory = TempDir::new().unwrap();
    let secrets = SecretManager::with_backend(Arc::new(crate::secrets::MemorySecretBackend::new()));
    let key = tauri::async_runtime::block_on(secrets.meeting_storage_key()).unwrap();
    let store = MeetingStore::open(directory.path().join("meetings"), key).unwrap();
    (directory, store)
}

pub(crate) fn meeting(store: &MeetingStore, title: &str, at_utc_ms: i64) -> MeetingSessionId {
    let id = MeetingSessionId::new();
    store
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO meeting_sessions (
                id, phase, revision, title, origin_kind, preflight_json,
                created_at_utc_ms, started_at_utc_ms, processing_status,
                retention_policy_json
             ) VALUES (?1, 'review_ready', 0, ?2, 'manual', '{}', ?3, ?3, 'pending', 'forever')",
            params![id.uuid().to_string(), title, at_utc_ms],
        )
        .unwrap();
    id
}

pub(super) fn person(
    store: &MeetingStore,
    name: &str,
    aliases: &[&str],
    emails: &[&str],
) -> PersonId {
    let id = PersonId::new();
    let aliases = serde_json::to_string(aliases).unwrap();
    let emails = serde_json::to_string(emails).unwrap();
    store
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO persons (
                id, display_name, aliases_json, calendar_emails_json,
                created_at_utc_ms, updated_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, 1, 1)",
            params![id.uuid().to_string(), name, aliases, emails],
        )
        .unwrap();
    id
}

fn link(
    store: &MeetingStore,
    meeting_id: MeetingSessionId,
    person_id: PersonId,
    source: &str,
    confidence: &str,
) {
    store
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO meeting_person_links (
                meeting_id, person_id, source, confidence, created_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, 1)",
            params![
                meeting_id.uuid().to_string(),
                person_id.uuid().to_string(),
                source,
                confidence
            ],
        )
        .unwrap();
}

fn artifact(store: &MeetingStore, meeting_id: MeetingSessionId, headline: &str) {
    let revision_id = Uuid::new_v4();
    let artifact_id = Uuid::new_v4();
    let content = serde_json::json!({
        "summary": {"text": headline, "citations": []},
        "outline": [],
        "decisions": [],
        "action_items": [],
        "key_questions": [],
        "risks": [],
        "follow_up_draft": {"text": "", "citations": []},
        "ledger": {
            "headline": headline,
            "threads": [{
                "topic": "Ship the integration",
                "state": "open",
                "substantive": true,
                "receipt": {"quote": "", "speaker": null, "t_ms": 0, "citations": []},
                "owner": "Alice Doe"
            }],
            "open_loops": [],
            "commitments": [{
                "who": "Alice Doe",
                "what": "Send the draft",
                "firmness": "firm",
                "receipt": {"quote": "", "speaker": null, "t_ms": 0, "citations": []}
            }],
            "stances": [],
            "caveats": [],
            "receipts": {"status": "verified"}
        }
    });
    let connection = store.connection().unwrap();
    connection
        .execute(
            "INSERT INTO meeting_transcript_revisions (
                transcript_revision_id, session_id, engine_id, destination_json,
                source_set_json, language, state, created_at_utc_ms
             ) VALUES (?1, ?2, 'test', '{}', '[]', 'en', 'complete', 1)",
            params![revision_id.to_string(), meeting_id.uuid().to_string()],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO meeting_artifact_revisions (
                artifact_id, session_id, transcript_revision_id, input_revision,
                template_id, template_version, generation_key, state,
                content_json, generated_at_utc_ms
             ) VALUES (?1, ?2, ?3, 0, 'test', 1, ?4, 'current', ?5, 1)",
            params![
                artifact_id.to_string(),
                meeting_id.uuid().to_string(),
                revision_id.to_string(),
                format!("test-{artifact_id}"),
                content.to_string()
            ],
        )
        .unwrap();
}

pub(super) fn transcript(store: &MeetingStore, meeting_id: MeetingSessionId, text: &str) {
    let plan_id = Uuid::new_v4();
    let track_id = Uuid::new_v4();
    let speaker_id = Uuid::new_v4();
    let revision_id = Uuid::new_v4();
    let connection = store.connection().unwrap();
    connection
        .execute(
            "INSERT INTO meeting_run_plans (
                plan_id, session_id, attempt_number, schema_version, consent_id,
                canonical_plan_json, created_at_utc_ms
             ) VALUES (?1, ?2, 1, 1, ?3, '{}', 1)",
            params![
                plan_id.to_string(),
                meeting_id.uuid().to_string(),
                Uuid::new_v4().to_string()
            ],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO meeting_source_tracks (
                track_id, session_id, plan_id, source_kind, required, requested,
                descriptor_json, timestamp_bridge_json, health
             ) VALUES (?1, ?2, ?3, 'microphone', 1, 1, '{}', '{}', 'healthy')",
            params![
                track_id.to_string(),
                meeting_id.uuid().to_string(),
                plan_id.to_string()
            ],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO meeting_speakers (
                speaker_id, session_id, source_kind, display_name, revision
             ) VALUES (?1, ?2, 'local', 'Speaker 1', 0)",
            params![speaker_id.to_string(), meeting_id.uuid().to_string()],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO meeting_transcript_revisions (
                transcript_revision_id, session_id, engine_id, destination_json,
                source_set_json, language, state, created_at_utc_ms
             ) VALUES (?1, ?2, 'test', '{}', '[]', 'en', 'complete', 1)",
            params![revision_id.to_string(), meeting_id.uuid().to_string()],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO meeting_transcript_segments (
                segment_id, transcript_revision_id, track_id, ordinal,
                start_offset_ns, end_offset_ns, speaker_id, base_text
             ) VALUES (?1, ?2, ?3, 0, 0, 1, ?4, ?5)",
            params![
                Uuid::new_v4().to_string(),
                revision_id.to_string(),
                track_id.to_string(),
                speaker_id.to_string(),
                text
            ],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE meeting_sessions SET current_transcript_revision_id = ?1 WHERE id = ?2",
            params![revision_id.to_string(), meeting_id.uuid().to_string()],
        )
        .unwrap();
}

pub(super) fn event(
    kind: WorkflowEventKind,
    payload: serde_json::Value,
    dedupe_key: &str,
) -> NewWorkflowEvent {
    NewWorkflowEvent {
        kind,
        payload,
        occurred_at_utc_ms: 10,
        source: "test",
        dedupe_key: dedupe_key.to_string(),
    }
}

#[test]
fn link_derivation_respects_evidence_strength() {
    let (_directory, store) = store();
    let calendar_meeting = meeting(&store, "Calendar", 1);
    let speaker_meeting = meeting(&store, "Speaker", 2);
    let title_meeting = meeting(&store, "1:1 with Charlie", 3);
    let calendar_person = person(&store, "Alice Doe", &[], &["alice@example.com"]);
    let speaker_person = person(&store, "Bob Smith", &[], &[]);
    let title_person = person(&store, "Charlie Brown", &[], &[]);
    let attendee = CalendarAttendee {
        name: "Alice Doe".to_string(),
        email: Some("ALICE@example.com".to_string()),
        status: ParticipationStatus::Accepted,
        is_self: false,
    };
    let connection = store.connection().unwrap();
    derive_calendar_links_in(&connection, calendar_meeting, &[attendee], 10).unwrap();
    derive_speaker_link_in(&connection, speaker_meeting, "Bob Smith", 10).unwrap();
    derive_title_links_in(&connection, title_meeting, "1:1 with Charlie", 10).unwrap();
    for (meeting_id, person_id, source, confidence) in [
        (calendar_meeting, calendar_person, "calendar", "confirmed"),
        (speaker_meeting, speaker_person, "speaker", "confirmed"),
        (title_meeting, title_person, "title", "suggested"),
    ] {
        let row: (String, String) = connection
            .query_row(
                "SELECT source, confidence FROM meeting_person_links
                  WHERE meeting_id = ?1 AND person_id = ?2",
                params![meeting_id.uuid().to_string(), person_id.uuid().to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, (source.to_string(), confidence.to_string()));
    }
    assert_eq!(
        derive_speaker_link_in(&connection, speaker_meeting, "Bob", 10).unwrap(),
        0
    );
}

#[test]
fn meeting_deletion_cascades_links_without_deleting_people() {
    let (_directory, store) = store();
    let meeting_id = meeting(&store, "Cascade", 1);
    let person_id = person(&store, "Alice Doe", &[], &[]);
    link(&store, meeting_id, person_id, "manual", "confirmed");
    let connection = store.connection().unwrap();
    connection
        .execute(
            "DELETE FROM meeting_sessions WHERE id = ?1",
            [meeting_id.uuid().to_string()],
        )
        .unwrap();
    let links: i64 = connection
        .query_row("SELECT COUNT(*) FROM meeting_person_links", [], |row| {
            row.get(0)
        })
        .unwrap();
    let people: i64 = connection
        .query_row("SELECT COUNT(*) FROM persons", [], |row| row.get(0))
        .unwrap();
    assert_eq!((links, people), (0, 1));
}

#[test]
fn merge_repoints_links_and_unions_identity() {
    let (_directory, store) = store();
    let meeting_id = meeting(&store, "Merge", 1);
    let source = person(&store, "Alice Jones", &["AJ"], &["aj@example.com"]);
    let target = person(&store, "Alice Doe", &["Al"], &["alice@example.com"]);
    link(&store, meeting_id, source, "speaker", "confirmed");
    store.merge_persons(source, target, 0, 10).unwrap();
    let detail = store.person_detail(target).unwrap().detail;
    assert!(detail.person.aliases.contains(&"Alice Jones".to_string()));
    assert!(detail.person.aliases.contains(&"AJ".to_string()));
    assert!(detail
        .person
        .calendar_emails
        .contains(&"aj@example.com".to_string()));
    assert_eq!(detail.links.len(), 1);
    assert_eq!(detail.links[0].source, PersonLinkSource::Speaker);
    assert_eq!(detail.links[0].confidence, PersonLinkConfidence::Confirmed);
    assert!(matches!(
        store.person_detail(source),
        Err(StoreError::NotFound)
    ));
}

#[test]
fn context_degrades_to_counts_and_adds_ledger_facts_when_present() {
    let (_directory, store) = store();
    let person_id = person(&store, "Alice Doe", &[], &[]);
    let old = meeting(&store, "Old", 1);
    let recent = meeting(&store, "Recent", 2);
    link(&store, old, person_id, "manual", "confirmed");
    link(&store, recent, person_id, "manual", "confirmed");
    artifact(&store, recent, "Latest headline");
    let row = store.person_context(&[person_id]).unwrap().rows.remove(0);
    assert_eq!(row.meetings_count, 2);
    assert_eq!(
        row.last.unwrap().headline.as_deref(),
        Some("Latest headline")
    );
    assert_eq!(row.open_loops[0].text, "Ship the integration");
    assert_eq!(row.commitments[0].text, "Send the draft");
}

#[test]
fn inbox_omits_loops_after_their_meeting_is_deleted() {
    let (_directory, store) = store();
    let meeting_id = meeting(&store, "Inbox", 1);
    artifact(&store, meeting_id, "Open work");
    store
        .record_and_run_workflow_event(
            event(
                WorkflowEventKind::MeetingFinalized,
                serde_json::json!({
                    "session_id": meeting_id.uuid().to_string(),
                    "known_vocabulary": []
                }),
                "inbox-finalized",
            ),
            &inputs(),
        )
        .unwrap();
    assert_eq!(store.open_loops_inbox(5).unwrap().entries.len(), 1);
    let workflow_revision = store.workflows_list().unwrap().revision;
    let disabled = store
        .set_workflow_enabled(WorkflowId::Continuity, false, workflow_revision)
        .unwrap();
    assert!(store.open_loops_inbox(5).unwrap().entries.is_empty());
    store
        .set_workflow_enabled(WorkflowId::Continuity, true, disabled.revision)
        .unwrap();
    assert_eq!(store.open_loops_inbox(5).unwrap().entries.len(), 1);
    store
        .connection()
        .unwrap()
        .execute(
            "DELETE FROM meeting_sessions WHERE id = ?1",
            [meeting_id.uuid().to_string()],
        )
        .unwrap();
    assert!(store.open_loops_inbox(5).unwrap().entries.is_empty());
}

#[test]
fn calendar_context_matches_known_people_by_exact_email() {
    let (_directory, store) = store();
    let meeting_id = meeting(&store, "Prior", 1);
    let person_id = person(&store, "Alice Doe", &[], &["alice@example.com"]);
    link(&store, meeting_id, person_id, "calendar", "confirmed");
    let rows = calendar_context_in(
        &store.connection().unwrap(),
        &[
            CalendarAttendee {
                name: "Alice Doe".to_string(),
                email: Some("ALICE@example.com".to_string()),
                status: ParticipationStatus::Accepted,
                is_self: false,
            },
            CalendarAttendee {
                name: "Current User".to_string(),
                email: Some("self@example.com".to_string()),
                status: ParticipationStatus::Accepted,
                is_self: true,
            },
        ],
    )
    .unwrap()
    .rows;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].person_id, person_id);
    assert_eq!(rows[0].meetings_count, 1);
}

#[test]
fn person_split_moves_only_selected_evidence_without_data_loss() {
    let (_directory, store) = store();
    let source_id = person(
        &store,
        "Combined Person",
        &["Alice Alias"],
        &["alice@example.com"],
    );
    let first = meeting(&store, "First", 10);
    let second = meeting(&store, "Second", 20);
    link(&store, first, source_id, "manual", "confirmed");
    link(&store, second, source_id, "manual", "confirmed");
    artifact(&store, first, "First headline");
    let document = store
        .ingest_document(
            MeetingOperationId::new(),
            "Plan".to_string(),
            "plan.md".to_string(),
            "text/markdown".to_string(),
            "Private notes".to_string(),
            30,
        )
        .unwrap()
        .document
        .unwrap();
    store
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO document_person_links(document_id, person_id, created_at_utc_ms)
             VALUES (?1, ?2, 30)",
            params![
                document.summary.id.uuid().to_string(),
                source_id.uuid().to_string()
            ],
        )
        .unwrap();

    let revision = store.people_list().unwrap().revision;
    let result = store
        .split_person(
            PersonSplitRequest {
                source_person_id: source_id,
                target: PersonSplitTarget::Create {
                    display_name: "Alice Doe".to_string(),
                },
                meeting_ids: vec![first, second],
                aliases: vec!["Alice Alias".to_string()],
                calendar_emails: vec!["alice@example.com".to_string()],
                document_ids: vec![document.summary.id],
                expected_revision: revision,
            },
            40,
        )
        .unwrap();
    let target = result.person.unwrap();

    let source = store.person_detail(source_id).unwrap().detail;
    let target_detail = store.person_detail(target.id).unwrap().detail;
    assert!(source.person.aliases.is_empty());
    assert!(source.person.calendar_emails.is_empty());
    assert!(source.links.is_empty());
    assert!(source.documents.is_empty());
    assert_eq!(target_detail.person.aliases, vec!["Alice Alias"]);
    assert_eq!(
        target_detail.person.calendar_emails,
        vec!["alice@example.com"]
    );
    assert_eq!(target_detail.links.len(), 2);
    assert_eq!(target_detail.documents.len(), 1);

    let list_entry = store
        .people_list()
        .unwrap()
        .entries
        .into_iter()
        .find(|entry| entry.person.id == target.id)
        .unwrap();
    assert_eq!(list_entry.confirmed_count, 2);
    assert_eq!(list_entry.suggested_count, 0);
    assert_eq!(list_entry.evidence_sources, vec![PersonLinkSource::Manual]);
    assert_eq!(list_entry.last_meeting.unwrap().session_id, second);

    let context = store.meeting_people_context(second).unwrap();
    assert_eq!(context.rows.len(), 1);
    assert_eq!(context.rows[0].person_id, target.id);
    assert_eq!(context.rows[0].meetings_together, 2);
    assert_eq!(
        context.rows[0].last_prior_meeting.as_ref().unwrap().id,
        first
    );
    assert_eq!(
        context.rows[0].top_open_loop.as_ref().unwrap().text,
        "Ship the integration"
    );
}
