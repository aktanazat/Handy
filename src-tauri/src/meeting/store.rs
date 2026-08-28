use super::capture::SessionClock;
use super::cloud_bundle;
use super::types::*;
use crate::analytics::{DashboardTrendRequest, LocalCalendarRange};
use crate::secrets::MeetingStorageKey;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use chrono::{DateTime, Local};
use hkdf::Hkdf;
use rusqlite::{
    params, params_from_iter, Connection, OptionalExtension, Transaction, TransactionBehavior,
};
use rusqlite_migration::{Migrations, M};
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use uuid::Uuid;
use zeroize::Zeroizing;

pub const STORE_SCHEMA_VERSION: u32 = 2;
const RECORD_FORMAT_VERSION: u8 = 1;
const RECORD_MAGIC: [u8; 4] = *b"SMR1";
const RECORD_HEADER_BYTES: usize = 92;
const INDEX_PLAINTEXT_BYTES: usize = 48;
const INDEX_RECORD_BYTES: usize = 76;
const MISSING_OFFSET: u64 = u64::MAX;

static MIGRATIONS: &[M] = &[
    M::up(
        "
        CREATE TABLE meeting_sessions (
            id TEXT PRIMARY KEY NOT NULL,
            phase TEXT NOT NULL CHECK (phase IN (
                'preflight', 'starting', 'capturing_recording', 'capturing_pausing',
                'capturing_paused', 'capturing_resuming', 'stopping', 'processing',
                'review_ready', 'recovery_required', 'deleting'
            )),
            revision INTEGER NOT NULL CHECK (revision >= 0),
            title TEXT NOT NULL,
            origin_kind TEXT NOT NULL,
            preflight_json TEXT NOT NULL,
            created_at_utc_ms INTEGER NOT NULL,
            started_at_utc_ms INTEGER,
            ended_at_utc_ms INTEGER,
            recovered_at_utc_ms INTEGER,
            successful_plan_id TEXT,
            processing_status TEXT NOT NULL,
            retention_policy_json TEXT NOT NULL,
            delete_after_utc_ms INTEGER,
            current_transcript_revision_id TEXT
        );
        CREATE TABLE meeting_session_events (
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL,
            prior_phase TEXT,
            next_phase TEXT NOT NULL,
            event_kind TEXT NOT NULL,
            observed_at_utc_ms INTEGER NOT NULL,
            session_offset_ns INTEGER,
            details_json TEXT NOT NULL,
            PRIMARY KEY (session_id, sequence)
        );
        CREATE TABLE meeting_run_plans (
            plan_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
            schema_version INTEGER NOT NULL,
            consent_id TEXT NOT NULL,
            canonical_plan_json TEXT NOT NULL,
            created_at_utc_ms INTEGER NOT NULL,
            UNIQUE (session_id, attempt_number)
        );
        CREATE TRIGGER meeting_run_plans_immutable
        BEFORE UPDATE ON meeting_run_plans
        BEGIN SELECT RAISE(ABORT, 'meeting run plans are immutable'); END;
        CREATE TABLE meeting_consents (
            consent_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
            preflight_revision INTEGER NOT NULL,
            policy_version INTEGER NOT NULL,
            acknowledgement_json TEXT NOT NULL,
            acknowledged_at_utc_ms INTEGER NOT NULL,
            UNIQUE (session_id, attempt_number)
        );
        CREATE TRIGGER meeting_consents_immutable
        BEFORE UPDATE ON meeting_consents
        BEGIN SELECT RAISE(ABORT, 'meeting consents are immutable'); END;
        CREATE TABLE meeting_capture_windows (
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL,
            start_offset_ns INTEGER NOT NULL CHECK (start_offset_ns >= 0),
            end_offset_ns INTEGER,
            close_reason TEXT,
            PRIMARY KEY (session_id, sequence)
        );
        CREATE TABLE meeting_source_tracks (
            track_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            plan_id TEXT NOT NULL REFERENCES meeting_run_plans(plan_id) ON DELETE CASCADE,
            source_kind TEXT NOT NULL CHECK (source_kind IN ('microphone', 'system_audio')),
            required INTEGER NOT NULL,
            requested INTEGER NOT NULL,
            descriptor_json TEXT NOT NULL,
            timestamp_bridge_json TEXT NOT NULL,
            format_json TEXT,
            first_offset_ns INTEGER,
            last_offset_ns INTEGER,
            health TEXT NOT NULL,
            UNIQUE (session_id, source_kind)
        );
        CREATE TABLE meeting_source_clock_epochs (
            track_id TEXT NOT NULL REFERENCES meeting_source_tracks(track_id) ON DELETE CASCADE,
            source_epoch INTEGER NOT NULL,
            format_epoch INTEGER NOT NULL,
            bridge_json TEXT NOT NULL,
            observed_host_monotonic_ns INTEGER NOT NULL,
            PRIMARY KEY (track_id, source_epoch, format_epoch)
        );
        CREATE TABLE meeting_track_records (
            track_id TEXT NOT NULL REFERENCES meeting_source_tracks(track_id) ON DELETE CASCADE,
            source_sequence INTEGER NOT NULL,
            source_epoch INTEGER NOT NULL,
            start_offset_ns INTEGER,
            duration_ns INTEGER NOT NULL CHECK (duration_ns >= 0),
            frame_count INTEGER NOT NULL CHECK (frame_count >= 0),
            record_offset_bytes INTEGER NOT NULL CHECK (record_offset_bytes >= 0),
            record_bytes INTEGER NOT NULL CHECK (record_bytes > 0),
            durable_at_utc_ms INTEGER NOT NULL,
            PRIMARY KEY (track_id, source_sequence)
        );
        CREATE TABLE meeting_track_checkpoints (
            track_id TEXT PRIMARY KEY NOT NULL REFERENCES meeting_source_tracks(track_id) ON DELETE CASCADE,
            next_sequence INTEGER NOT NULL,
            durable_offset_ns INTEGER,
            durable_bytes INTEGER NOT NULL,
            updated_at_utc_ms INTEGER NOT NULL
        );
        CREATE TABLE meeting_source_gaps (
            gap_id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id TEXT NOT NULL REFERENCES meeting_source_tracks(track_id) ON DELETE CASCADE,
            source_epoch INTEGER NOT NULL,
            start_offset_ns INTEGER,
            end_offset_ns INTEGER,
            reason TEXT NOT NULL,
            dropped_frames INTEGER,
            observed_at_utc_ms INTEGER NOT NULL,
            details_json TEXT NOT NULL
        );
        CREATE TABLE meeting_operation_receipts (
            operation_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT,
            receipt_json TEXT NOT NULL,
            created_at_utc_ms INTEGER NOT NULL
        );
        CREATE TABLE meeting_retention_policy (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            policy_json TEXT NOT NULL,
            revision INTEGER NOT NULL
        );
        INSERT INTO meeting_retention_policy(singleton, policy_json, revision)
        VALUES (1, '{\"kind\":\"delete_after_days\",\"days\":30}', 0);
        CREATE TABLE meeting_deletion_jobs (
            job_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL,
            cause TEXT NOT NULL,
            live_relative_path TEXT NOT NULL,
            trash_relative_path TEXT NOT NULL,
            state TEXT NOT NULL,
            created_at_utc_ms INTEGER NOT NULL,
            updated_at_utc_ms INTEGER NOT NULL
        );
        CREATE TABLE meeting_deletion_receipts (
            job_id TEXT PRIMARY KEY NOT NULL,
            cause TEXT NOT NULL,
            completed_at_utc_ms INTEGER NOT NULL
        );
        CREATE INDEX meeting_sessions_created_idx ON meeting_sessions(created_at_utc_ms DESC);
        CREATE INDEX meeting_session_events_session_idx ON meeting_session_events(session_id, sequence);
        CREATE INDEX meeting_tracks_session_idx ON meeting_source_tracks(session_id, source_kind);
        CREATE INDEX meeting_records_track_idx ON meeting_track_records(track_id, source_sequence);
        CREATE INDEX meeting_gaps_track_idx ON meeting_source_gaps(track_id, gap_id);
        CREATE INDEX meeting_deletion_jobs_state_idx ON meeting_deletion_jobs(state);
        ",
    ),
    M::up(
        "
        CREATE TABLE meeting_speakers (
            speaker_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            source_kind TEXT NOT NULL,
            display_name TEXT NOT NULL,
            revision INTEGER NOT NULL,
            merged_into_speaker_id TEXT
        );
        CREATE TABLE meeting_transcript_revisions (
            transcript_revision_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            engine_id TEXT NOT NULL,
            model_version TEXT,
            destination_json TEXT NOT NULL,
            source_set_json TEXT NOT NULL,
            language TEXT NOT NULL,
            state TEXT NOT NULL,
            created_at_utc_ms INTEGER NOT NULL,
            completed_at_utc_ms INTEGER,
            error_code TEXT
        );
        CREATE TABLE meeting_transcript_segments (
            segment_id TEXT PRIMARY KEY NOT NULL,
            transcript_revision_id TEXT NOT NULL REFERENCES meeting_transcript_revisions(transcript_revision_id) ON DELETE CASCADE,
            track_id TEXT NOT NULL REFERENCES meeting_source_tracks(track_id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            start_offset_ns INTEGER NOT NULL,
            end_offset_ns INTEGER NOT NULL,
            speaker_id TEXT NOT NULL REFERENCES meeting_speakers(speaker_id) ON DELETE RESTRICT,
            base_text TEXT NOT NULL,
            confidence_milli INTEGER,
            UNIQUE (transcript_revision_id, ordinal)
        );
        CREATE TRIGGER meeting_transcript_segments_immutable
        BEFORE UPDATE ON meeting_transcript_segments
        BEGIN SELECT RAISE(ABORT, 'meeting transcript segments are immutable'); END;
        CREATE TABLE meeting_segment_edits (
            segment_id TEXT NOT NULL REFERENCES meeting_transcript_segments(segment_id) ON DELETE CASCADE,
            edit_sequence INTEGER NOT NULL,
            replacement_text TEXT NOT NULL,
            removed INTEGER NOT NULL,
            operator_at_utc_ms INTEGER NOT NULL,
            PRIMARY KEY (segment_id, edit_sequence)
        );
        CREATE TABLE meeting_notes (
            note_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            start_offset_ns INTEGER,
            end_offset_ns INTEGER,
            body TEXT NOT NULL,
            note_revision INTEGER NOT NULL,
            created_at_utc_ms INTEGER NOT NULL,
            updated_at_utc_ms INTEGER NOT NULL
        );
        CREATE TABLE meeting_artifacts (
            artifact_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            transcript_revision_id TEXT,
            input_revision INTEGER NOT NULL,
            state TEXT NOT NULL,
            created_at_utc_ms INTEGER NOT NULL
        );
        CREATE TABLE meeting_search_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            entity_kind TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            content TEXT NOT NULL,
            UNIQUE (session_id, entity_kind, entity_id)
        );
        CREATE VIRTUAL TABLE meeting_search_fts USING fts5(
            content,
            content='meeting_search_documents',
            content_rowid='id'
        );
        CREATE TRIGGER meeting_search_documents_insert AFTER INSERT ON meeting_search_documents BEGIN
            INSERT INTO meeting_search_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER meeting_search_documents_delete AFTER DELETE ON meeting_search_documents BEGIN
            INSERT INTO meeting_search_fts(meeting_search_fts, rowid, content)
            VALUES ('delete', old.id, old.content);
        END;
        CREATE TRIGGER meeting_search_documents_update AFTER UPDATE OF content ON meeting_search_documents BEGIN
            INSERT INTO meeting_search_fts(meeting_search_fts, rowid, content)
            VALUES ('delete', old.id, old.content);
            INSERT INTO meeting_search_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TABLE meeting_questions (
            question_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            question_text TEXT NOT NULL,
            answer_state TEXT NOT NULL,
            answer_text TEXT,
            revision INTEGER NOT NULL,
            created_at_utc_ms INTEGER NOT NULL
        );
        CREATE TABLE meeting_question_citations (
            question_id TEXT NOT NULL REFERENCES meeting_questions(question_id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            citation_json TEXT NOT NULL,
            PRIMARY KEY (question_id, ordinal)
        );
        CREATE TABLE meeting_remote_jobs (
            job_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT,
            destination_id TEXT NOT NULL,
            non_secret_reference TEXT,
            state TEXT NOT NULL,
            cancellation_requested INTEGER NOT NULL,
            created_at_utc_ms INTEGER NOT NULL,
            updated_at_utc_ms INTEGER NOT NULL
        );
        CREATE TABLE meeting_export_receipts (
            export_receipt_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            format TEXT NOT NULL,
            snapshot_revision INTEGER NOT NULL,
            capture_completeness TEXT NOT NULL,
            transcript_revision_id TEXT,
            created_at_utc_ms INTEGER NOT NULL
        );
        CREATE INDEX meeting_segments_revision_idx ON meeting_transcript_segments(transcript_revision_id, ordinal);
        CREATE INDEX meeting_notes_session_idx ON meeting_notes(session_id, updated_at_utc_ms);
        CREATE INDEX meeting_questions_session_idx ON meeting_questions(session_id, created_at_utc_ms);
        ",
    ),
    M::up(
        "
        ALTER TABLE meeting_sessions ADD COLUMN current_diarization_generation_id TEXT;
        ALTER TABLE meeting_sessions ADD COLUMN diarization_status TEXT NOT NULL DEFAULT 'not_requested';
        ALTER TABLE meeting_sessions ADD COLUMN diarization_model_id TEXT;
        ALTER TABLE meeting_sessions ADD COLUMN diarization_model_version TEXT;
        ALTER TABLE meeting_questions ADD COLUMN scope_json TEXT NOT NULL DEFAULT '{\"kind\":\"this_meeting\"}';
        ALTER TABLE meeting_questions ADD COLUMN input_revision INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE meeting_artifact_revisions (
            artifact_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            transcript_revision_id TEXT NOT NULL REFERENCES meeting_transcript_revisions(transcript_revision_id) ON DELETE CASCADE,
            input_revision INTEGER NOT NULL,
            template_id TEXT NOT NULL,
            template_version INTEGER NOT NULL,
            generation_key TEXT NOT NULL,
            state TEXT NOT NULL,
            content_json TEXT,
            generated_at_utc_ms INTEGER NOT NULL,
            UNIQUE (session_id, generation_key)
        );
        CREATE TABLE meeting_diarization_generations (
            generation_id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
            transcript_revision_id TEXT NOT NULL REFERENCES meeting_transcript_revisions(transcript_revision_id) ON DELETE CASCADE,
            input_revision INTEGER NOT NULL,
            model_id TEXT NOT NULL,
            model_version TEXT NOT NULL,
            state TEXT NOT NULL,
            created_at_utc_ms INTEGER NOT NULL,
            completed_at_utc_ms INTEGER
        );
        CREATE TABLE meeting_diarization_assignments (
            generation_id TEXT NOT NULL REFERENCES meeting_diarization_generations(generation_id) ON DELETE CASCADE,
            segment_id TEXT NOT NULL REFERENCES meeting_transcript_segments(segment_id) ON DELETE CASCADE,
            speaker_id TEXT NOT NULL REFERENCES meeting_speakers(speaker_id) ON DELETE RESTRICT,
            assignment_kind TEXT NOT NULL,
            PRIMARY KEY (generation_id, segment_id)
        );
        CREATE INDEX meeting_artifact_revisions_session_idx
            ON meeting_artifact_revisions(session_id, generated_at_utc_ms DESC);
        CREATE INDEX meeting_diarization_generations_session_idx
            ON meeting_diarization_generations(session_id, created_at_utc_ms DESC);
        CREATE INDEX meeting_diarization_assignments_segment_idx
            ON meeting_diarization_assignments(segment_id, generation_id);
        ",
    ),
    M::up(
        "
        CREATE TABLE meeting_cloud_state (
            singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
            vault_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            cursor TEXT,
            snapshot_high_water TEXT,
            clock_offset_ms INTEGER NOT NULL,
            paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
            updated_at_utc_ms INTEGER NOT NULL
        );
        CREATE TABLE meeting_cloud_capabilities (
            endpoint TEXT PRIMARY KEY NOT NULL,
            capabilities_json TEXT NOT NULL,
            fetched_at_utc_ms INTEGER NOT NULL
        );
        CREATE TABLE meeting_cloud_heads (
            object_id TEXT PRIMARY KEY NOT NULL,
            source_session_id TEXT,
            remote_revision_id TEXT,
            tombstone INTEGER NOT NULL CHECK (tombstone IN (0, 1)),
            acknowledged_revision_id TEXT,
            change_sequence INTEGER NOT NULL CHECK (change_sequence >= 0),
            updated_at_utc_ms INTEGER NOT NULL
        );
        CREATE TABLE meeting_cloud_outbox (
            outbox_id TEXT PRIMARY KEY NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('object', 'tombstone', 'share')),
            object_id TEXT NOT NULL,
            source_session_id TEXT,
            source_revision INTEGER,
            base_remote_revision_id TEXT,
            share_content_kind TEXT CHECK (share_content_kind IN ('capability_bundle', 'browser_markdown')),
            remote_revision_id TEXT,
            upload_id TEXT,
            idempotency_key TEXT NOT NULL UNIQUE,
            state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'completed', 'cancelled', 'terminal')),
            attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
            next_attempt_utc_ms INTEGER NOT NULL,
            terminal_error TEXT,
            payload_relative_dir TEXT NOT NULL CHECK (payload_relative_dir GLOB '.cloud-outbox/*'),
            claim_token TEXT,
            claimed_at_utc_ms INTEGER,
            created_at_utc_ms INTEGER NOT NULL,
            updated_at_utc_ms INTEGER NOT NULL,
            CHECK ((kind = 'share' AND share_content_kind IS NOT NULL)
                OR (kind != 'share' AND share_content_kind IS NULL))
        );
        CREATE TABLE meeting_cloud_outbox_chunks (
            outbox_id TEXT NOT NULL REFERENCES meeting_cloud_outbox(outbox_id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
            size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
            sha256 TEXT NOT NULL,
            accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
            accepted_at_utc_ms INTEGER,
            PRIMARY KEY (outbox_id, chunk_index)
        );
        CREATE TABLE meeting_cloud_conflicts (
            object_id TEXT PRIMARY KEY NOT NULL,
            source_session_id TEXT,
            source_revision INTEGER,
            remote_revision_id TEXT NOT NULL,
            remote_sequence INTEGER NOT NULL CHECK (remote_sequence >= 0),
            remote_bundle_relative_path TEXT NOT NULL CHECK (remote_bundle_relative_path GLOB '.cloud-conflicts/*'),
            detected_at_utc_ms INTEGER NOT NULL
        );
        CREATE TABLE meeting_cloud_shares (
            share_id TEXT PRIMARY KEY NOT NULL,
            object_id TEXT NOT NULL,
            source_session_id TEXT,
            expires_at_utc_ms INTEGER NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'revoked', 'failed')),
            content_kind TEXT NOT NULL CHECK (content_kind IN ('capability_bundle', 'browser_markdown')),
            encrypted_link_material TEXT NOT NULL,
            outbox_id TEXT,
            revoked_at_utc_ms INTEGER,
            created_at_utc_ms INTEGER NOT NULL,
            updated_at_utc_ms INTEGER NOT NULL
        );
        CREATE INDEX meeting_cloud_heads_session_idx
            ON meeting_cloud_heads(source_session_id, updated_at_utc_ms DESC);
        CREATE INDEX meeting_cloud_outbox_due_idx
            ON meeting_cloud_outbox(state, next_attempt_utc_ms, created_at_utc_ms);
        CREATE INDEX meeting_cloud_outbox_session_idx
            ON meeting_cloud_outbox(source_session_id, state, created_at_utc_ms);
        CREATE INDEX meeting_cloud_conflicts_session_idx
            ON meeting_cloud_conflicts(source_session_id, detected_at_utc_ms DESC);
        CREATE INDEX meeting_cloud_shares_session_idx
            ON meeting_cloud_shares(source_session_id, state, expires_at_utc_ms);
        CREATE TRIGGER meeting_cloud_outbox_intent_immutable
        BEFORE UPDATE ON meeting_cloud_outbox
        WHEN NEW.kind IS NOT OLD.kind
          OR NEW.object_id IS NOT OLD.object_id
          OR NEW.source_session_id IS NOT OLD.source_session_id
          OR NEW.source_revision IS NOT OLD.source_revision
          OR NEW.base_remote_revision_id IS NOT OLD.base_remote_revision_id
          OR NEW.idempotency_key IS NOT OLD.idempotency_key
          OR NEW.payload_relative_dir IS NOT OLD.payload_relative_dir
          OR NEW.created_at_utc_ms IS NOT OLD.created_at_utc_ms
        BEGIN SELECT RAISE(ABORT, 'meeting cloud outbox intent is immutable'); END;
        CREATE TRIGGER meeting_cloud_outbox_chunks_mutable_only_before_claim
        BEFORE INSERT ON meeting_cloud_outbox_chunks
        WHEN (SELECT state FROM meeting_cloud_outbox WHERE outbox_id = NEW.outbox_id) != 'pending'
        BEGIN SELECT RAISE(ABORT, 'meeting cloud chunks must be staged before claim'); END;
        CREATE TRIGGER meeting_cloud_outbox_chunk_metadata_immutable
        BEFORE UPDATE ON meeting_cloud_outbox_chunks
        WHEN NEW.outbox_id IS NOT OLD.outbox_id
          OR NEW.chunk_index IS NOT OLD.chunk_index
          OR NEW.size_bytes IS NOT OLD.size_bytes
          OR NEW.sha256 IS NOT OLD.sha256
        BEGIN SELECT RAISE(ABORT, 'meeting cloud chunk metadata is immutable'); END;
        CREATE TRIGGER meeting_cloud_outbox_chunk_acceptance_monotonic
        BEFORE UPDATE OF accepted ON meeting_cloud_outbox_chunks
        WHEN OLD.accepted = 1 AND NEW.accepted != 1
        BEGIN SELECT RAISE(ABORT, 'meeting cloud chunk acceptance is monotonic'); END;
        ",
    ),

];
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StoreError {
    Unavailable,
    EncryptionUnavailable,
    Corrupt,
    NotFound,
    Conflict,
    Invalid,
    Io,
}
/// The single durable Cloudflare vault cursor and clock state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CloudState {
    pub vault_id: String,
    pub device_id: String,
    pub endpoint: String,
    pub cursor: Option<String>,
    pub snapshot_high_water: Option<String>,
    pub clock_offset_ms: i64,
    pub paused: bool,
}

/// Endpoint-scoped worker capability metadata that must never be reused across endpoints.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CloudCapabilitiesCache {
    pub endpoint: String,
    pub capabilities_json: String,
    pub fetched_at_utc_ms: i64,
}

/// The immutable kind of durable cloud work represented by an outbox row.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CloudOutboxKind {
    Object,
    Tombstone,
    Share,
}

/// The exclusive ownership state of a durable outbox row.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CloudOutboxState {
    Pending,
    Claimed,
    Completed,
    Cancelled,
    Terminal,
}

/// Immutable input used to allocate one uniquely staged cloud outbox row.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CloudOutboxInput {
    pub kind: CloudOutboxKind,
    pub object_id: String,
    pub source_session_id: Option<MeetingSessionId>,
    pub source_revision: Option<u64>,
    pub base_remote_revision_id: Option<String>,
    pub share_content_kind: Option<CloudShareContentKind>,
    pub remote_revision_id: Option<String>,
    pub idempotency_key: String,
    pub next_attempt_utc_ms: i64,
}

/// One durable cloud work item whose intent columns never change after enqueue.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CloudOutboxRecord {
    pub outbox_id: String,
    pub kind: CloudOutboxKind,
    pub object_id: String,
    pub source_session_id: Option<MeetingSessionId>,
    pub source_revision: Option<u64>,
    pub base_remote_revision_id: Option<String>,
    pub share_content_kind: Option<CloudShareContentKind>,
    pub remote_revision_id: Option<String>,
    pub upload_id: Option<String>,
    pub idempotency_key: String,
    pub state: CloudOutboxState,
    pub attempt_count: u32,
    pub next_attempt_utc_ms: i64,
    pub terminal_error: Option<String>,
    pub payload_relative_dir: String,
    pub claim_token: Option<String>,
}

/// Mutable completion data written only by the current outbox claimant.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CloudOutboxUpdate {
    pub state: CloudOutboxState,
    pub remote_revision_id: Option<String>,
    pub upload_id: Option<String>,
    pub terminal_error: Option<String>,
}

/// Immutable chunk metadata with monotonic acceptance acknowledgement.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CloudOutboxChunk {
    pub chunk_index: u32,
    pub size_bytes: u64,
    pub sha256: String,
    pub accepted: bool,
}

/// The last known remote head for one object, independent of local session deletion.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CloudHead {
    pub object_id: String,
    pub source_session_id: Option<MeetingSessionId>,
    pub remote_revision_id: Option<String>,
    pub tombstone: bool,
    pub acknowledged_revision_id: Option<String>,
    pub change_sequence: u64,
}

/// A locally cached remote bundle that blocks automatic conflict resolution.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CloudConflict {
    pub object_id: String,
    pub source_session_id: Option<MeetingSessionId>,
    pub source_revision: Option<u64>,
    pub remote_revision_id: String,
    pub remote_sequence: u64,
    pub remote_bundle_relative_path: String,
}

/// The lifecycle state of opaque share-root material retained only in SQLCipher.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CloudShareState {
    Pending,
    Active,
    Revoked,
    Failed,
}

/// The distinct portable share content contract, never inferred from an outbox payload.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CloudShareContentKind {
    CapabilityBundle,
    BrowserMarkdown,
}

/// Input for a share whose secret link material must never leave encrypted local storage.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CloudShareInput {
    pub share_id: String,
    pub object_id: String,
    pub source_session_id: Option<MeetingSessionId>,
    pub expires_at_utc_ms: i64,
    pub content_kind: CloudShareContentKind,
    pub encrypted_link_material: String,
    pub outbox_id: Option<String>,
}

/// Durable share state and opaque encrypted link material with no derived URL.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CloudShareRecord {
    pub share_id: String,
    pub object_id: String,
    pub source_session_id: Option<MeetingSessionId>,
    pub expires_at_utc_ms: i64,
    pub state: CloudShareState,
    pub content_kind: CloudShareContentKind,
    pub encrypted_link_material: String,
    pub outbox_id: Option<String>,
    pub revoked_at_utc_ms: Option<i64>,
}

/// Mutable share lifecycle fields that do not expose the secret link material.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CloudShareUpdate {
    pub expires_at_utc_ms: i64,
    pub state: CloudShareState,
    pub outbox_id: Option<String>,
    pub revoked_at_utc_ms: Option<i64>,
}

/// Aggregate local work counts used to render cloud status without inspecting payloads.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct CloudStatusCounts {
    pub queued_outbox: u32,
    pub claimed_outbox: u32,
    pub pending_tombstones: u32,
    pub conflicts: u32,
    pub active_shares: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct DueRetentionSession {
    pub session_id: MeetingSessionId,
    pub revision: u64,
}
#[derive(Clone, Copy)]
pub(crate) struct StoreMutation {
    pub operation_id: MeetingOperationId,
    pub requested_at_utc_ms: i64,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
    pub command: MeetingCommandKind,
}

pub(crate) struct StoreTransition<'a> {
    pub operation_id: Option<MeetingOperationId>,
    pub actor: OperationActor,
    pub command: MeetingCommandKind,
    pub requested_at_utc_ms: i64,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
    pub allowed_from: &'a [MeetingPhase],
    pub next_phase: MeetingPhase,
    pub event_kind: &'a str,
    pub reason_codes: Vec<MeetingReasonCode>,
}

pub(crate) struct TrackCreation<'a> {
    pub session_id: MeetingSessionId,
    pub plan_id: MeetingPlanId,
    pub source_kind: SourceKind,
    pub required: bool,
    pub requested: bool,
    pub descriptor_json: &'a str,
    pub report: SourceStartReport,
}

pub(crate) struct SegmentEdit {
    pub mutation: StoreMutation,
    pub segment_id: TranscriptSegmentId,
    pub replacement_text: String,
    pub removed: bool,
}

pub(crate) struct DurableTrackRecord {
    pub track_id: SourceTrackId,
    pub sequence: u64,
    pub source_epoch: SourceEpoch,
    pub start_offset_ns: u64,
    pub duration_ns: u64,
    pub format: AudioFormat,
    pub samples: Vec<f32>,
}

pub(crate) struct TranscriptRevisionInput<'a> {
    pub session_id: MeetingSessionId,
    pub engine_id: &'a str,
    pub model_version: Option<&'a str>,
    pub destination: &'a ProcessingDestination,
    pub source_set: &'a [SourceKind],
    pub language: &'a str,
}

pub(crate) struct TranscriptSegmentInput {
    pub track_id: SourceTrackId,
    pub source_kind: SourceKind,
    pub start_offset_ns: u64,
    pub end_offset_ns: u64,
    pub text: String,
    pub confidence_milli: Option<u16>,
}

pub(crate) struct DiarizationAssignmentInput {
    pub segment_id: TranscriptSegmentId,
    pub speaker_id: SpeakerId,
    pub assignment: SpeakerAssignmentKind,
}

pub(crate) struct ArtifactRevisionInput<'a> {
    pub session_id: MeetingSessionId,
    pub transcript_revision_id: TranscriptRevisionId,
    pub input_revision: u64,
    pub template_id: &'a str,
    pub template_version: u32,
    pub generation_key: &'a str,
    pub state: MeetingArtifactState,
    pub content: Option<&'a GeneratedMeetingArtifacts>,
    pub generated_at_utc_ms: i64,
}

#[derive(Clone, Debug)]
pub(crate) struct MeetingEvidence {
    pub citation: MeetingCitation,
    pub text: String,
}

#[derive(Clone, Debug)]
pub(crate) struct ArtifactEvidence {
    pub transcript: Vec<MeetingEvidence>,
    pub manual_notes: Vec<MeetingEvidence>,
}

impl From<rusqlite::Error> for StoreError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Unavailable
    }
}

impl From<std::io::Error> for StoreError {
    fn from(_: std::io::Error) -> Self {
        Self::Io
    }
}

#[derive(Clone, Copy, Default)]
struct MeetingTrendValues {
    meetings: u64,
    verified_captured_duration_ns: u64,
    transcript_segments: u64,
    generated_action_items: u64,
}

impl MeetingTrendValues {
    fn add(&mut self, other: Self) -> Result<(), StoreError> {
        self.meetings = self
            .meetings
            .checked_add(other.meetings)
            .ok_or(StoreError::Corrupt)?;
        self.verified_captured_duration_ns = self
            .verified_captured_duration_ns
            .checked_add(other.verified_captured_duration_ns)
            .ok_or(StoreError::Corrupt)?;
        self.transcript_segments = self
            .transcript_segments
            .checked_add(other.transcript_segments)
            .ok_or(StoreError::Corrupt)?;
        self.generated_action_items = self
            .generated_action_items
            .checked_add(other.generated_action_items)
            .ok_or(StoreError::Corrupt)?;
        Ok(())
    }

    fn totals(self) -> MeetingTrendTotals {
        MeetingTrendTotals {
            meetings: self.meetings,
            verified_captured_duration_ms: self.verified_captured_duration_ns / 1_000_000,
            transcript_segments: self.transcript_segments,
            generated_action_items: self.generated_action_items,
        }
    }
}

fn meeting_trend_value(value: i64) -> Result<u64, StoreError> {
    u64::try_from(value).map_err(|_| StoreError::Corrupt)
}

pub struct MeetingStore {
    root: PathBuf,
    database_path: PathBuf,
    connection: Mutex<Connection>,
    master_key: Arc<MeetingStorageKey>,
}

impl MeetingStore {
    pub(crate) fn open(
        root: PathBuf,
        master_key: MeetingStorageKey,
    ) -> Result<Arc<Self>, StoreError> {
        ensure_private_directory(&root)?;
        let database_path = root.join("meeting-store.db");
        let mut connection = open_encrypted_connection(&database_path, &master_key)?;
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        #[cfg(debug_assertions)]
        migrations.validate().map_err(|_| StoreError::Corrupt)?;
        migrations
            .to_latest(&mut connection)
            .map_err(|_| StoreError::Unavailable)?;
        configure_connection(&connection)?;
        set_private_file_permissions(&database_path)?;
        Ok(Arc::new(Self {
            root,
            database_path,
            connection: Mutex::new(connection),
            master_key: Arc::new(master_key),
        }))
    }

    pub(crate) fn cloud_state(&self) -> Result<Option<CloudState>, StoreError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT vault_id, device_id, endpoint, cursor, snapshot_high_water,
                        clock_offset_ms, paused
                 FROM meeting_cloud_state WHERE singleton = 1",
                [],
                |row| {
                    Ok(CloudState {
                        vault_id: row.get(0)?,
                        device_id: row.get(1)?,
                        endpoint: row.get(2)?,
                        cursor: row.get(3)?,
                        snapshot_high_water: row.get(4)?,
                        clock_offset_ms: row.get(5)?,
                        paused: row.get::<_, i64>(6)? != 0,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub(crate) fn upsert_cloud_state(&self, state: &CloudState) -> Result<(), StoreError> {
        validate_cloud_state(state)?;
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO meeting_cloud_state (
                singleton, vault_id, device_id, endpoint, cursor, snapshot_high_water,
                clock_offset_ms, paused, updated_at_utc_ms
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(singleton) DO UPDATE SET
                vault_id = excluded.vault_id,
                device_id = excluded.device_id,
                endpoint = excluded.endpoint,
                cursor = excluded.cursor,
                snapshot_high_water = excluded.snapshot_high_water,
                clock_offset_ms = excluded.clock_offset_ms,
                paused = excluded.paused,
                updated_at_utc_ms = excluded.updated_at_utc_ms",
            params![
                state.vault_id,
                state.device_id,
                state.endpoint,
                state.cursor,
                state.snapshot_high_water,
                state.clock_offset_ms,
                bool_to_i64(state.paused),
                utc_now_ms(),
            ],
        )?;
        Ok(())
    }

    pub(crate) fn update_cloud_cursor(
        &self,
        cursor: Option<String>,
        snapshot_high_water: Option<String>,
    ) -> Result<(), StoreError> {
        validate_optional_cloud_text(&cursor)?;
        validate_optional_cloud_text(&snapshot_high_water)?;
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_state
             SET cursor = ?1, snapshot_high_water = ?2, updated_at_utc_ms = ?3
             WHERE singleton = 1",
            params![cursor, snapshot_high_water, utc_now_ms()],
        )?;
        if changed != 1 {
            return Err(StoreError::NotFound);
        }
        Ok(())
    }

    pub(crate) fn set_cloud_clock_offset(&self, clock_offset_ms: i64) -> Result<(), StoreError> {
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_state
             SET clock_offset_ms = ?1, updated_at_utc_ms = ?2 WHERE singleton = 1",
            params![clock_offset_ms, utc_now_ms()],
        )?;
        if changed != 1 {
            return Err(StoreError::NotFound);
        }
        Ok(())
    }

    pub(crate) fn set_cloud_paused(&self, paused: bool) -> Result<(), StoreError> {
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_state
             SET paused = ?1, updated_at_utc_ms = ?2 WHERE singleton = 1",
            params![bool_to_i64(paused), utc_now_ms()],
        )?;
        if changed != 1 {
            return Err(StoreError::NotFound);
        }
        Ok(())
    }

    pub(crate) fn cloud_capabilities(
        &self,
        endpoint: &str,
    ) -> Result<Option<CloudCapabilitiesCache>, StoreError> {
        validate_cloud_text(endpoint)?;
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT endpoint, capabilities_json, fetched_at_utc_ms
                 FROM meeting_cloud_capabilities WHERE endpoint = ?1",
                params![endpoint],
                |row| {
                    Ok(CloudCapabilitiesCache {
                        endpoint: row.get(0)?,
                        capabilities_json: row.get(1)?,
                        fetched_at_utc_ms: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub(crate) fn upsert_cloud_capabilities(
        &self,
        cache: &CloudCapabilitiesCache,
    ) -> Result<(), StoreError> {
        validate_cloud_text(&cache.endpoint)?;
        validate_cloud_text(&cache.capabilities_json)?;
        serde_json::from_str::<serde_json::Value>(&cache.capabilities_json)
            .map_err(|_| StoreError::Invalid)?;
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO meeting_cloud_capabilities (endpoint, capabilities_json, fetched_at_utc_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(endpoint) DO UPDATE SET
                capabilities_json = excluded.capabilities_json,
                fetched_at_utc_ms = excluded.fetched_at_utc_ms",
            params![cache.endpoint, cache.capabilities_json, cache.fetched_at_utc_ms],
        )?;
        Ok(())
    }

    pub(crate) fn cloud_head(&self, object_id: &str) -> Result<Option<CloudHead>, StoreError> {
        validate_cloud_identifier(object_id)?;
        let connection = self.connection()?;
        cloud_head_in(&connection, object_id)
    }
    pub(crate) fn cloud_head_for_session(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<Option<CloudHead>, StoreError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT object_id, source_session_id, remote_revision_id, tombstone,
                        acknowledged_revision_id, change_sequence
                 FROM meeting_cloud_heads
                 WHERE source_session_id = ?1
                 ORDER BY updated_at_utc_ms DESC, object_id DESC LIMIT 1",
                params![id(session_id)],
                cloud_head_from_row,
            )
            .optional()
            .map_err(Into::into)
    }

    pub(crate) fn upsert_cloud_head(&self, head: &CloudHead) -> Result<(), StoreError> {
        validate_cloud_head(head)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let changed = transaction.execute(
            "INSERT INTO meeting_cloud_heads (
                object_id, source_session_id, remote_revision_id, tombstone,
                acknowledged_revision_id, change_sequence, updated_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(object_id) DO UPDATE SET
                source_session_id = excluded.source_session_id,
                remote_revision_id = excluded.remote_revision_id,
                tombstone = excluded.tombstone,
                acknowledged_revision_id = excluded.acknowledged_revision_id,
                change_sequence = excluded.change_sequence,
                updated_at_utc_ms = excluded.updated_at_utc_ms
             WHERE excluded.change_sequence >= meeting_cloud_heads.change_sequence",
            params![
                head.object_id,
                head.source_session_id.map(id),
                head.remote_revision_id,
                bool_to_i64(head.tombstone),
                head.acknowledged_revision_id,
                to_i64(head.change_sequence)?,
                utc_now_ms(),
            ],
        )?;
        if changed == 0 {
            transaction.commit()?;
            return Err(StoreError::Conflict);
        }
        transaction.commit()?;
        Ok(())
    }

    pub(crate) fn enqueue_cloud_outbox(
        &self,
        input: CloudOutboxInput,
    ) -> Result<CloudOutboxRecord, StoreError> {
        validate_cloud_outbox_input(&input)?;
        {
            let connection = self.connection()?;
            if let Some(existing) =
                cloud_outbox_by_idempotency_in(&connection, &input.idempotency_key)?
            {
                return Ok(existing);
            }
        }
        let outbox_id = Uuid::new_v4().to_string();
        let payload_relative_dir = cloud_outbox_relative_dir(&outbox_id);
        let payload_directory =
            validated_cloud_outbox_dir(&self.root, &outbox_id, &payload_relative_dir)?;
        ensure_private_directory(&payload_directory)?;
        let now = utc_now_ms();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        validate_cloud_outbox_source(&transaction, &input)?;
        transaction.execute(
            "INSERT INTO meeting_cloud_outbox (
                outbox_id, kind, object_id, source_session_id, source_revision,
                base_remote_revision_id, share_content_kind, remote_revision_id, upload_id,
                idempotency_key, state, attempt_count, next_attempt_utc_ms, terminal_error,
                payload_relative_dir, claim_token, claimed_at_utc_ms, created_at_utc_ms,
                updated_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, 'pending', 0, ?10,
                       NULL, ?11, NULL, NULL, ?12, ?12)",
            params![
                outbox_id,
                cloud_outbox_kind_to_db(input.kind),
                input.object_id,
                input.source_session_id.map(id),
                input.source_revision.map(to_i64).transpose()?,
                input.base_remote_revision_id,
                input.share_content_kind.map(cloud_share_content_kind_to_db),
                input.remote_revision_id,
                input.idempotency_key,
                input.next_attempt_utc_ms,
                payload_relative_dir,
                now,
            ],
        )?;
        transaction.commit()?;
        cloud_outbox_in(&connection, &outbox_id)?.ok_or(StoreError::Corrupt)
    }

    pub(crate) fn cloud_outbox(
        &self,
        outbox_id: &str,
    ) -> Result<Option<CloudOutboxRecord>, StoreError> {
        validate_cloud_local_id(outbox_id)?;
        let connection = self.connection()?;
        cloud_outbox_in(&connection, outbox_id)
    }
    pub(crate) fn cloud_outboxes_for_session(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<Vec<CloudOutboxRecord>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT outbox_id, kind, object_id, source_session_id, source_revision,
                    base_remote_revision_id, share_content_kind, remote_revision_id, upload_id,
                    idempotency_key, state, attempt_count, next_attempt_utc_ms, terminal_error,
                    payload_relative_dir, claim_token
             FROM meeting_cloud_outbox
             WHERE source_session_id = ?1
             ORDER BY created_at_utc_ms, outbox_id",
        )?;
        let rows = statement.query_map(params![id(session_id)], cloud_outbox_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub(crate) fn cloud_latest_terminal_error(&self) -> Result<Option<String>, StoreError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT terminal_error FROM meeting_cloud_outbox
                 WHERE state = 'terminal'
                 ORDER BY updated_at_utc_ms DESC, outbox_id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }
    pub(crate) fn cloud_outbox_chunks(
        &self,
        outbox_id: &str,
    ) -> Result<Vec<CloudOutboxChunk>, StoreError> {
        validate_cloud_local_id(outbox_id)?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT chunk_index, size_bytes, sha256, accepted
             FROM meeting_cloud_outbox_chunks
             WHERE outbox_id = ?1 ORDER BY chunk_index",
        )?;
        let rows = statement.query_map(params![outbox_id], |row| {
            Ok(CloudOutboxChunk {
                chunk_index: u32::try_from(row.get::<_, i64>(0)?)
                    .map_err(|_| to_sql_error(StoreError::Corrupt))?,
                size_bytes: from_i64(row.get(1)?).map_err(to_sql_error)?,
                sha256: row.get(2)?,
                accepted: row.get::<_, i64>(3)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub(crate) fn due_cloud_outbox(
        &self,
        now_utc_ms: i64,
        limit: usize,
    ) -> Result<Vec<CloudOutboxRecord>, StoreError> {
        let limit = i64::try_from(limit.clamp(1, 100)).map_err(|_| StoreError::Invalid)?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT outbox_id, kind, object_id, source_session_id, source_revision,
                    base_remote_revision_id, share_content_kind, remote_revision_id, upload_id,
                    idempotency_key, state, attempt_count, next_attempt_utc_ms, terminal_error,
                    payload_relative_dir, claim_token
             FROM meeting_cloud_outbox
             WHERE state = 'pending' AND next_attempt_utc_ms <= ?1
             ORDER BY next_attempt_utc_ms, created_at_utc_ms, outbox_id LIMIT ?2",
        )?;
        let rows = statement.query_map(params![now_utc_ms, limit], cloud_outbox_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub(crate) fn claim_cloud_outbox(
        &self,
        outbox_id: &str,
        claim_token: &str,
        now_utc_ms: i64,
    ) -> Result<Option<CloudOutboxRecord>, StoreError> {
        validate_cloud_local_id(outbox_id)?;
        validate_cloud_text(claim_token)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let existing = cloud_outbox_in(&transaction, outbox_id)?;
        let Some(existing) = existing else {
            transaction.commit()?;
            return Ok(None);
        };
        if existing.state == CloudOutboxState::Claimed
            && existing.claim_token.as_deref() == Some(claim_token)
        {
            transaction.commit()?;
            return Ok(Some(existing));
        }
        let changed = transaction.execute(
            "UPDATE meeting_cloud_outbox
             SET state = 'claimed', claim_token = ?1, claimed_at_utc_ms = ?2,
                 updated_at_utc_ms = ?2
             WHERE outbox_id = ?3 AND state = 'pending' AND next_attempt_utc_ms <= ?2",
            params![claim_token, now_utc_ms, outbox_id],
        )?;
        if changed != 1 {
            transaction.commit()?;
            return Ok(None);
        }
        let claimed = cloud_outbox_in(&transaction, outbox_id)?.ok_or(StoreError::Corrupt)?;
        transaction.commit()?;
        Ok(Some(claimed))
    }
    pub(crate) fn recover_claimed_cloud_outbox(
        &self,
        now_utc_ms: i64,
    ) -> Result<usize, StoreError> {
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_outbox
             SET state = 'pending', claim_token = NULL, claimed_at_utc_ms = NULL,
                 next_attempt_utc_ms = MIN(next_attempt_utc_ms, ?1), updated_at_utc_ms = ?1
             WHERE state = 'claimed'",
            params![now_utc_ms],
        )?;
        Ok(changed)
    }

    pub(crate) fn release_cloud_outbox_claim(
        &self,
        outbox_id: &str,
        claim_token: &str,
        next_attempt_utc_ms: i64,
    ) -> Result<CloudOutboxRecord, StoreError> {
        validate_cloud_local_id(outbox_id)?;
        validate_cloud_text(claim_token)?;
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_outbox
             SET state = 'pending', claim_token = NULL, claimed_at_utc_ms = NULL,
                 next_attempt_utc_ms = ?1, updated_at_utc_ms = ?2
             WHERE outbox_id = ?3 AND state = 'claimed' AND claim_token = ?4",
            params![next_attempt_utc_ms, utc_now_ms(), outbox_id, claim_token],
        )?;
        if changed != 1 {
            return Err(StoreError::Conflict);
        }
        cloud_outbox_in(&connection, outbox_id)?.ok_or(StoreError::Corrupt)
    }

    pub(crate) fn update_cloud_outbox(
        &self,
        outbox_id: &str,
        claim_token: &str,
        update: CloudOutboxUpdate,
    ) -> Result<CloudOutboxRecord, StoreError> {
        validate_cloud_local_id(outbox_id)?;
        validate_cloud_text(claim_token)?;
        validate_cloud_outbox_update(&update)?;
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_outbox
             SET state = ?1, remote_revision_id = ?2, upload_id = ?3, terminal_error = ?4,
                 claim_token = NULL, claimed_at_utc_ms = NULL, updated_at_utc_ms = ?5
             WHERE outbox_id = ?6 AND state = 'claimed' AND claim_token = ?7",
            params![
                cloud_outbox_state_to_db(update.state),
                update.remote_revision_id,
                update.upload_id,
                update.terminal_error,
                utc_now_ms(),
                outbox_id,
                claim_token,
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::Conflict);
        }
        cloud_outbox_in(&connection, outbox_id)?.ok_or(StoreError::Corrupt)
    }

    pub(crate) fn set_cloud_outbox_upload_id(
        &self,
        outbox_id: &str,
        claim_token: &str,
        upload_id: String,
    ) -> Result<CloudOutboxRecord, StoreError> {
        validate_cloud_local_id(outbox_id)?;
        validate_cloud_text(claim_token)?;
        validate_cloud_identifier(&upload_id)?;
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_outbox
             SET upload_id = ?1, updated_at_utc_ms = ?2
             WHERE outbox_id = ?3 AND state = 'claimed' AND claim_token = ?4
               AND (upload_id IS NULL OR upload_id = ?1)",
            params![upload_id, utc_now_ms(), outbox_id, claim_token],
        )?;
        if changed != 1 {
            return Err(StoreError::Conflict);
        }
        cloud_outbox_in(&connection, outbox_id)?.ok_or(StoreError::Corrupt)
    }

    pub(crate) fn retry_cloud_outbox(
        &self,
        outbox_id: &str,
        claim_token: &str,
        failure: &str,
        next_attempt_utc_ms: i64,
    ) -> Result<CloudOutboxRecord, StoreError> {
        validate_cloud_local_id(outbox_id)?;
        validate_cloud_text(claim_token)?;
        validate_cloud_text(failure)?;
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_outbox
             SET state = 'pending', attempt_count = attempt_count + 1,
                 next_attempt_utc_ms = ?1, terminal_error = NULL, claim_token = NULL,
                 claimed_at_utc_ms = NULL, updated_at_utc_ms = ?2
             WHERE outbox_id = ?3 AND state = 'claimed' AND claim_token = ?4",
            params![next_attempt_utc_ms, utc_now_ms(), outbox_id, claim_token],
        )?;
        if changed != 1 {
            return Err(StoreError::Conflict);
        }
        cloud_outbox_in(&connection, outbox_id)?.ok_or(StoreError::Corrupt)
    }
    pub(crate) fn retry_terminal_cloud_outbox(
        &self,
        outbox_id: &str,
        next_attempt_utc_ms: i64,
    ) -> Result<CloudOutboxRecord, StoreError> {
        validate_cloud_local_id(outbox_id)?;
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_outbox
             SET state = 'pending', attempt_count = attempt_count + 1,
                 next_attempt_utc_ms = ?1, terminal_error = NULL,
                 claim_token = NULL, claimed_at_utc_ms = NULL, updated_at_utc_ms = ?2
             WHERE outbox_id = ?3 AND state = 'terminal'",
            params![next_attempt_utc_ms, utc_now_ms(), outbox_id],
        )?;
        if changed != 1 {
            return Err(StoreError::Conflict);
        }
        cloud_outbox_in(&connection, outbox_id)?.ok_or(StoreError::Corrupt)
    }

    pub(crate) fn cancel_cloud_outbox(&self, outbox_id: &str) -> Result<(), StoreError> {
        validate_cloud_local_id(outbox_id)?;
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_outbox
             SET state = 'cancelled', claim_token = NULL, claimed_at_utc_ms = NULL,
                 updated_at_utc_ms = ?1
             WHERE outbox_id = ?2 AND state IN ('pending', 'claimed')",
            params![utc_now_ms(), outbox_id],
        )?;
        if changed != 1 {
            return Err(StoreError::Conflict);
        }
        Ok(())
    }

    pub(crate) fn cloud_outbox_payload_directory(
        &self,
        outbox_id: &str,
    ) -> Result<PathBuf, StoreError> {
        let record = self.cloud_outbox(outbox_id)?.ok_or(StoreError::NotFound)?;
        let path = validated_cloud_outbox_dir(&self.root, outbox_id, &record.payload_relative_dir)?;
        ensure_private_directory(&path)?;
        Ok(path)
    }

    pub(crate) fn stage_cloud_outbox_chunks(
        &self,
        outbox_id: &str,
        chunks: &[CloudOutboxChunk],
    ) -> Result<(), StoreError> {
        validate_cloud_local_id(outbox_id)?;
        validate_cloud_chunks(chunks)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let record = cloud_outbox_in(&transaction, outbox_id)?.ok_or(StoreError::NotFound)?;
        if record.state != CloudOutboxState::Pending {
            return Err(StoreError::Conflict);
        }
        for chunk in chunks {
            transaction.execute(
                "INSERT INTO meeting_cloud_outbox_chunks (
                    outbox_id, chunk_index, size_bytes, sha256, accepted, accepted_at_utc_ms
                 ) VALUES (?1, ?2, ?3, ?4, 0, NULL)",
                params![
                    outbox_id,
                    i64::from(chunk.chunk_index),
                    to_i64(chunk.size_bytes)?,
                    chunk.sha256,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub(crate) fn missing_cloud_outbox_chunks(
        &self,
        outbox_id: &str,
    ) -> Result<Vec<CloudOutboxChunk>, StoreError> {
        validate_cloud_local_id(outbox_id)?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT chunk_index, size_bytes, sha256, accepted
             FROM meeting_cloud_outbox_chunks
             WHERE outbox_id = ?1 AND accepted = 0 ORDER BY chunk_index",
        )?;
        let rows = statement.query_map(params![outbox_id], |row| {
            Ok(CloudOutboxChunk {
                chunk_index: u32::try_from(row.get::<_, i64>(0)?)
                    .map_err(|_| to_sql_error(StoreError::Corrupt))?,
                size_bytes: from_i64(row.get(1)?).map_err(to_sql_error)?,
                sha256: row.get(2)?,
                accepted: row.get::<_, i64>(3)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub(crate) fn mark_cloud_outbox_chunk_accepted(
        &self,
        outbox_id: &str,
        chunk_index: u32,
        claim_token: &str,
        accepted_at_utc_ms: i64,
    ) -> Result<(), StoreError> {
        validate_cloud_local_id(outbox_id)?;
        validate_cloud_text(claim_token)?;
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_outbox_chunks
             SET accepted = 1, accepted_at_utc_ms = ?1
             WHERE outbox_id = ?2 AND chunk_index = ?3
               AND EXISTS (
                    SELECT 1 FROM meeting_cloud_outbox
                    WHERE outbox_id = ?2 AND state = 'claimed' AND claim_token = ?4
               )",
            params![
                accepted_at_utc_ms,
                outbox_id,
                i64::from(chunk_index),
                claim_token
            ],
        )?;
        if changed == 1 {
            return Ok(());
        }
        let accepted: Option<i64> = connection
            .query_row(
                "SELECT accepted FROM meeting_cloud_outbox_chunks
                 WHERE outbox_id = ?1 AND chunk_index = ?2",
                params![outbox_id, i64::from(chunk_index)],
                |row| row.get(0),
            )
            .optional()?;
        match accepted {
            Some(1) => Ok(()),
            Some(_) => Err(StoreError::Conflict),
            None => Err(StoreError::NotFound),
        }
    }

    pub(crate) fn enqueue_cloud_tombstone_for_session(
        &self,
        session_id: MeetingSessionId,
        revision: u64,
        idempotency_key: String,
        next_attempt_utc_ms: i64,
    ) -> Result<Option<CloudOutboxRecord>, StoreError> {
        let connection = self.connection()?;
        let head = connection
            .query_row(
                "SELECT object_id, source_session_id, remote_revision_id, tombstone,
                        acknowledged_revision_id, change_sequence
                 FROM meeting_cloud_heads
                 WHERE source_session_id = ?1 AND tombstone = 0
                 ORDER BY updated_at_utc_ms DESC LIMIT 1",
                params![id(session_id)],
                cloud_head_from_row,
            )
            .optional()?;
        drop(connection);
        let Some(head) = head else {
            return Ok(None);
        };
        self.enqueue_cloud_outbox(CloudOutboxInput {
            kind: CloudOutboxKind::Tombstone,
            object_id: head.object_id,
            source_session_id: Some(session_id),
            source_revision: Some(revision),
            base_remote_revision_id: head.remote_revision_id,
            share_content_kind: None,
            remote_revision_id: Some(Uuid::new_v4().simple().to_string()),
            idempotency_key,
            next_attempt_utc_ms,
        })
        .map(Some)
    }

    pub(crate) fn cloud_conflict(
        &self,
        object_id: &str,
    ) -> Result<Option<CloudConflict>, StoreError> {
        validate_cloud_identifier(object_id)?;
        let connection = self.connection()?;
        cloud_conflict_in(&connection, object_id)
    }

    pub(crate) fn cache_cloud_conflict(&self, conflict: &CloudConflict) -> Result<(), StoreError> {
        validate_cloud_conflict(conflict)?;
        let bundle_path = validated_cloud_conflict_bundle_path(
            &self.root,
            &conflict.remote_bundle_relative_path,
        )?;
        if !bundle_path.is_file() {
            return Err(StoreError::NotFound);
        }
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO meeting_cloud_conflicts (
                object_id, source_session_id, source_revision, remote_revision_id,
                remote_sequence, remote_bundle_relative_path, detected_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(object_id) DO UPDATE SET
                source_session_id = excluded.source_session_id,
                source_revision = excluded.source_revision,
                remote_revision_id = excluded.remote_revision_id,
                remote_sequence = excluded.remote_sequence,
                remote_bundle_relative_path = excluded.remote_bundle_relative_path,
                detected_at_utc_ms = excluded.detected_at_utc_ms",
            params![
                conflict.object_id,
                conflict.source_session_id.map(id),
                conflict.source_revision.map(to_i64).transpose()?,
                conflict.remote_revision_id,
                to_i64(conflict.remote_sequence)?,
                conflict.remote_bundle_relative_path,
                utc_now_ms(),
            ],
        )?;
        Ok(())
    }

    pub(crate) fn cloud_conflict_bundle_path(
        &self,
        object_id: &str,
    ) -> Result<PathBuf, StoreError> {
        let conflict = self
            .cloud_conflict(object_id)?
            .ok_or(StoreError::NotFound)?;
        let path = validated_cloud_conflict_bundle_path(
            &self.root,
            &conflict.remote_bundle_relative_path,
        )?;
        if !path.is_file() {
            return Err(StoreError::NotFound);
        }
        Ok(path)
    }

    pub(crate) fn cloud_conflict_staging_path(
        &self,
        object_id: &str,
    ) -> Result<PathBuf, StoreError> {
        validate_cloud_identifier(object_id)?;
        let relative = format!(".cloud-conflicts/{object_id}.bundle");
        let path = validated_cloud_conflict_bundle_path(&self.root, &relative)?;
        let parent = path.parent().ok_or(StoreError::Invalid)?;
        ensure_private_directory(parent)?;
        Ok(path)
    }

    pub(crate) fn resolve_cloud_conflict_keep_local(
        &self,
        object_id: &str,
        idempotency_key: String,
        next_attempt_utc_ms: i64,
    ) -> Result<CloudOutboxRecord, StoreError> {
        validate_cloud_identifier(object_id)?;
        let conflict = self
            .cloud_conflict(object_id)?
            .ok_or(StoreError::NotFound)?;
        let session_id = conflict.source_session_id.ok_or(StoreError::Conflict)?;
        let session = self.session_snapshot(session_id)?;
        if !matches!(
            session.phase,
            MeetingPhase::ReviewReady | MeetingPhase::RecoveryRequired
        ) {
            return Err(StoreError::Conflict);
        }
        let outbox = self.enqueue_cloud_outbox(CloudOutboxInput {
            kind: CloudOutboxKind::Object,
            object_id: conflict.object_id.clone(),
            source_session_id: Some(session_id),
            source_revision: Some(session.revision),
            base_remote_revision_id: Some(conflict.remote_revision_id.clone()),
            share_content_kind: None,
            remote_revision_id: Some(Uuid::new_v4().simple().to_string()),
            idempotency_key,
            next_attempt_utc_ms,
        })?;
        let connection = self.connection()?;
        connection.execute(
            "DELETE FROM meeting_cloud_conflicts
             WHERE object_id = ?1 AND remote_revision_id = ?2",
            params![conflict.object_id, conflict.remote_revision_id],
        )?;
        Ok(outbox)
    }

    pub(crate) fn resolve_cloud_conflict_use_remote(
        &self,
        object_id: &str,
        installed_session_id: MeetingSessionId,
    ) -> Result<CloudHead, StoreError> {
        validate_cloud_identifier(object_id)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let conflict = cloud_conflict_in(&transaction, object_id)?.ok_or(StoreError::NotFound)?;
        let session = session_row(&transaction, installed_session_id)?;
        if !matches!(
            session.phase,
            MeetingPhase::ReviewReady | MeetingPhase::RecoveryRequired
        ) {
            return Err(StoreError::Conflict);
        }
        let head = CloudHead {
            object_id: conflict.object_id.clone(),
            source_session_id: Some(installed_session_id),
            remote_revision_id: Some(conflict.remote_revision_id.clone()),
            tombstone: false,
            acknowledged_revision_id: Some(conflict.remote_revision_id.clone()),
            change_sequence: conflict.remote_sequence,
        };
        upsert_cloud_head_in(&transaction, &head)?;
        let changed = transaction.execute(
            "DELETE FROM meeting_cloud_conflicts
             WHERE object_id = ?1 AND remote_revision_id = ?2",
            params![conflict.object_id, conflict.remote_revision_id],
        )?;
        if changed != 1 {
            return Err(StoreError::Conflict);
        }
        transaction.commit()?;
        Ok(head)
    }

    pub(crate) fn create_cloud_share(
        &self,
        input: CloudShareInput,
    ) -> Result<CloudShareRecord, StoreError> {
        validate_cloud_share_input(&input)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        validate_cloud_share_source(&transaction, input.source_session_id)?;
        let now = utc_now_ms();
        transaction.execute(
            "INSERT INTO meeting_cloud_shares (
                share_id, object_id, source_session_id, expires_at_utc_ms, state, content_kind,
                encrypted_link_material, outbox_id, revoked_at_utc_ms, created_at_utc_ms,
                updated_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7, NULL, ?8, ?8)",
            params![
                input.share_id,
                input.object_id,
                input.source_session_id.map(id),
                input.expires_at_utc_ms,
                cloud_share_content_kind_to_db(input.content_kind),
                input.encrypted_link_material,
                input.outbox_id,
                now,
            ],
        )?;
        transaction.commit()?;
        cloud_share_in(&connection, &input.share_id)?.ok_or(StoreError::Corrupt)
    }

    pub(crate) fn cloud_share(
        &self,
        share_id: &str,
    ) -> Result<Option<CloudShareRecord>, StoreError> {
        validate_cloud_identifier(share_id)?;
        let connection = self.connection()?;
        cloud_share_in(&connection, share_id)
    }
    pub(crate) fn cloud_share_for_outbox(
        &self,
        outbox_id: &str,
    ) -> Result<Option<CloudShareRecord>, StoreError> {
        validate_cloud_local_id(outbox_id)?;
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT share_id, object_id, source_session_id, expires_at_utc_ms, state,
                        content_kind, encrypted_link_material, outbox_id, revoked_at_utc_ms
                 FROM meeting_cloud_shares WHERE outbox_id = ?1",
                params![outbox_id],
                cloud_share_from_row,
            )
            .optional()
            .map_err(Into::into)
    }

    pub(crate) fn cloud_share_count_for_session(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<u32, StoreError> {
        let connection = self.connection()?;
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM meeting_cloud_shares
             WHERE source_session_id = ?1 AND state IN ('pending', 'active')",
            params![id(session_id)],
            |row| row.get(0),
        )?;
        u32::try_from(count).map_err(|_| StoreError::Corrupt)
    }

    pub(crate) fn update_cloud_share(
        &self,
        share_id: &str,
        update: CloudShareUpdate,
    ) -> Result<CloudShareRecord, StoreError> {
        validate_cloud_identifier(share_id)?;
        validate_cloud_share_update(&update)?;
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE meeting_cloud_shares
             SET expires_at_utc_ms = ?1, state = ?2, outbox_id = ?3, revoked_at_utc_ms = ?4,
                 updated_at_utc_ms = ?5
             WHERE share_id = ?6",
            params![
                update.expires_at_utc_ms,
                cloud_share_state_to_db(update.state),
                update.outbox_id,
                update.revoked_at_utc_ms,
                utc_now_ms(),
                share_id,
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::NotFound);
        }
        cloud_share_in(&connection, share_id)?.ok_or(StoreError::Corrupt)
    }

    pub(crate) fn revoke_cloud_share(
        &self,
        share_id: &str,
        revoked_at_utc_ms: i64,
    ) -> Result<CloudShareRecord, StoreError> {
        let current = self.cloud_share(share_id)?.ok_or(StoreError::NotFound)?;
        self.update_cloud_share(
            share_id,
            CloudShareUpdate {
                expires_at_utc_ms: current.expires_at_utc_ms,
                state: CloudShareState::Revoked,
                outbox_id: current.outbox_id,
                revoked_at_utc_ms: Some(revoked_at_utc_ms),
            },
        )
    }

    pub(crate) fn cloud_status_counts(&self) -> Result<CloudStatusCounts, StoreError> {
        let connection = self.connection()?;
        let (queued_outbox, claimed_outbox, pending_tombstones, conflicts, active_shares): (
            i64,
            i64,
            i64,
            i64,
            i64,
        ) = connection.query_row(
            "SELECT
                (SELECT COUNT(*) FROM meeting_cloud_outbox WHERE state = 'pending'),
                (SELECT COUNT(*) FROM meeting_cloud_outbox WHERE state = 'claimed'),
                (SELECT COUNT(*) FROM meeting_cloud_outbox
                    WHERE kind = 'tombstone' AND state IN ('pending', 'claimed')),
                (SELECT COUNT(*) FROM meeting_cloud_conflicts),
                (SELECT COUNT(*) FROM meeting_cloud_shares WHERE state = 'active')",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )?;
        Ok(CloudStatusCounts {
            queued_outbox: u32::try_from(queued_outbox).map_err(|_| StoreError::Corrupt)?,
            claimed_outbox: u32::try_from(claimed_outbox).map_err(|_| StoreError::Corrupt)?,
            pending_tombstones: u32::try_from(pending_tombstones)
                .map_err(|_| StoreError::Corrupt)?,
            conflicts: u32::try_from(conflicts).map_err(|_| StoreError::Corrupt)?,
            active_shares: u32::try_from(active_shares).map_err(|_| StoreError::Corrupt)?,
        })
    }

    pub(crate) fn export_cloud_meeting_bundle(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<cloud_bundle::CloudMeetingBundleV1, StoreError> {
        let connection = self.connection()?;
        let bundle = export_cloud_meeting_bundle_in(&connection, session_id)?;
        bundle.validate()?;
        Ok(bundle)
    }

    pub(crate) fn import_cloud_meeting_bundle(
        &self,
        bundle: &cloud_bundle::CloudMeetingBundleV1,
    ) -> Result<MeetingSessionId, StoreError> {
        bundle.validate()?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        import_cloud_meeting_bundle_in(&transaction, bundle)?;
        rebuild_search_documents_in(&transaction, bundle.session.session_id)?;
        transaction.commit()?;
        Ok(bundle.session.session_id)
    }

    pub fn next_plan_attempt(&self, session_id: MeetingSessionId) -> Result<u32, StoreError> {
        let connection = self.connection()?;
        let attempt: i64 = connection.query_row(
            "SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM meeting_run_plans WHERE session_id = ?1",
            params![id(session_id)],
            |row| row.get(0),
        )?;
        u32::try_from(attempt).map_err(|_| StoreError::Corrupt)
    }

    pub(crate) fn processing_plan(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingRunPlan, StoreError> {
        let connection = self.connection()?;
        let plan: String = connection
            .query_row(
                "SELECT p.canonical_plan_json
                 FROM meeting_sessions s
                 JOIN meeting_run_plans p ON p.plan_id = s.successful_plan_id
                 WHERE s.id = ?1",
                params![id(session_id)],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound)?;
        decode_json(&plan)
    }

    pub fn set_processing_status(
        &self,
        session_id: MeetingSessionId,
        status: ProcessingStatus,
    ) -> Result<(), StoreError> {
        let connection = self.connection()?;
        connection.execute(
            "UPDATE meeting_sessions SET processing_status = ?1 WHERE id = ?2",
            params![encode_json(&status)?, id(session_id)],
        )?;
        Ok(())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn diarization_model_directory(&self) -> PathBuf {
        self.root.join("models")
    }

    pub fn set_diarization_status(
        &self,
        session_id: MeetingSessionId,
        status: DiarizationStatus,
        model_id: &str,
        model_version: &str,
    ) -> Result<(), StoreError> {
        let connection = self.connection()?;
        connection.execute(
            "UPDATE meeting_sessions
             SET diarization_status = ?1, diarization_model_id = ?2, diarization_model_version = ?3
             WHERE id = ?4",
            params![
                diarization_status_to_db(status),
                model_id,
                model_version,
                id(session_id)
            ],
        )?;
        Ok(())
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn default_retention_policy(&self) -> Result<(MeetingRetentionPolicy, u64), StoreError> {
        let connection = self.connection()?;
        let (policy, revision): (String, i64) = connection.query_row(
            "SELECT policy_json, revision FROM meeting_retention_policy WHERE singleton = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        Ok((
            decode_json(&policy)?,
            u64::try_from(revision).map_err(|_| StoreError::Corrupt)?,
        ))
    }
    pub fn session_retention_policy(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingRetentionPolicy, StoreError> {
        let connection = self.connection()?;
        let policy: String = connection
            .query_row(
                "SELECT retention_policy_json FROM meeting_sessions WHERE id = ?1",
                params![id(session_id)],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound)?;
        decode_json(&policy)
    }
    pub(crate) fn due_retention_sessions(
        &self,
        now_utc_ms: i64,
    ) -> Result<Vec<DueRetentionSession>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, revision FROM meeting_sessions
             WHERE phase = 'review_ready'
               AND delete_after_utc_ms IS NOT NULL
               AND delete_after_utc_ms <= ?1
             ORDER BY delete_after_utc_ms, id",
        )?;
        let rows = statement
            .query_map(params![now_utc_ms], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(session_id, revision)| {
                Ok(DueRetentionSession {
                    session_id: MeetingSessionId::from_uuid(parse_uuid(&session_id)?),
                    revision: u64::try_from(revision).map_err(|_| StoreError::Corrupt)?,
                })
            })
            .collect()
    }

    pub fn set_default_retention_policy(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        expected_revision: u64,
        policy: &MeetingRetentionPolicy,
    ) -> Result<(OperationReceipt, u64), StoreError> {
        if let Some(receipt) = self.operation_receipt(operation_id)? {
            let revision = receipt.new_revision.ok_or(StoreError::Corrupt)?;
            return Ok((receipt, revision));
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        if let Some(receipt) = operation_receipt_in(&transaction, operation_id)? {
            let revision = receipt.new_revision.ok_or(StoreError::Corrupt)?;
            transaction.commit()?;
            return Ok((receipt, revision));
        }
        let revision: i64 = transaction.query_row(
            "SELECT revision FROM meeting_retention_policy WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        let revision = u64::try_from(revision).map_err(|_| StoreError::Corrupt)?;
        if revision != expected_revision {
            let receipt = rejected_global_receipt(
                operation_id,
                MeetingCommandKind::RetentionSet,
                expected_revision,
                revision,
                requested_at_utc_ms,
                MeetingReasonCode::StaleRevision,
            );
            insert_operation_receipt(&transaction, &receipt, utc_now_ms())?;
            transaction.commit()?;
            return Ok((receipt, revision));
        }
        let next = revision.checked_add(1).ok_or(StoreError::Corrupt)?;
        transaction.execute(
            "UPDATE meeting_retention_policy SET policy_json = ?1, revision = ?2 WHERE singleton = 1",
            params![encode_json(policy)?, to_i64(next)?],
        )?;
        let now = utc_now_ms();
        let receipt = committed_global_receipt(
            operation_id,
            MeetingCommandKind::RetentionSet,
            expected_revision,
            requested_at_utc_ms,
            now,
            next,
        );
        insert_operation_receipt(&transaction, &receipt, now)?;
        transaction.commit()?;
        Ok((receipt, next))
    }

    pub fn operation_receipt(
        &self,
        operation_id: MeetingOperationId,
    ) -> Result<Option<OperationReceipt>, StoreError> {
        let connection = self.connection()?;
        let receipt = connection
            .query_row(
                "SELECT receipt_json FROM meeting_operation_receipts WHERE operation_id = ?1",
                params![id(operation_id)],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        receipt.map(|value| decode_json(&value)).transpose()
    }
    pub fn export_result_for_operation(
        &self,
        operation_id: MeetingOperationId,
    ) -> Result<Option<MeetingExportResult>, StoreError> {
        let connection = self.connection()?;
        let receipt = connection
            .query_row(
                "SELECT receipt_json FROM meeting_operation_receipts WHERE operation_id = ?1",
                params![id(operation_id)],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let receipt: Option<OperationReceipt> =
            receipt.map(|value| decode_json(&value)).transpose()?;
        let Some(receipt) = receipt else {
            return Ok(None);
        };
        if receipt.command != MeetingCommandKind::Export {
            return Err(StoreError::Invalid);
        }
        if receipt.result != OperationResult::Committed {
            return Ok(None);
        }
        Ok(Some(export_result_for_receipt(&connection, receipt)?))
    }

    pub fn record_export(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
        format: MeetingExportFormat,
    ) -> Result<MeetingExportResult, StoreError> {
        if let Some(result) = self.export_result_for_operation(operation_id)? {
            return Ok(result);
        }
        if self.operation_receipt(operation_id)?.is_some() {
            return Err(StoreError::Invalid);
        }

        let mutation = StoreMutation {
            operation_id,
            requested_at_utc_ms,
            session_id,
            expected_revision,
            command: MeetingCommandKind::Export,
        };
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        if let Some(receipt) = operation_receipt_in(&transaction, operation_id)? {
            let result = export_result_for_receipt(&transaction, receipt)?;
            transaction.commit()?;
            return Ok(result);
        }
        let current = session_row(&transaction, session_id)?;
        if validate_mutation(
            &transaction,
            mutation,
            &current,
            &[MeetingPhase::ReviewReady, MeetingPhase::RecoveryRequired],
        )?
        .is_some()
        {
            transaction.commit()?;
            return Err(StoreError::Conflict);
        }

        let transcript_revision_id = transaction
            .query_row(
                "SELECT current_transcript_revision_id FROM meeting_sessions WHERE id = ?1",
                params![id(session_id)],
                |row| row.get::<_, Option<String>>(0),
            )?
            .map(|value| parse_uuid(&value).map(TranscriptRevisionId::from_uuid))
            .transpose()?;
        let sources = source_snapshots(&transaction, session_id)?;
        let capture_completeness = derive_completeness(&transaction, session_id, &sources)?;
        let now = utc_now_ms();
        let export_receipt = MeetingExportReceipt {
            export_receipt_id: MeetingExportReceiptId::new(),
            session_id,
            format,
            snapshot_revision: current.revision,
            capture_completeness,
            transcript_revision_id,
            created_at_utc_ms: now,
        };
        transaction.execute(
            "INSERT INTO meeting_export_receipts (
                export_receipt_id, session_id, format, snapshot_revision, capture_completeness,
                transcript_revision_id, created_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id(export_receipt.export_receipt_id),
                id(session_id),
                encode_json(&export_receipt.format)?,
                to_i64(export_receipt.snapshot_revision)?,
                encode_json(&export_receipt.capture_completeness)?,
                export_receipt.transcript_revision_id.map(id),
                export_receipt.created_at_utc_ms,
            ],
        )?;
        let receipt = committed_receipt(
            mutation,
            current.phase,
            current.phase,
            now,
            current.revision,
            vec![id(export_receipt.export_receipt_id)],
        );
        insert_operation_receipt(&transaction, &receipt, now)?;
        transaction.commit()?;
        Ok(MeetingExportResult {
            receipt,
            export_receipt,
        })
    }

    pub(crate) fn create_preflight(
        &self,
        mutation: StoreMutation,
        title: String,
        origin: MeetingOrigin,
        preflight: MeetingPreflightSnapshot,
        retention_policy: MeetingRetentionPolicy,
    ) -> Result<OperationReceipt, StoreError> {
        if let Some(receipt) = self.operation_receipt(mutation.operation_id)? {
            return Ok(receipt);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        if let Some(receipt) = operation_receipt_in(&transaction, mutation.operation_id)? {
            return Ok(receipt);
        }
        let now = utc_now_ms();
        transaction.execute(
            "INSERT INTO meeting_sessions (
                id, phase, revision, title, origin_kind, preflight_json, created_at_utc_ms,
                processing_status, retention_policy_json
             ) VALUES (?1, 'preflight', 0, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id(mutation.session_id),
                title,
                encode_json(&origin)?,
                encode_json(&preflight)?,
                now,
                encode_json(&ProcessingStatus::Pending)?,
                encode_json(&retention_policy)?,
            ],
        )?;
        transaction.execute(
            "INSERT INTO meeting_session_events (
                session_id, sequence, prior_phase, next_phase, event_kind, observed_at_utc_ms,
                session_offset_ns, details_json
            ) VALUES (?1, 0, NULL, 'preflight', 'preflight_created', ?2, NULL, '{}')",
            params![id(mutation.session_id), now],
        )?;
        let receipt = OperationReceipt {
            schema_version: STORE_SCHEMA_VERSION,
            operation_id: mutation.operation_id,
            session_id: Some(mutation.session_id),
            actor: OperationActor::User,
            command: mutation.command,
            expected_revision: mutation.expected_revision,
            from_phase: None,
            to_phase: Some(MeetingPhase::Preflight),
            requested_at_utc_ms: mutation.requested_at_utc_ms,
            committed_at_utc_ms: Some(now),
            result: OperationResult::Committed,
            reason_codes: Vec::new(),
            new_revision: Some(0),
            effect_ids: vec![id(mutation.session_id)],
        };
        insert_operation_receipt(&transaction, &receipt, now)?;
        transaction.commit()?;
        Ok(receipt)
    }

    pub fn refresh_preflight(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
        preflight: MeetingPreflightSnapshot,
    ) -> Result<OperationReceipt, StoreError> {
        self.update_preflight(
            operation_id,
            requested_at_utc_ms,
            session_id,
            expected_revision,
            preflight,
            MeetingCommandKind::PreflightRefresh,
        )
    }

    fn update_preflight(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
        preflight: MeetingPreflightSnapshot,
        command: MeetingCommandKind,
    ) -> Result<OperationReceipt, StoreError> {
        if let Some(receipt) = self.operation_receipt(operation_id)? {
            return Ok(receipt);
        }
        let mutation = StoreMutation {
            operation_id,
            requested_at_utc_ms,
            session_id,
            expected_revision,
            command,
        };
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let current = session_row(&transaction, session_id)?;
        let receipt =
            validate_mutation(&transaction, mutation, &current, &[MeetingPhase::Preflight])?;
        if let Some(receipt) = receipt {
            transaction.commit()?;
            return Ok(receipt);
        }
        let next_revision = current.revision.checked_add(1).ok_or(StoreError::Corrupt)?;
        let now = utc_now_ms();
        transaction.execute(
            "UPDATE meeting_sessions SET preflight_json = ?1, revision = ?2 WHERE id = ?3",
            params![
                encode_json(&preflight)?,
                to_i64(next_revision)?,
                id(session_id)
            ],
        )?;
        append_event(
            &transaction,
            session_id,
            next_revision,
            current.phase,
            current.phase,
            "preflight_refreshed",
            None,
        )?;
        let receipt = committed_receipt(
            mutation,
            current.phase,
            current.phase,
            now,
            next_revision,
            Vec::new(),
        );
        insert_operation_receipt(&transaction, &receipt, now)?;
        transaction.commit()?;
        Ok(receipt)
    }

    pub fn cancel_preflight(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
    ) -> Result<OperationReceipt, StoreError> {
        if let Some(receipt) = self.operation_receipt(operation_id)? {
            return Ok(receipt);
        }
        let mutation = StoreMutation {
            operation_id,
            requested_at_utc_ms,
            session_id,
            expected_revision,
            command: MeetingCommandKind::PreflightCancel,
        };
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let current = session_row(&transaction, session_id)?;
        let validation =
            validate_mutation(&transaction, mutation, &current, &[MeetingPhase::Preflight])?;
        if let Some(receipt) = validation {
            transaction.commit()?;
            return Ok(receipt);
        }
        let now = utc_now_ms();
        let receipt = OperationReceipt {
            schema_version: STORE_SCHEMA_VERSION,
            operation_id: mutation.operation_id,
            session_id: Some(mutation.session_id),
            actor: OperationActor::User,
            command: mutation.command,
            expected_revision: mutation.expected_revision,
            from_phase: Some(MeetingPhase::Preflight),
            to_phase: None,
            requested_at_utc_ms: mutation.requested_at_utc_ms,
            committed_at_utc_ms: Some(now),
            result: OperationResult::Committed,
            reason_codes: Vec::new(),
            new_revision: None,
            effect_ids: Vec::new(),
        };
        transaction.execute(
            "DELETE FROM meeting_sessions WHERE id = ?1",
            params![id(session_id)],
        )?;
        insert_operation_receipt(&transaction, &receipt, now)?;
        transaction.commit()?;
        Ok(receipt)
    }

    pub fn start_with_plan_and_consent(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        plan: &MeetingRunPlan,
        consent: &MeetingConsent,
        expected_revision: u64,
    ) -> Result<OperationReceipt, StoreError> {
        if let Some(receipt) = self.operation_receipt(operation_id)? {
            return Ok(receipt);
        }
        let mutation = StoreMutation {
            operation_id,
            requested_at_utc_ms,
            session_id: plan.session_id,
            expected_revision,
            command: MeetingCommandKind::Start,
        };
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let current = session_row(&transaction, plan.session_id)?;
        let validation =
            validate_mutation(&transaction, mutation, &current, &[MeetingPhase::Preflight])?;
        if let Some(receipt) = validation {
            transaction.commit()?;
            return Ok(receipt);
        }
        let next_revision = current.revision.checked_add(1).ok_or(StoreError::Corrupt)?;
        let now = utc_now_ms();
        transaction.execute(
            "INSERT INTO meeting_consents (
                consent_id, session_id, attempt_number, preflight_revision, policy_version,
                acknowledgement_json, acknowledged_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id(consent.consent_id),
                id(consent.session_id),
                i64::from(consent.attempt_number),
                to_i64(consent.preflight_revision)?,
                i64::from(consent.policy_version),
                encode_json(consent)?,
                consent.acknowledged_at_utc_ms,
            ],
        )?;
        transaction.execute(
            "INSERT INTO meeting_run_plans (
                plan_id, session_id, attempt_number, schema_version, consent_id,
                canonical_plan_json, created_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id(plan.plan_id),
                id(plan.session_id),
                i64::from(plan.attempt_number),
                i64::from(plan.schema_version),
                id(plan.consent_id),
                encode_json(plan)?,
                now,
            ],
        )?;
        transaction.execute(
            "UPDATE meeting_sessions
             SET phase = 'starting', revision = ?1, successful_plan_id = ?2, started_at_utc_ms = ?3
             WHERE id = ?4",
            params![
                to_i64(next_revision)?,
                id(plan.plan_id),
                now,
                id(plan.session_id)
            ],
        )?;
        append_event(
            &transaction,
            plan.session_id,
            next_revision,
            MeetingPhase::Preflight,
            MeetingPhase::Starting,
            "start_authorized",
            None,
        )?;
        let receipt = committed_receipt(
            mutation,
            MeetingPhase::Preflight,
            MeetingPhase::Starting,
            now,
            next_revision,
            vec![id(plan.plan_id), id(consent.consent_id)],
        );
        insert_operation_receipt(&transaction, &receipt, now)?;
        transaction.commit()?;
        Ok(receipt)
    }

    pub(crate) fn transition(
        &self,
        transition: StoreTransition<'_>,
    ) -> Result<Option<OperationReceipt>, StoreError> {
        let StoreTransition {
            operation_id,
            actor,
            command,
            requested_at_utc_ms,
            session_id,
            expected_revision,
            allowed_from,
            next_phase,
            event_kind,
            reason_codes,
        } = transition;
        if let Some(operation_id) = operation_id {
            if let Some(receipt) = self.operation_receipt(operation_id)? {
                return Ok(Some(receipt));
            }
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let current = session_row(&transaction, session_id)?;
        if let Some(operation_id) = operation_id {
            let mutation = StoreMutation {
                operation_id,
                requested_at_utc_ms,
                session_id,
                expected_revision,
                command,
            };
            if let Some(receipt) =
                validate_mutation(&transaction, mutation, &current, allowed_from)?
            {
                transaction.commit()?;
                return Ok(Some(receipt));
            }
        } else if !allowed_from.contains(&current.phase) {
            return Err(StoreError::Conflict);
        }
        let next_revision = current.revision.checked_add(1).ok_or(StoreError::Corrupt)?;
        let now = utc_now_ms();
        let started_at_utc_ms = (current.started_at_utc_ms.is_none()
            && next_phase == MeetingPhase::Starting)
            .then_some(now);
        let completed = next_phase == MeetingPhase::ReviewReady;
        let delete_after_utc_ms = if completed {
            let policy: MeetingRetentionPolicy = decode_json(&current.retention_policy_json)?;
            policy.delete_after_utc_ms(now)
        } else {
            None
        };
        transaction.execute(
            "UPDATE meeting_sessions
             SET phase = ?1, revision = ?2,
                 started_at_utc_ms = COALESCE(started_at_utc_ms, ?3),
                 ended_at_utc_ms = CASE WHEN ?4 = 1 THEN ?5 ELSE ended_at_utc_ms END,
                 delete_after_utc_ms = CASE WHEN ?4 = 1 THEN ?6 ELSE delete_after_utc_ms END
             WHERE id = ?7",
            params![
                phase_db(next_phase),
                to_i64(next_revision)?,
                started_at_utc_ms,
                bool_to_i64(completed),
                completed.then_some(now),
                delete_after_utc_ms,
                id(session_id),
            ],
        )?;
        append_event(
            &transaction,
            session_id,
            next_revision,
            current.phase,
            next_phase,
            event_kind,
            None,
        )?;
        let receipt = operation_id.map(|operation_id| {
            let mut receipt = committed_receipt(
                StoreMutation {
                    operation_id,
                    requested_at_utc_ms,
                    session_id,
                    expected_revision,
                    command,
                },
                current.phase,
                next_phase,
                now,
                next_revision,
                Vec::new(),
            );
            receipt.actor = actor;
            receipt.reason_codes = reason_codes;
            receipt
        });
        if let Some(receipt) = &receipt {
            insert_operation_receipt(&transaction, receipt, now)?;
        }
        transaction.commit()?;
        Ok(receipt)
    }

    pub(crate) fn create_track(&self, creation: TrackCreation<'_>) -> Result<(), StoreError> {
        let TrackCreation {
            session_id,
            plan_id,
            source_kind,
            required,
            requested,
            descriptor_json,
            report,
        } = creation;
        if source_kind != report.source_kind {
            return Err(StoreError::Invalid);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO meeting_source_tracks (
                track_id, session_id, plan_id, source_kind, required, requested, descriptor_json,
                timestamp_bridge_json, format_json, health
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id(report.track_id),
                id(session_id),
                id(plan_id),
                report.source_kind.as_str(),
                bool_to_i64(required),
                bool_to_i64(requested),
                descriptor_json,
                encode_json(&report.timestamp_bridge)?,
                encode_json(&report.format)?,
                encode_json(&SourceHealth::Starting)?,
            ],
        )?;
        transaction.execute(
            "INSERT INTO meeting_track_checkpoints (
                track_id, next_sequence, durable_offset_ns, durable_bytes, updated_at_utc_ms
             ) VALUES (?1, 0, NULL, 0, ?2)",
            params![id(report.track_id), utc_now_ms()],
        )?;
        transaction.execute(
            "INSERT INTO meeting_source_clock_epochs (
                track_id, source_epoch, format_epoch, bridge_json, observed_host_monotonic_ns
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id(report.track_id),
                to_i64(report.epoch.get())?,
                to_i64(report.format_epoch)?,
                encode_json(&report.timestamp_bridge)?,
                to_i64(report.timestamp_bridge.host_monotonic_anchor_ns)?,
            ],
        )?;
        transaction.commit()?;
        self.ensure_session_directory(session_id)?;
        Ok(())
    }

    pub fn update_track_health(
        &self,
        session_id: MeetingSessionId,
        track_id: SourceTrackId,
        health: SourceHealth,
    ) -> Result<(), StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE meeting_source_tracks SET health = ?1 WHERE track_id = ?2 AND session_id = ?3",
            params![encode_json(&health)?, id(track_id), id(session_id)],
        )?;
        let current = session_row(&transaction, session_id)?;
        let next_revision = current.revision.checked_add(1).ok_or(StoreError::Corrupt)?;
        transaction.execute(
            "UPDATE meeting_sessions SET revision = ?1 WHERE id = ?2",
            params![to_i64(next_revision)?, id(session_id)],
        )?;
        append_event(
            &transaction,
            session_id,
            next_revision,
            current.phase,
            current.phase,
            "source_health_changed",
            None,
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn open_capture_window(
        &self,
        session_id: MeetingSessionId,
        start_offset_ns: u64,
    ) -> Result<(), StoreError> {
        let connection = self.connection()?;
        let sequence: i64 = connection.query_row(
            "SELECT COALESCE(MAX(sequence), -1) + 1 FROM meeting_capture_windows WHERE session_id = ?1",
            params![id(session_id)],
            |row| row.get(0),
        )?;
        connection.execute(
            "INSERT INTO meeting_capture_windows (session_id, sequence, start_offset_ns, end_offset_ns, close_reason)
             VALUES (?1, ?2, ?3, NULL, NULL)",
            params![id(session_id), sequence, to_i64(start_offset_ns)?],
        )?;
        Ok(())
    }

    pub fn close_open_capture_window(
        &self,
        session_id: MeetingSessionId,
        end_offset_ns: u64,
        close_reason: &str,
    ) -> Result<(), StoreError> {
        let connection = self.connection()?;
        connection.execute(
            "UPDATE meeting_capture_windows
             SET end_offset_ns = ?1, close_reason = ?2
             WHERE session_id = ?3 AND end_offset_ns IS NULL",
            params![to_i64(end_offset_ns)?, close_reason, id(session_id)],
        )?;
        Ok(())
    }

    pub fn record_gap(&self, gap: &SourceGap) -> Result<(), StoreError> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO meeting_source_gaps (
                track_id, source_epoch, start_offset_ns, end_offset_ns, reason, dropped_frames,
                observed_at_utc_ms, details_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '{}')",
            params![
                id(gap.track_id),
                to_i64(gap.epoch.get())?,
                optional_i64(gap.start_offset_ns)?,
                optional_i64(gap.end_offset_ns)?,
                encode_json(&gap.reason)?,
                optional_i64(gap.dropped_frames)?,
                utc_now_ms(),
            ],
        )?;
        Ok(())
    }

    pub fn record_clock_epoch(&self, epoch: SourceClockEpoch) -> Result<(), StoreError> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT OR REPLACE INTO meeting_source_clock_epochs (
                track_id, source_epoch, format_epoch, bridge_json, observed_host_monotonic_ns
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id(epoch.track_id),
                to_i64(epoch.epoch.get())?,
                to_i64(epoch.format_epoch)?,
                encode_json(&epoch.bridge)?,
                to_i64(epoch.bridge.host_monotonic_anchor_ns)?,
            ],
        )?;
        Ok(())
    }

    pub fn open_track_writer(
        self: &Arc<Self>,
        session_id: MeetingSessionId,
        track_id: SourceTrackId,
        plan: MeetingStoragePlan,
    ) -> Result<MeetingTrackWriter, StoreError> {
        let track = self.track_row(track_id)?;
        if track.session_id != session_id {
            return Err(StoreError::NotFound);
        }
        let files = self.track_files(session_id, track_id);
        let key = self.track_key(session_id, track_id)?;
        MeetingTrackWriter::open(Arc::clone(self), track_id, files, key, plan)
    }

    pub fn session_snapshot(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingSessionSnapshot, StoreError> {
        let connection = self.connection()?;
        let row = session_row(&connection, session_id)?;
        let sources = source_snapshots(&connection, session_id)?;
        let completeness = derive_completeness(&connection, session_id, &sources)?;
        let open_capture_window_started_at_ns = connection
            .query_row(
                "SELECT start_offset_ns FROM meeting_capture_windows
                 WHERE session_id = ?1 AND end_offset_ns IS NULL ORDER BY sequence DESC LIMIT 1",
                params![id(session_id)],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .map(from_i64)
            .transpose()?;
        let allowed_actions = allowed_actions(row.phase);
        let elapsed_offset_ns = sources
            .iter()
            .filter_map(|source| source.last_durable_offset_ns)
            .max();
        Ok(MeetingSessionSnapshot {
            session_id,
            phase: row.phase,
            revision: row.revision,
            title: row.title,
            started_at_utc_ms: row.started_at_utc_ms,
            elapsed_offset_ns,
            sources,
            open_capture_window_started_at_ns,
            capture_completeness: completeness,
            storage: StorageAvailability::Available,
            processing_status: decode_json(&row.processing_status_json)?,
            retention_deadline_utc_ms: row.delete_after_utc_ms,
            allowed_actions,
        })
    }

    pub fn preflight_snapshot(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingPreflightSnapshot, StoreError> {
        let connection = self.connection()?;
        let row = session_row(&connection, session_id)?;
        if row.phase != MeetingPhase::Preflight {
            return Err(StoreError::Conflict);
        }
        decode_json(&row.preflight_json)
    }

    pub fn list_sessions(
        &self,
        cursor_utc_ms: Option<i64>,
        limit: usize,
    ) -> Result<PaginatedMeetings, StoreError> {
        let page_size = limit.clamp(1, 100);
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, title, phase, created_at_utc_ms, processing_status
             FROM meeting_sessions
             WHERE phase != 'deleting' AND (?1 IS NULL OR created_at_utc_ms < ?1)
             ORDER BY created_at_utc_ms DESC LIMIT ?2",
        )?;
        let rows = statement.query_map(
            params![
                cursor_utc_ms,
                i64::try_from(page_size + 1).map_err(|_| StoreError::Invalid)?
            ],
            |row| {
                let id_value: String = row.get(0)?;
                let phase_value: String = row.get(2)?;
                Ok((
                    id_value,
                    row.get::<_, String>(1)?,
                    phase_value,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )?;
        let mut entries = Vec::new();
        for row in rows {
            let (session, title, phase, created_at_utc_ms, processing_status) = row?;
            let session_id = MeetingSessionId::from_uuid(parse_uuid(&session)?);
            entries.push(MeetingHistorySummary {
                kind: HistoryItemKind::Meeting,
                session_id,
                title,
                phase: phase_from_db(&phase)?,
                created_at_utc_ms,
                capture_completeness: derive_completeness(
                    &connection,
                    session_id,
                    &source_snapshots(&connection, session_id)?,
                )?,
                processing_status: decode_json(&processing_status)?,
            });
        }
        let has_more = entries.len() > page_size;
        entries.truncate(page_size);
        Ok(PaginatedMeetings { entries, has_more })
    }

    /// Return the dense meeting trend from one read-only projection. All
    /// counters are derived from retained rows; the captured duration unions
    /// durable audio intervals so simultaneous sources are never double-counted.
    pub(crate) fn trend_projection(
        &self,
        request: DashboardTrendRequest,
    ) -> Result<MeetingTrendProjection, StoreError> {
        let mut connection = self.connection()?;
        Self::trend_projection_with_connection_at(&mut connection, request, Local::now())
    }

    fn trend_projection_with_connection_at(
        connection: &mut Connection,
        request: DashboardTrendRequest,
        now: DateTime<Local>,
    ) -> Result<MeetingTrendProjection, StoreError> {
        let calendar =
            LocalCalendarRange::at(now, request.range).map_err(|_| StoreError::Invalid)?;
        let rows = {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
            let mut statement = transaction.prepare(
                "WITH retained_sessions AS (
                    SELECT id, revision, created_at_utc_ms, current_transcript_revision_id
                     FROM meeting_sessions
                     WHERE phase != 'deleting'
                 ),
                 durable_intervals AS (
                    SELECT
                        tracks.session_id,
                        tracks.track_id,
                        records.source_sequence,
                        records.start_offset_ns,
                        records.start_offset_ns + records.duration_ns AS end_offset_ns
                     FROM meeting_source_tracks AS tracks
                     JOIN retained_sessions AS sessions ON sessions.id = tracks.session_id
                     JOIN meeting_track_records AS records ON records.track_id = tracks.track_id
                     WHERE records.start_offset_ns IS NOT NULL
                       AND records.duration_ns > 0
                 ),
                 ordered_intervals AS (
                    SELECT
                        session_id,
                        track_id,
                        source_sequence,
                        start_offset_ns,
                        end_offset_ns,
                        MAX(end_offset_ns) OVER (
                            PARTITION BY session_id
                            ORDER BY start_offset_ns, end_offset_ns, track_id, source_sequence
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                        ) AS previous_end_offset_ns
                     FROM durable_intervals
                 ),
                 interval_groups AS (
                    SELECT
                        session_id,
                        start_offset_ns,
                        end_offset_ns,
                        SUM(
                            CASE
                                WHEN previous_end_offset_ns IS NULL
                                  OR start_offset_ns > previous_end_offset_ns
                                THEN 1
                                ELSE 0
                            END
                        ) OVER (
                            PARTITION BY session_id
                            ORDER BY start_offset_ns, end_offset_ns, track_id, source_sequence
                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                        ) AS interval_group
                     FROM ordered_intervals
                 ),
                 merged_intervals AS (
                    SELECT
                        session_id,
                        interval_group,
                        MIN(start_offset_ns) AS start_offset_ns,
                        MAX(end_offset_ns) AS end_offset_ns
                     FROM interval_groups
                     GROUP BY session_id, interval_group
                 ),
                 verified_duration_by_session AS (
                    SELECT
                        session_id,
                        COALESCE(SUM(end_offset_ns - start_offset_ns), 0)
                            AS verified_captured_duration_ns
                     FROM merged_intervals
                     GROUP BY session_id
                 ),
                 segments_by_session AS (
                    SELECT
                        sessions.id AS session_id,
                        COUNT(segments.segment_id) AS transcript_segments
                     FROM retained_sessions AS sessions
                     LEFT JOIN meeting_transcript_segments AS segments
                       ON segments.transcript_revision_id = sessions.current_transcript_revision_id
                      AND COALESCE((SELECT e.removed
                                    FROM meeting_segment_edits AS e
                                    WHERE e.segment_id = segments.segment_id
                                    ORDER BY e.edit_sequence DESC LIMIT 1), 0) = 0
                     GROUP BY sessions.id
                 ),
                 actions_by_session AS (
                    SELECT
                        sessions.id AS session_id,
                        COALESCE(
                            SUM(
                                COALESCE(
                                    json_array_length(
                                        artifacts.content_json,
                                        '$.action_items'
                                    ),
                                    0
                                )
                            ),
                            0
                        ) AS generated_action_items
                     FROM retained_sessions AS sessions
                     LEFT JOIN meeting_artifact_revisions AS artifacts
                       ON artifacts.session_id = sessions.id
                      AND artifacts.transcript_revision_id =
                          sessions.current_transcript_revision_id
                      AND artifacts.input_revision = sessions.revision
                      AND artifacts.state = 'current'
                     GROUP BY sessions.id
                 ),
                 session_metrics AS (
                    SELECT
                        sessions.created_at_utc_ms,
                        date(
                            sessions.created_at_utc_ms / 1000,
                            'unixepoch',
                            'localtime'
                        ) AS local_date,
                        COALESCE(
                            duration.verified_captured_duration_ns,
                            0
                        ) AS verified_captured_duration_ns,
                        COALESCE(segments.transcript_segments, 0) AS transcript_segments,
                        COALESCE(actions.generated_action_items, 0) AS generated_action_items
                     FROM retained_sessions AS sessions
                     LEFT JOIN verified_duration_by_session AS duration
                       ON duration.session_id = sessions.id
                     LEFT JOIN segments_by_session AS segments
                       ON segments.session_id = sessions.id
                     LEFT JOIN actions_by_session AS actions
                       ON actions.session_id = sessions.id
                 ),
                 range_days AS (
                    SELECT
                        local_date,
                        COUNT(*) AS meetings,
                        COALESCE(SUM(verified_captured_duration_ns), 0)
                            AS verified_captured_duration_ns,
                        COALESCE(SUM(transcript_segments), 0) AS transcript_segments,
                        COALESCE(SUM(generated_action_items), 0) AS generated_action_items
                     FROM session_metrics
                     WHERE created_at_utc_ms >= ?1 AND created_at_utc_ms < ?2
                     GROUP BY local_date
                 ),
                 all_time AS (
                    SELECT
                        COUNT(*) AS meetings,
                        COALESCE(SUM(verified_captured_duration_ns), 0)
                            AS verified_captured_duration_ns,
                        COALESCE(SUM(transcript_segments), 0) AS transcript_segments,
                        COALESCE(SUM(generated_action_items), 0) AS generated_action_items
                     FROM session_metrics
                 )
                 SELECT
                    'range_day' AS projection,
                    local_date,
                    meetings,
                    verified_captured_duration_ns,
                    transcript_segments,
                    generated_action_items
                 FROM range_days
                 UNION ALL
                 SELECT
                    'all_time' AS projection,
                    NULL AS local_date,
                    meetings,
                    verified_captured_duration_ns,
                    transcript_segments,
                    generated_action_items
                 FROM all_time",
            )?;
            let rows = statement.query_map(
                params![calendar.start_utc_ms(), calendar.end_exclusive_utc_ms()],
                |row| {
                    Ok((
                        row.get::<_, String>("projection")?,
                        row.get::<_, Option<String>>("local_date")?,
                        row.get::<_, i64>("meetings")?,
                        row.get::<_, i64>("verified_captured_duration_ns")?,
                        row.get::<_, i64>("transcript_segments")?,
                        row.get::<_, i64>("generated_action_items")?,
                    ))
                },
            )?;
            let collected = rows.collect::<std::result::Result<Vec<_>, _>>()?;
            drop(statement);
            transaction.commit()?;
            collected
        };

        let mut daily_values = HashMap::<String, MeetingTrendValues>::new();
        let mut all_time_values = MeetingTrendValues::default();
        for row in rows {
            let (
                projection,
                local_date,
                meetings,
                verified_captured_duration_ns,
                transcript_segments,
                generated_action_items,
            ) = row;
            let values = MeetingTrendValues {
                meetings: meeting_trend_value(meetings)?,
                verified_captured_duration_ns: meeting_trend_value(verified_captured_duration_ns)?,
                transcript_segments: meeting_trend_value(transcript_segments)?,
                generated_action_items: meeting_trend_value(generated_action_items)?,
            };
            match projection.as_str() {
                "range_day" => {
                    let local_date = local_date.ok_or(StoreError::Corrupt)?;
                    daily_values.entry(local_date).or_default().add(values)?;
                }
                "all_time" => all_time_values.add(values)?,
                _ => return Err(StoreError::Corrupt),
            }
        }

        let mut range_values = MeetingTrendValues::default();
        let mut points = Vec::with_capacity(request.range.days());
        for date in calendar.local_dates().map_err(|_| StoreError::Invalid)? {
            let values = daily_values
                .remove(&date.format("%F").to_string())
                .unwrap_or_default();
            range_values.add(values)?;
            let totals = values.totals();
            points.push(MeetingTrendPoint {
                local_date: date.format("%F").to_string(),
                meetings: totals.meetings,
                verified_captured_duration_ms: totals.verified_captured_duration_ms,
                transcript_segments: totals.transcript_segments,
                generated_action_items: totals.generated_action_items,
            });
        }
        if !daily_values.is_empty() {
            return Err(StoreError::Corrupt);
        }

        Ok(MeetingTrendProjection::Available {
            range: request.range,
            range_start_local_date: calendar.start_local_date(),
            range_end_local_date: calendar.end_local_date(),
            all_time: all_time_values.totals(),
            range_total: range_values.totals(),
            points,
        })
    }

    pub fn set_title(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
        title: String,
    ) -> Result<OperationReceipt, StoreError> {
        self.edit_session(
            StoreMutation {
                operation_id,
                requested_at_utc_ms,
                session_id,
                expected_revision,
                command: MeetingCommandKind::TitleSet,
            },
            "title_set",
            |transaction| {
                transaction.execute(
                    "UPDATE meeting_sessions SET title = ?1 WHERE id = ?2",
                    params![title, id(session_id)],
                )?;
                mark_artifacts_out_of_date(transaction, session_id)?;
                rebuild_search_documents_in(transaction, session_id)
            },
        )
    }

    pub fn create_note(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        note: &ManualNote,
        expected_revision: u64,
    ) -> Result<OperationReceipt, StoreError> {
        self.edit_session(
            StoreMutation {
                operation_id,
                requested_at_utc_ms,
                session_id: note.session_id,
                expected_revision,
                command: MeetingCommandKind::NoteCreate,
            },
            "note_created",
            |transaction| {
                transaction.execute(
                    "INSERT INTO meeting_notes (
                        note_id, session_id, start_offset_ns, end_offset_ns, body, note_revision,
                        created_at_utc_ms, updated_at_utc_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        id(note.note_id),
                        id(note.session_id),
                        optional_i64(note.start_offset_ns)?,
                        optional_i64(note.end_offset_ns)?,
                        note.body,
                        to_i64(note.revision)?,
                        note.created_at_utc_ms,
                        note.updated_at_utc_ms,
                    ],
                )?;
                mark_artifacts_out_of_date(transaction, note.session_id)?;
                rebuild_search_documents_in(transaction, note.session_id)
            },
        )
    }

    pub fn update_note(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        note: &ManualNote,
        expected_session_revision: u64,
        expected_note_revision: u64,
    ) -> Result<OperationReceipt, StoreError> {
        self.edit_session(
            StoreMutation {
                operation_id,
                requested_at_utc_ms,
                session_id: note.session_id,
                expected_revision: expected_session_revision,
                command: MeetingCommandKind::NoteUpdate,
            },
            "note_updated",
            |transaction| {
                let changed = transaction.execute(
                    "UPDATE meeting_notes
                     SET start_offset_ns = ?1, end_offset_ns = ?2, body = ?3,
                         note_revision = ?4, updated_at_utc_ms = ?5
                     WHERE note_id = ?6 AND session_id = ?7 AND note_revision = ?8",
                    params![
                        optional_i64(note.start_offset_ns)?,
                        optional_i64(note.end_offset_ns)?,
                        note.body,
                        to_i64(note.revision)?,
                        note.updated_at_utc_ms,
                        id(note.note_id),
                        id(note.session_id),
                        to_i64(expected_note_revision)?,
                    ],
                )?;
                if changed != 1 {
                    return Err(StoreError::Conflict);
                }
                mark_artifacts_out_of_date(transaction, note.session_id)?;
                rebuild_search_documents_in(transaction, note.session_id)
            },
        )
    }

    pub fn delete_note(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_session_revision: u64,
        note_id: ManualNoteId,
        expected_note_revision: u64,
    ) -> Result<OperationReceipt, StoreError> {
        self.edit_session(
            StoreMutation {
                operation_id,
                requested_at_utc_ms,
                session_id,
                expected_revision: expected_session_revision,
                command: MeetingCommandKind::NoteDelete,
            },
            "note_deleted",
            |transaction| {
                let changed = transaction.execute(
                    "DELETE FROM meeting_notes WHERE note_id = ?1 AND session_id = ?2 AND note_revision = ?3",
                    params![id(note_id), id(session_id), to_i64(expected_note_revision)?],
                )?;
                if changed != 1 {
                    return Err(StoreError::Conflict);
                }
                mark_artifacts_out_of_date(transaction, session_id)?;
                rebuild_search_documents_in(transaction, session_id)
            },
        )
    }

    pub fn rename_speaker(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
        speaker_id: SpeakerId,
        display_name: String,
    ) -> Result<OperationReceipt, StoreError> {
        self.edit_session(
            StoreMutation {
                operation_id,
                requested_at_utc_ms,
                session_id,
                expected_revision,
                command: MeetingCommandKind::SpeakerRename,
            },
            "speaker_renamed",
            |transaction| {
                let changed = transaction.execute(
                    "UPDATE meeting_speakers SET display_name = ?1, revision = revision + 1
                     WHERE speaker_id = ?2 AND session_id = ?3",
                    params![display_name, id(speaker_id), id(session_id)],
                )?;
                if changed != 1 {
                    return Err(StoreError::NotFound);
                }
                mark_artifacts_out_of_date(transaction, session_id)
            },
        )
    }

    pub fn merge_speaker(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
        source_speaker_id: SpeakerId,
        target_speaker_id: SpeakerId,
    ) -> Result<OperationReceipt, StoreError> {
        if source_speaker_id == target_speaker_id {
            return Err(StoreError::Invalid);
        }
        self.edit_session(
            StoreMutation {
                operation_id,
                requested_at_utc_ms,
                session_id,
                expected_revision,
                command: MeetingCommandKind::SpeakerMerge,
            },
            "speaker_merged",
            |transaction| {
                let changed = transaction.execute(
                    "UPDATE meeting_speakers SET merged_into_speaker_id = ?1, revision = revision + 1
                     WHERE speaker_id = ?2 AND session_id = ?3",
                    params![id(target_speaker_id), id(source_speaker_id), id(session_id)],
                )?;
                if changed != 1 {
                    return Err(StoreError::NotFound);
                }
                mark_artifacts_out_of_date(transaction, session_id)
            },
        )
    }

    pub(crate) fn edit_segment(&self, edit: SegmentEdit) -> Result<OperationReceipt, StoreError> {
        let SegmentEdit {
            mutation,
            segment_id,
            replacement_text,
            removed,
        } = edit;
        let session_id = mutation.session_id;
        self.edit_session(mutation, "segment_edited", |transaction| {
            let segment_exists: Option<i64> = transaction
                .query_row(
                    "SELECT 1 FROM meeting_transcript_segments s
                     JOIN meeting_transcript_revisions r ON r.transcript_revision_id = s.transcript_revision_id
                     WHERE s.segment_id = ?1 AND r.session_id = ?2",
                    params![id(segment_id), id(session_id)],
                    |row| row.get(0),
                )
                .optional()?;
            if segment_exists.is_none() {
                return Err(StoreError::NotFound);
            }
            let sequence: i64 = transaction.query_row(
                "SELECT COALESCE(MAX(edit_sequence), -1) + 1 FROM meeting_segment_edits WHERE segment_id = ?1",
                params![id(segment_id)],
                |row| row.get(0),
            )?;
            transaction.execute(
                "INSERT INTO meeting_segment_edits (
                    segment_id, edit_sequence, replacement_text, removed, operator_at_utc_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id(segment_id), sequence, replacement_text, bool_to_i64(removed), utc_now_ms()],
            )?;
            mark_artifacts_out_of_date(transaction, session_id)?;
            rebuild_search_documents_in(transaction, session_id)
        })
    }

    pub fn ask_question(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
        question_id: MeetingQuestionId,
        question: String,
    ) -> Result<(OperationReceipt, MeetingAnswer), StoreError> {
        let answer_question = question.clone();
        let receipt = self.edit_session(
            StoreMutation {
                operation_id,
                requested_at_utc_ms,
                session_id,
                expected_revision,
                command: MeetingCommandKind::QuestionAsk,
            },
            "question_asked",
            |transaction| {
                transaction.execute(
                    "INSERT INTO meeting_questions (
                        question_id, session_id, question_text, answer_state, answer_text, revision, created_at_utc_ms
                     ) VALUES (?1, ?2, ?3, 'insufficient_evidence', NULL, 0, ?4)",
                    params![id(question_id), id(session_id), question, utc_now_ms()],
                )?;
                Ok(())
            },
        )?;
        Ok((
            receipt,
            MeetingAnswer {
                question_id,
                session_id,
                scope: MeetingQuestionScope::ThisMeeting,
                question: Some(answer_question),
                state: MeetingAnswerState::InsufficientEvidence,
                answer: None,
                citations: Vec::new(),
                input_revision: expected_revision,
                revision: 0,
                created_at_utc_ms: requested_at_utc_ms,
            },
        ))
    }

    pub fn forget_question(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
        question_id: MeetingQuestionId,
    ) -> Result<OperationReceipt, StoreError> {
        self.edit_session(
            StoreMutation {
                operation_id,
                requested_at_utc_ms,
                session_id,
                expected_revision,
                command: MeetingCommandKind::QuestionForget,
            },
            "question_forgotten",
            |transaction| {
                let changed = transaction.execute(
                    "DELETE FROM meeting_questions WHERE question_id = ?1 AND session_id = ?2",
                    params![id(question_id), id(session_id)],
                )?;
                if changed != 1 {
                    return Err(StoreError::NotFound);
                }
                Ok(())
            },
        )
    }

    pub fn review_snapshot(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingReviewSnapshot, StoreError> {
        let session = self.session_snapshot(session_id)?;
        let connection = self.connection()?;
        let tracks = track_snapshots(&connection, session_id)?;
        let gaps = gaps_for_session(&connection, session_id)?;
        let speakers = speakers_for_session(&connection, session_id)?;
        let transcript = effective_segments_for_session(&connection, session_id)?;
        let notes = notes_for_session(&connection, session_id)?;
        let artifacts = artifact_revisions_for_session(&connection, session_id)?;
        let questions = question_history_for_session(&connection, session_id)?;
        let diarization = diarization_snapshot_for_session(&connection, session_id)?;
        let remote_cancellation_pending: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM meeting_remote_jobs WHERE session_id = ?1 AND cancellation_requested = 1)",
            params![id(session_id)],
            |row| row.get(0),
        )?;
        Ok(MeetingReviewSnapshot {
            can_export: matches!(
                session.phase,
                MeetingPhase::ReviewReady | MeetingPhase::RecoveryRequired
            ),
            session,
            tracks,
            gaps,
            speakers,
            transcript,
            notes,
            artifacts,
            questions,
            diarization,
            remote_cancellation_pending,
        })
    }

    pub(crate) fn begin_transcript_revision(
        &self,
        input: TranscriptRevisionInput<'_>,
    ) -> Result<TranscriptRevisionId, StoreError> {
        let revision_id = TranscriptRevisionId::new();
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        session_row(&transaction, input.session_id)?;
        transaction.execute(
            "INSERT INTO meeting_transcript_revisions (
                transcript_revision_id, session_id, engine_id, model_version, destination_json,
                source_set_json, language, state, created_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8)",
            params![
                id(revision_id),
                id(input.session_id),
                input.engine_id,
                input.model_version,
                encode_json(input.destination)?,
                encode_json(input.source_set)?,
                input.language,
                utc_now_ms(),
            ],
        )?;
        transaction.commit()?;
        Ok(revision_id)
    }

    pub(crate) fn append_transcript_segments(
        &self,
        session_id: MeetingSessionId,
        transcript_revision_id: TranscriptRevisionId,
        segments: &[TranscriptSegmentInput],
    ) -> Result<(), StoreError> {
        if segments.is_empty() {
            return Ok(());
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let owner: String = transaction.query_row(
            "SELECT session_id FROM meeting_transcript_revisions WHERE transcript_revision_id = ?1 AND state = 'running'",
            params![id(transcript_revision_id)],
            |row| row.get(0),
        )?;
        if parse_uuid(&owner)? != session_id.uuid() {
            return Err(StoreError::Invalid);
        }
        let next_ordinal: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(ordinal), -1) + 1
             FROM meeting_transcript_segments WHERE transcript_revision_id = ?1",
            params![id(transcript_revision_id)],
            |row| row.get(0),
        )?;
        for (index, segment) in segments.iter().enumerate() {
            if segment.start_offset_ns >= segment.end_offset_ns || segment.text.trim().is_empty() {
                return Err(StoreError::Invalid);
            }
            let source_kind = source_kind_from_db(&transaction.query_row(
                "SELECT source_kind FROM meeting_source_tracks WHERE track_id = ?1 AND session_id = ?2",
                params![id(segment.track_id), id(session_id)],
                |row| row.get::<_, String>(0),
            )?)
            .map_err(|_| StoreError::Corrupt)?;
            if source_kind != segment.source_kind {
                return Err(StoreError::Invalid);
            }
            let speaker_id = source_speaker_for(&transaction, session_id, source_kind)?;
            let ordinal = next_ordinal
                .checked_add(i64::try_from(index).map_err(|_| StoreError::Corrupt)?)
                .ok_or(StoreError::Corrupt)?;
            transaction.execute(
                "INSERT INTO meeting_transcript_segments (
                    segment_id, transcript_revision_id, track_id, ordinal, start_offset_ns,
                    end_offset_ns, speaker_id, base_text, confidence_milli
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id(TranscriptSegmentId::new()),
                    id(transcript_revision_id),
                    id(segment.track_id),
                    ordinal,
                    to_i64(segment.start_offset_ns)?,
                    to_i64(segment.end_offset_ns)?,
                    id(speaker_id),
                    segment.text,
                    segment.confidence_milli.map(i64::from),
                ],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub(crate) fn complete_transcript_revision(
        &self,
        session_id: MeetingSessionId,
        transcript_revision_id: TranscriptRevisionId,
    ) -> Result<(), StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let owner: String = transaction.query_row(
            "SELECT session_id FROM meeting_transcript_revisions WHERE transcript_revision_id = ?1 AND state = 'running'",
            params![id(transcript_revision_id)],
            |row| row.get(0),
        )?;
        if parse_uuid(&owner)? != session_id.uuid() {
            return Err(StoreError::Invalid);
        }
        transaction.execute(
            "UPDATE meeting_transcript_revisions
             SET state = 'completed', completed_at_utc_ms = ?1
             WHERE transcript_revision_id = ?2",
            params![utc_now_ms(), id(transcript_revision_id)],
        )?;
        transaction.execute(
            "UPDATE meeting_sessions SET current_transcript_revision_id = ?1 WHERE id = ?2",
            params![id(transcript_revision_id), id(session_id)],
        )?;
        mark_artifacts_out_of_date(&transaction, session_id)?;
        rebuild_search_documents_in(&transaction, session_id)?;
        transaction.commit()?;
        Ok(())
    }

    pub(crate) fn current_transcript_revision_id(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<TranscriptRevisionId, StoreError> {
        let connection = self.connection()?;
        let value = connection
            .query_row(
                "SELECT current_transcript_revision_id FROM meeting_sessions WHERE id = ?1",
                params![id(session_id)],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten()
            .ok_or(StoreError::NotFound)?;
        Ok(TranscriptRevisionId::from_uuid(parse_uuid(&value)?))
    }

    pub(crate) fn transcript_segments_overlapping(
        &self,
        transcript_revision_id: TranscriptRevisionId,
        track_id: SourceTrackId,
        start_offset_ns: u64,
        end_offset_ns: u64,
    ) -> Result<Vec<TranscriptSegmentId>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT segment_id FROM meeting_transcript_segments
             WHERE transcript_revision_id = ?1 AND track_id = ?2
               AND start_offset_ns < ?3 AND end_offset_ns > ?4
             ORDER BY start_offset_ns, ordinal",
        )?;
        let rows = statement.query_map(
            params![
                id(transcript_revision_id),
                id(track_id),
                to_i64(end_offset_ns)?,
                to_i64(start_offset_ns)?,
            ],
            |row| row.get::<_, String>(0),
        )?;
        rows.map(|row| {
            row.map_err(Into::into)
                .and_then(|value| Ok(TranscriptSegmentId::from_uuid(parse_uuid(&value)?)))
        })
        .collect()
    }

    pub(crate) fn begin_diarization_generation(
        &self,
        session_id: MeetingSessionId,
        transcript_revision_id: TranscriptRevisionId,
        input_revision: u64,
        model_id: &str,
        model_version: &str,
    ) -> Result<MeetingDiarizationGenerationId, StoreError> {
        let generation_id = MeetingDiarizationGenerationId::new();
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO meeting_diarization_generations (
                generation_id, session_id, transcript_revision_id, input_revision, model_id,
                model_version, state, created_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', ?7)",
            params![
                id(generation_id),
                id(session_id),
                id(transcript_revision_id),
                to_i64(input_revision)?,
                model_id,
                model_version,
                utc_now_ms(),
            ],
        )?;
        Ok(generation_id)
    }

    pub(crate) fn diarization_speaker(
        &self,
        session_id: MeetingSessionId,
        cluster: u32,
    ) -> Result<SpeakerId, StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let speaker_id = named_speaker_for(
            &transaction,
            session_id,
            SourceKind::SystemAudio,
            &format!("Speaker {}", cluster.saturating_add(1)),
        )?;
        transaction.commit()?;
        Ok(speaker_id)
    }

    pub(crate) fn write_diarization_assignments(
        &self,
        generation_id: MeetingDiarizationGenerationId,
        assignments: &[DiarizationAssignmentInput],
    ) -> Result<(), StoreError> {
        if assignments.is_empty() {
            return Ok(());
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let state: String = transaction.query_row(
            "SELECT state FROM meeting_diarization_generations WHERE generation_id = ?1",
            params![id(generation_id)],
            |row| row.get(0),
        )?;
        if state != "running" {
            return Err(StoreError::Conflict);
        }
        for assignment in assignments {
            transaction.execute(
                "INSERT INTO meeting_diarization_assignments (
                    generation_id, segment_id, speaker_id, assignment_kind
                 ) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(generation_id, segment_id) DO UPDATE SET
                    speaker_id = excluded.speaker_id,
                    assignment_kind = excluded.assignment_kind",
                params![
                    id(generation_id),
                    id(assignment.segment_id),
                    id(assignment.speaker_id),
                    speaker_assignment_to_db(assignment.assignment),
                ],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub(crate) fn publish_diarization_generation(
        &self,
        session_id: MeetingSessionId,
        generation_id: MeetingDiarizationGenerationId,
    ) -> Result<u64, StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let (owner, transcript_revision, model_id, model_version): (
            String,
            String,
            String,
            String,
        ) = transaction.query_row(
            "SELECT session_id, transcript_revision_id, model_id, model_version
                 FROM meeting_diarization_generations
                 WHERE generation_id = ?1 AND state = 'running'",
            params![id(generation_id)],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        if parse_uuid(&owner)? != session_id.uuid() {
            return Err(StoreError::Invalid);
        }
        let current: String = transaction.query_row(
            "SELECT current_transcript_revision_id FROM meeting_sessions WHERE id = ?1",
            params![id(session_id)],
            |row| row.get(0),
        )?;
        if current != transcript_revision {
            return Err(StoreError::Conflict);
        }
        let session = session_row(&transaction, session_id)?;
        let next_revision = session.revision.checked_add(1).ok_or(StoreError::Corrupt)?;
        transaction.execute(
            "UPDATE meeting_diarization_generations
             SET state = 'completed', completed_at_utc_ms = ?1
             WHERE generation_id = ?2",
            params![utc_now_ms(), id(generation_id)],
        )?;
        transaction.execute(
            "UPDATE meeting_sessions
             SET current_diarization_generation_id = ?1, diarization_status = 'succeeded',
                 diarization_model_id = ?2, diarization_model_version = ?3, revision = ?4
             WHERE id = ?5",
            params![
                id(generation_id),
                model_id,
                model_version,
                to_i64(next_revision)?,
                id(session_id),
            ],
        )?;
        mark_artifacts_out_of_date(&transaction, session_id)?;
        append_event(
            &transaction,
            session_id,
            next_revision,
            session.phase,
            session.phase,
            "diarization_published",
            None,
        )?;
        transaction.commit()?;
        Ok(next_revision)
    }

    pub(crate) fn artifact_by_generation_key(
        &self,
        session_id: MeetingSessionId,
        generation_key: &str,
    ) -> Result<Option<MeetingArtifactRevision>, StoreError> {
        let connection = self.connection()?;
        artifact_revision_for_key(&connection, session_id, generation_key)
    }

    pub(crate) fn store_artifact_revision(
        &self,
        input: ArtifactRevisionInput<'_>,
    ) -> Result<MeetingArtifactRevision, StoreError> {
        if matches!(input.state, MeetingArtifactState::Current) && input.content.is_none() {
            return Err(StoreError::Invalid);
        }
        let existing = self.artifact_by_generation_key(input.session_id, input.generation_key)?;
        if existing
            .as_ref()
            .is_some_and(|artifact| artifact.state != MeetingArtifactState::Failed)
        {
            return existing.ok_or(StoreError::Corrupt);
        }
        let artifact_id = existing
            .as_ref()
            .map(|artifact| artifact.artifact_id)
            .unwrap_or_else(MeetingArtifactId::new);
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let session = session_row(&transaction, input.session_id)?;
        let state = if input.state == MeetingArtifactState::Current
            && session.revision != input.input_revision
        {
            MeetingArtifactState::OutOfDate
        } else {
            input.state
        };
        let content = input.content.map(encode_json).transpose()?;
        transaction.execute(
            "INSERT INTO meeting_artifact_revisions (
                artifact_id, session_id, transcript_revision_id, input_revision, template_id,
                template_version, generation_key, state, content_json, generated_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(session_id, generation_key) DO UPDATE SET
                transcript_revision_id = excluded.transcript_revision_id,
                input_revision = excluded.input_revision,
                template_id = excluded.template_id,
                template_version = excluded.template_version,
                state = excluded.state,
                content_json = excluded.content_json,
                generated_at_utc_ms = excluded.generated_at_utc_ms",
            params![
                id(artifact_id),
                id(input.session_id),
                id(input.transcript_revision_id),
                to_i64(input.input_revision)?,
                input.template_id,
                i64::from(input.template_version),
                input.generation_key,
                artifact_state_to_db(state),
                content,
                input.generated_at_utc_ms,
            ],
        )?;
        transaction.commit()?;
        self.artifact_by_generation_key(input.session_id, input.generation_key)?
            .ok_or(StoreError::Corrupt)
    }
    pub(crate) fn scoped_session_ids(
        &self,
        session_id: MeetingSessionId,
        scope: &MeetingQuestionScope,
    ) -> Result<Vec<MeetingSessionId>, StoreError> {
        let mut session_ids = match scope {
            MeetingQuestionScope::ThisMeeting => vec![session_id],
            MeetingQuestionScope::ExplicitSeries { session_ids } => session_ids.clone(),
        };
        if session_ids.is_empty() || !session_ids.contains(&session_id) {
            return Err(StoreError::Invalid);
        }
        session_ids.sort_by_key(|id| id.uuid());
        session_ids.dedup();
        let connection = self.connection()?;
        for scoped_id in &session_ids {
            let phase: String = connection
                .query_row(
                    "SELECT phase FROM meeting_sessions WHERE id = ?1",
                    params![id(*scoped_id)],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or(StoreError::NotFound)?;
            if phase_from_db(&phase)? == MeetingPhase::Deleting {
                return Err(StoreError::NotFound);
            }
        }
        Ok(session_ids)
    }

    pub(crate) fn search_evidence(
        &self,
        session_ids: &[MeetingSessionId],
        query: &str,
        limit: usize,
    ) -> Result<Vec<MeetingEvidence>, StoreError> {
        let Some(match_query) = meeting_fts_match_query(query) else {
            return Ok(Vec::new());
        };
        if session_ids.is_empty() {
            return Err(StoreError::Invalid);
        }
        let mut placeholders = String::new();
        for index in 0..session_ids.len() {
            if index > 0 {
                placeholders.push_str(", ");
            }
            placeholders.push('?');
            placeholders.push_str(&(index + 2).to_string());
        }
        let limit = limit.clamp(1, 50);
        let limit_parameter = session_ids.len() + 2;
        let sql = format!(
            "SELECT d.session_id, d.entity_kind, d.entity_id, d.content,
                    s.start_offset_ns, s.end_offset_ns, n.start_offset_ns, n.end_offset_ns
             FROM meeting_search_fts
             JOIN meeting_search_documents d ON d.id = meeting_search_fts.rowid
             LEFT JOIN meeting_sessions m ON m.id = d.session_id
             LEFT JOIN meeting_transcript_segments s
               ON d.entity_kind = 'segment' AND s.segment_id = d.entity_id
              AND s.transcript_revision_id = m.current_transcript_revision_id
             LEFT JOIN meeting_notes n
               ON d.entity_kind = 'note' AND n.note_id = d.entity_id
             WHERE meeting_search_fts MATCH ?1 AND d.session_id IN ({placeholders})
             ORDER BY bm25(meeting_search_fts)
             LIMIT ?{limit_parameter}"
        );
        let mut values = Vec::with_capacity(session_ids.len() + 2);
        values.push(rusqlite::types::Value::Text(match_query));
        values.extend(
            session_ids
                .iter()
                .map(|session_id| rusqlite::types::Value::Text(id(*session_id))),
        );
        values.push(rusqlite::types::Value::Integer(
            i64::try_from(limit).map_err(|_| StoreError::Invalid)?,
        ));
        let connection = self.connection()?;
        let mut statement = connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(values.iter()), |row| {
            let session_id = MeetingSessionId::from_uuid(
                parse_uuid(&row.get::<_, String>(0)?).map_err(to_sql_error)?,
            );
            let entity_kind: String = row.get(1)?;
            let (kind, start, end) = match entity_kind.as_str() {
                "segment" => (
                    CitationKind::Transcript,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ),
                "note" => (
                    CitationKind::ManualNote,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                ),
                "title" => (CitationKind::Title, None, None),
                _ => return Err(to_sql_error(StoreError::Corrupt)),
            };
            let citation = MeetingCitation {
                kind,
                session_id,
                entity_id: row.get(2)?,
                start_offset_ns: start.map(from_i64).transpose().map_err(to_sql_error)?,
                end_offset_ns: end.map(from_i64).transpose().map_err(to_sql_error)?,
            };
            Ok(MeetingEvidence {
                citation,
                text: bounded_text(&row.get::<_, String>(3)?, 4_096),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub(crate) fn record_question_answer(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
        answer: &MeetingAnswer,
        save_history: bool,
    ) -> Result<OperationReceipt, StoreError> {
        if let Some(receipt) = self.operation_receipt(operation_id)? {
            return Ok(receipt);
        }
        if answer.session_id != session_id {
            return Err(StoreError::Invalid);
        }
        let mutation = StoreMutation {
            operation_id,
            requested_at_utc_ms,
            session_id,
            expected_revision,
            command: MeetingCommandKind::QuestionAsk,
        };
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let current = session_row(&transaction, session_id)?;
        if current.revision != expected_revision {
            let receipt = rejected_receipt(
                mutation,
                current.phase,
                current.revision,
                MeetingReasonCode::StaleRevision,
            );
            insert_operation_receipt(&transaction, &receipt, requested_at_utc_ms)?;
            transaction.commit()?;
            return Ok(receipt);
        }
        if !matches!(
            current.phase,
            MeetingPhase::ReviewReady | MeetingPhase::RecoveryRequired
        ) {
            return Err(StoreError::Conflict);
        }
        if save_history {
            let question = answer.question.as_deref().ok_or(StoreError::Invalid)?;
            transaction.execute(
                "INSERT INTO meeting_questions (
                    question_id, session_id, question_text, scope_json, answer_state, answer_text,
                    input_revision, revision, created_at_utc_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id(answer.question_id),
                    id(session_id),
                    question,
                    encode_json(&answer.scope)?,
                    meeting_answer_state_to_db(answer.state),
                    answer.answer,
                    to_i64(answer.input_revision)?,
                    to_i64(answer.revision)?,
                    answer.created_at_utc_ms,
                ],
            )?;
            for (ordinal, citation) in answer.citations.iter().enumerate() {
                transaction.execute(
                    "INSERT INTO meeting_question_citations (question_id, ordinal, citation_json)
                     VALUES (?1, ?2, ?3)",
                    params![
                        id(answer.question_id),
                        i64::try_from(ordinal).map_err(|_| StoreError::Corrupt)?,
                        encode_json(citation)?,
                    ],
                )?;
            }
        }
        let receipt = committed_receipt(
            mutation,
            current.phase,
            current.phase,
            requested_at_utc_ms,
            current.revision,
            save_history
                .then(|| id(answer.question_id))
                .into_iter()
                .collect(),
        );
        insert_operation_receipt(&transaction, &receipt, requested_at_utc_ms)?;
        transaction.commit()?;
        Ok(receipt)
    }

    pub(crate) fn artifact_evidence(
        &self,
        session_id: MeetingSessionId,
        max_bytes: usize,
    ) -> Result<ArtifactEvidence, StoreError> {
        if max_bytes == 0 {
            return Err(StoreError::Invalid);
        }
        let connection = self.connection()?;
        let mut used = 0_usize;
        let mut transcript = Vec::new();
        let mut segments = connection.prepare(
            "SELECT s.segment_id, s.start_offset_ns, s.end_offset_ns,
                    COALESCE((SELECT e.replacement_text FROM meeting_segment_edits e
                              WHERE e.segment_id = s.segment_id
                              ORDER BY e.edit_sequence DESC LIMIT 1), s.base_text)
             FROM meeting_sessions m
             JOIN meeting_transcript_segments s
               ON s.transcript_revision_id = m.current_transcript_revision_id
             WHERE m.id = ?1
               AND COALESCE((SELECT e.removed FROM meeting_segment_edits e
                             WHERE e.segment_id = s.segment_id
                             ORDER BY e.edit_sequence DESC LIMIT 1), 0) = 0
             ORDER BY s.start_offset_ns, s.ordinal",
        )?;
        let mut rows = segments.query(params![id(session_id)])?;
        while let Some(row) = rows.next()? {
            let text: String = row.get(3)?;
            if text.trim().is_empty() || used >= max_bytes {
                if used >= max_bytes {
                    break;
                }
                continue;
            }
            let remaining = max_bytes.saturating_sub(used);
            let text = bounded_text(&text, remaining);
            used = used.saturating_add(text.len());
            transcript.push(MeetingEvidence {
                citation: MeetingCitation {
                    kind: CitationKind::Transcript,
                    session_id,
                    entity_id: row.get(0)?,
                    start_offset_ns: Some(from_i64(row.get(1)?)?),
                    end_offset_ns: Some(from_i64(row.get(2)?)?),
                },
                text,
            });
        }
        drop(rows);
        drop(segments);
        let mut manual_notes = Vec::new();
        if used < max_bytes {
            let mut notes = connection.prepare(
                "SELECT note_id, start_offset_ns, end_offset_ns, body
                 FROM meeting_notes WHERE session_id = ?1 ORDER BY updated_at_utc_ms",
            )?;
            let mut rows = notes.query(params![id(session_id)])?;
            while let Some(row) = rows.next()? {
                if used >= max_bytes {
                    break;
                }
                let body: String = row.get(3)?;
                if body.trim().is_empty() {
                    continue;
                }
                let text = bounded_text(&body, max_bytes.saturating_sub(used));
                used = used.saturating_add(text.len());
                let start: Option<i64> = row.get(1)?;
                let end: Option<i64> = row.get(2)?;
                manual_notes.push(MeetingEvidence {
                    citation: MeetingCitation {
                        kind: CitationKind::ManualNote,
                        session_id,
                        entity_id: row.get(0)?,
                        start_offset_ns: start.map(from_i64).transpose()?,
                        end_offset_ns: end.map(from_i64).transpose()?,
                    },
                    text,
                });
            }
        }
        Ok(ArtifactEvidence {
            transcript,
            manual_notes,
        })
    }

    pub(crate) fn fallback_system_speaker(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<SpeakerId, StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let speaker_id = source_speaker_for(&transaction, session_id, SourceKind::SystemAudio)?;
        transaction.commit()?;
        Ok(speaker_id)
    }

    pub(crate) fn record_artifact_regeneration(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
        artifact_id: MeetingArtifactId,
    ) -> Result<OperationReceipt, StoreError> {
        if let Some(receipt) = self.operation_receipt(operation_id)? {
            return Ok(receipt);
        }
        let mutation = StoreMutation {
            operation_id,
            requested_at_utc_ms,
            session_id,
            expected_revision,
            command: MeetingCommandKind::ArtifactsRegenerate,
        };
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let current = session_row(&transaction, session_id)?;
        if current.revision != expected_revision {
            let receipt = rejected_receipt(
                mutation,
                current.phase,
                current.revision,
                MeetingReasonCode::StaleRevision,
            );
            insert_operation_receipt(&transaction, &receipt, requested_at_utc_ms)?;
            transaction.commit()?;
            return Ok(receipt);
        }
        if !matches!(
            current.phase,
            MeetingPhase::ReviewReady | MeetingPhase::RecoveryRequired
        ) {
            return Err(StoreError::Conflict);
        }
        let receipt = committed_receipt(
            mutation,
            current.phase,
            current.phase,
            requested_at_utc_ms,
            current.revision,
            vec![id(artifact_id)],
        );
        insert_operation_receipt(&transaction, &receipt, requested_at_utc_ms)?;
        transaction.commit()?;
        Ok(receipt)
    }

    pub fn reserve_deletion(
        &self,
        operation_id: MeetingOperationId,
        requested_at_utc_ms: i64,
        session_id: MeetingSessionId,
        expected_revision: u64,
        cause: DeletionCause,
    ) -> Result<(OperationReceipt, MeetingDeletionJobId), StoreError> {
        if let Some(receipt) = self.operation_receipt(operation_id)? {
            let job_id = receipt
                .effect_ids
                .first()
                .and_then(|value| parse_uuid(value).ok())
                .map(MeetingDeletionJobId::from_uuid)
                .ok_or(StoreError::Corrupt)?;
            return Ok((receipt, job_id));
        }
        let mutation = StoreMutation {
            operation_id,
            requested_at_utc_ms,
            session_id,
            expected_revision,
            command: MeetingCommandKind::Delete,
        };
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let current = session_row(&transaction, session_id)?;
        if current.phase == MeetingPhase::Deleting {
            return Err(StoreError::Conflict);
        }
        if expected_revision != current.revision {
            let receipt = rejected_receipt(
                mutation,
                current.phase,
                current.revision,
                MeetingReasonCode::StaleRevision,
            );
            insert_operation_receipt(&transaction, &receipt, utc_now_ms())?;
            transaction.commit()?;
            return Ok((receipt, MeetingDeletionJobId::new()));
        }
        let next_revision = current.revision.checked_add(1).ok_or(StoreError::Corrupt)?;
        let job_id = MeetingDeletionJobId::new();
        let now = utc_now_ms();
        let live_relative_path = session_id.uuid().to_string();
        let trash_relative_path = format!(".trash/{}", job_id.uuid());
        transaction.execute(
            "UPDATE meeting_sessions SET phase = 'deleting', revision = ?1 WHERE id = ?2",
            params![to_i64(next_revision)?, id(session_id)],
        )?;
        transaction.execute(
            "INSERT INTO meeting_deletion_jobs (
                job_id, session_id, cause, live_relative_path, trash_relative_path, state,
                created_at_utc_ms, updated_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'reserved', ?6, ?6)",
            params![
                id(job_id),
                id(session_id),
                encode_json(&cause)?,
                live_relative_path,
                trash_relative_path,
                now,
            ],
        )?;
        append_event(
            &transaction,
            session_id,
            next_revision,
            current.phase,
            MeetingPhase::Deleting,
            "deletion_reserved",
            None,
        )?;
        let receipt = committed_receipt(
            mutation,
            current.phase,
            MeetingPhase::Deleting,
            now,
            next_revision,
            vec![id(job_id)],
        );
        insert_operation_receipt(&transaction, &receipt, now)?;
        transaction.commit()?;
        Ok((receipt, job_id))
    }

    pub fn finish_deletion(&self, job_id: MeetingDeletionJobId) -> Result<(), StoreError> {
        let job = match self.deletion_job(job_id) {
            Ok(job) => job,
            Err(StoreError::NotFound) => {
                let connection = self.connection()?;
                let completed = connection
                    .query_row(
                        "SELECT 1 FROM meeting_deletion_receipts WHERE job_id = ?1",
                        params![id(job_id)],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()?
                    .is_some();
                if completed {
                    return Ok(());
                }
                return Err(StoreError::NotFound);
            }
            Err(error) => return Err(error),
        };
        let live = validated_relative(&self.root, &job.live_relative_path)?;
        let trash = validated_relative(&self.root, &job.trash_relative_path)?;
        if live.exists() {
            if let Some(parent) = trash.parent() {
                ensure_private_directory(parent)?;
            }
            fs::rename(&live, &trash)?;
            self.update_deletion_job_state(job_id, "trashed")?;
        }
        {
            let mut connection = self.connection()?;
            let transaction = connection.transaction()?;
            transaction.execute(
                "DELETE FROM meeting_sessions WHERE id = ?1",
                params![job.session_id],
            )?;
            transaction.execute(
                "UPDATE meeting_deletion_jobs SET state = 'rows_deleted', updated_at_utc_ms = ?1 WHERE job_id = ?2",
                params![utc_now_ms(), id(job_id)],
            )?;
            transaction.commit()?;
        }
        if trash.exists() {
            fs::remove_dir_all(&trash)?;
        }
        let connection = self.connection()?;
        connection.execute(
            "INSERT OR REPLACE INTO meeting_deletion_receipts (job_id, cause, completed_at_utc_ms)
             VALUES (?1, ?2, ?3)",
            params![id(job_id), job.cause_json, utc_now_ms()],
        )?;
        connection.execute(
            "DELETE FROM meeting_deletion_jobs WHERE job_id = ?1",
            params![id(job_id)],
        )?;
        Ok(())
    }

    pub fn resume_deletions(&self) -> Result<(), StoreError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT job_id FROM meeting_deletion_jobs ORDER BY created_at_utc_ms")?;
        let job_ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        drop(connection);
        for job_id in job_ids {
            self.finish_deletion(MeetingDeletionJobId::from_uuid(parse_uuid(&job_id)?))?;
        }
        Ok(())
    }

    pub fn recover_interrupted(&self) -> Result<Vec<MeetingSessionId>, StoreError> {
        self.resume_deletions()?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id FROM meeting_sessions WHERE phase IN (
                'starting', 'capturing_recording', 'capturing_pausing', 'capturing_paused',
                'capturing_resuming', 'stopping', 'processing'
             )",
        )?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        drop(connection);
        let mut recovered = Vec::new();
        for value in ids {
            let session_id = MeetingSessionId::from_uuid(parse_uuid(&value)?);
            self.repair_session_tracks(session_id)?;
            let mut connection = self.connection()?;
            let transaction = connection.transaction()?;
            let current = session_row(&transaction, session_id)?;
            let next_revision = current.revision.checked_add(1).ok_or(StoreError::Corrupt)?;
            transaction.execute(
                "UPDATE meeting_sessions
                 SET phase = 'recovery_required', revision = ?1, recovered_at_utc_ms = ?2
                 WHERE id = ?3",
                params![to_i64(next_revision)?, utc_now_ms(), id(session_id)],
            )?;
            append_event(
                &transaction,
                session_id,
                next_revision,
                current.phase,
                MeetingPhase::RecoveryRequired,
                "recovery_required",
                None,
            )?;
            transaction.commit()?;
            recovered.push(session_id);
        }
        Ok(recovered)
    }

    fn edit_session<F>(
        &self,
        mutation: StoreMutation,
        event_kind: &str,
        edit: F,
    ) -> Result<OperationReceipt, StoreError>
    where
        F: FnOnce(&Transaction<'_>) -> Result<(), StoreError>,
    {
        if let Some(receipt) = self.operation_receipt(mutation.operation_id)? {
            return Ok(receipt);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let current = session_row(&transaction, mutation.session_id)?;
        if let Some(receipt) = validate_mutation(
            &transaction,
            mutation,
            &current,
            &[
                MeetingPhase::CapturingRecording,
                MeetingPhase::CapturingPaused,
                MeetingPhase::Processing,
                MeetingPhase::ReviewReady,
                MeetingPhase::RecoveryRequired,
            ],
        )? {
            transaction.commit()?;
            return Ok(receipt);
        }
        edit(&transaction)?;
        let next_revision = current.revision.checked_add(1).ok_or(StoreError::Corrupt)?;
        let now = utc_now_ms();
        transaction.execute(
            "UPDATE meeting_sessions SET revision = ?1 WHERE id = ?2",
            params![to_i64(next_revision)?, id(mutation.session_id)],
        )?;
        append_event(
            &transaction,
            mutation.session_id,
            next_revision,
            current.phase,
            current.phase,
            event_kind,
            None,
        )?;
        let receipt = committed_receipt(
            mutation,
            current.phase,
            current.phase,
            now,
            next_revision,
            Vec::new(),
        );
        insert_operation_receipt(&transaction, &receipt, now)?;
        transaction.commit()?;
        Ok(receipt)
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, StoreError> {
        self.connection.lock().map_err(|_| StoreError::Unavailable)
    }

    fn ensure_session_directory(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<PathBuf, StoreError> {
        let path = validated_relative(&self.root, &session_id.uuid().to_string())?;
        ensure_private_directory(&path)?;
        Ok(path)
    }

    /// Streams independently authenticated durable records in sequence order.
    /// The metadata lookup releases the database mutex before decryption and
    /// callback work, so callers can checkpoint transcript batches without
    /// retaining a meeting-sized PCM buffer.
    pub(crate) fn visit_durable_track_records<F>(
        &self,
        session_id: MeetingSessionId,
        track_id: SourceTrackId,
        mut visitor: F,
    ) -> Result<(), StoreError>
    where
        F: FnMut(DurableTrackRecord) -> Result<(), StoreError>,
    {
        {
            let connection = self.connection()?;
            let owner: String = connection.query_row(
                "SELECT session_id FROM meeting_source_tracks WHERE track_id = ?1",
                params![id(track_id)],
                |row| row.get(0),
            )?;
            if parse_uuid(&owner)? != session_id.uuid() {
                return Err(StoreError::Invalid);
            }
        }
        let files = self.track_files(session_id, track_id);
        let key = self.track_key(session_id, track_id)?;
        let mut file = File::open(&files.records)?;
        let mut after_sequence = None;

        loop {
            let descriptor = {
                let connection = self.connection()?;
                connection
                    .query_row(
                        "SELECT source_sequence, source_epoch, start_offset_ns, duration_ns,
                                frame_count, record_offset_bytes, record_bytes
                         FROM meeting_track_records
                         WHERE track_id = ?1 AND source_sequence > ?2
                         ORDER BY source_sequence LIMIT 1",
                        params![
                            id(track_id),
                            after_sequence.map(to_i64).transpose()?.unwrap_or(-1_i64),
                        ],
                        |row| {
                            Ok(DurableRecordDescriptor {
                                sequence: from_i64(row.get(0)?).map_err(to_sql_error)?,
                                epoch: from_i64(row.get(1)?).map_err(to_sql_error)?,
                                start_offset_ns: row
                                    .get::<_, Option<i64>>(2)?
                                    .map(from_i64)
                                    .transpose()
                                    .map_err(to_sql_error)?
                                    .ok_or_else(|| to_sql_error(StoreError::Corrupt))?,
                                duration_ns: from_i64(row.get(3)?).map_err(to_sql_error)?,
                                frame_count: u32::try_from(row.get::<_, i64>(4)?)
                                    .map_err(|_| to_sql_error(StoreError::Corrupt))?,
                                record_offset: from_i64(row.get(5)?).map_err(to_sql_error)?,
                                record_bytes: from_i64(row.get(6)?).map_err(to_sql_error)?,
                            })
                        },
                    )
                    .optional()?
            };
            let Some(descriptor) = descriptor else {
                break;
            };
            let record = decrypt_durable_record(&mut file, &key, track_id, descriptor)?;
            after_sequence = Some(record.sequence);
            visitor(record)?;
        }
        Ok(())
    }

    fn track_files(&self, session_id: MeetingSessionId, track_id: SourceTrackId) -> TrackFiles {
        let session = self.root.join(session_id.uuid().to_string());
        let tracks = session.join("tracks");
        let stem = track_id.uuid().to_string();
        TrackFiles {
            records: tracks.join(format!("{stem}.records")),
            index: tracks.join(format!("{stem}.index")),
        }
    }

    fn track_key(
        &self,
        session_id: MeetingSessionId,
        track_id: SourceTrackId,
    ) -> Result<Zeroizing<[u8; 32]>, StoreError> {
        let hkdf = Hkdf::<Sha256>::new(Some(b"sona-meeting-track-v1"), self.master_key.as_bytes());
        let mut info = [0_u8; 32];
        info[..16].copy_from_slice(session_id.uuid().as_bytes());
        info[16..].copy_from_slice(track_id.uuid().as_bytes());
        let mut key = Zeroizing::new([0_u8; 32]);
        hkdf.expand(&info, &mut *key)
            .map_err(|_| StoreError::Corrupt)?;
        Ok(key)
    }

    fn track_row(&self, track_id: SourceTrackId) -> Result<TrackRow, StoreError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT session_id, timestamp_bridge_json
                 FROM meeting_source_tracks WHERE track_id = ?1",
                params![id(track_id)],
                |row| {
                    Ok(TrackRow {
                        session_id: MeetingSessionId::from_uuid(
                            parse_uuid(&row.get::<_, String>(0)?).map_err(to_sql_error)?,
                        ),
                        bridge: decode_json(&row.get::<_, String>(1)?).map_err(to_sql_error)?,
                    })
                },
            )
            .map_err(Into::into)
    }

    fn deletion_job(&self, job_id: MeetingDeletionJobId) -> Result<DeletionJobRow, StoreError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT session_id, cause, live_relative_path, trash_relative_path
                 FROM meeting_deletion_jobs WHERE job_id = ?1",
                params![id(job_id)],
                |row| {
                    Ok(DeletionJobRow {
                        session_id: row.get(0)?,
                        cause_json: row.get(1)?,
                        live_relative_path: row.get(2)?,
                        trash_relative_path: row.get(3)?,
                    })
                },
            )
            .optional()?
            .ok_or(StoreError::NotFound)
    }

    fn update_deletion_job_state(
        &self,
        job_id: MeetingDeletionJobId,
        state: &str,
    ) -> Result<(), StoreError> {
        let connection = self.connection()?;
        connection.execute(
            "UPDATE meeting_deletion_jobs SET state = ?1, updated_at_utc_ms = ?2 WHERE job_id = ?3",
            params![state, utc_now_ms(), id(job_id)],
        )?;
        Ok(())
    }

    fn repair_session_tracks(&self, session_id: MeetingSessionId) -> Result<(), StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT track_id FROM meeting_source_tracks WHERE session_id = ?1 ORDER BY track_id",
        )?;
        let tracks = statement
            .query_map(params![id(session_id)], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        drop(connection);
        for track in tracks {
            let track_id = SourceTrackId::from_uuid(parse_uuid(&track)?);
            let files = self.track_files(session_id, track_id);
            if !files.records.exists() || !files.index.exists() {
                self.record_gap(&SourceGap {
                    track_id,
                    epoch: SourceEpoch::new(0),
                    start_offset_ns: None,
                    end_offset_ns: None,
                    reason: SourceGapReason::MissingRecord,
                    dropped_frames: None,
                })?;
                continue;
            }
            let key = self.track_key(session_id, track_id)?;
            let repaired = repair_track_files(&files, &key, track_id)?;
            self.reconcile_repaired_records(track_id, &repaired)?;
            if repaired.truncated {
                self.record_gap(&SourceGap {
                    track_id,
                    epoch: SourceEpoch::new(repaired.last_epoch.unwrap_or(0)),
                    start_offset_ns: repaired.last_end_offset_ns,
                    end_offset_ns: None,
                    reason: SourceGapReason::RecoveryTail,
                    dropped_frames: None,
                })?;
            }
        }
        Ok(())
    }

    fn reconcile_repaired_records(
        &self,
        track_id: SourceTrackId,
        repaired: &RepairResult,
    ) -> Result<(), StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let mut statement = transaction
            .prepare("SELECT source_sequence FROM meeting_track_records WHERE track_id = ?1")?;
        let existing = statement
            .query_map(params![id(track_id)], |row| row.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        for record in &repaired.records {
            if !existing.contains(&to_i64(record.sequence)?) {
                insert_durable_record(&transaction, track_id, record)?;
            }
        }
        transaction.execute(
            "DELETE FROM meeting_track_records WHERE track_id = ?1 AND source_sequence > ?2",
            params![
                id(track_id),
                to_i64(
                    repaired
                        .records
                        .last()
                        .map(|record| record.sequence)
                        .unwrap_or(0)
                )?
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }
}

pub struct MeetingTrackWriter {
    store: Arc<MeetingStore>,
    track_id: SourceTrackId,
    files: TrackFiles,
    records: File,
    index: File,
    key: Zeroizing<[u8; 32]>,
    pending: Vec<PendingRecord>,
    next_sequence: u64,
    durable_end_offset_ns: Option<u64>,
    checkpoint_interval_ns: u64,
}

impl MeetingTrackWriter {
    fn open(
        store: Arc<MeetingStore>,
        track_id: SourceTrackId,
        files: TrackFiles,
        key: Zeroizing<[u8; 32]>,
        plan: MeetingStoragePlan,
    ) -> Result<Self, StoreError> {
        let tracks_directory = files.records.parent().ok_or(StoreError::Invalid)?;
        ensure_private_directory(tracks_directory)?;
        let records = open_private_append_file(&files.records)?;
        let index = open_private_append_file(&files.index)?;
        let next_sequence = store.next_track_sequence(track_id)?;
        Ok(Self {
            store,
            track_id,
            files,
            records,
            index,
            key,
            pending: Vec::new(),
            next_sequence,
            durable_end_offset_ns: None,
            checkpoint_interval_ns: u64::from(plan.checkpoint_interval_ms)
                .saturating_mul(1_000_000),
        })
    }

    pub fn accept(
        &mut self,
        packet: CapturedPacket,
        samples: &[f32],
    ) -> Result<PacketPushResult, StoreError> {
        let bridge = self.store.track_row(self.track_id)?.bridge;
        self.accept_with_bridge(packet, samples, bridge)
    }

    pub fn accept_with_bridge(
        &mut self,
        packet: CapturedPacket,
        samples: &[f32],
        bridge: TimestampBridge,
    ) -> Result<PacketPushResult, StoreError> {
        if packet.track_id != self.track_id
            || packet.sequence != self.next_sequence
            || packet.format().checked_frame_samples(packet.frame_count) != Some(samples.len())
        {
            self.store.record_gap(&SourceGap {
                track_id: self.track_id,
                epoch: packet.source_epoch,
                start_offset_ns: None,
                end_offset_ns: None,
                reason: SourceGapReason::InvalidFormat,
                dropped_frames: Some(u64::from(packet.frame_count)),
            })?;
            return Ok(PacketPushResult::Dropped {
                frames: packet.frame_count,
            });
        }
        let clock = SessionClock::new(SessionClockAnchor {
            host_monotonic_anchor_ns: bridge.host_monotonic_anchor_ns,
            wall_start_utc_ms: 0,
            clock_policy_version: 1,
        });
        let Some(start_offset_ns) = clock.map_packet(bridge, packet) else {
            self.store.record_gap(&SourceGap {
                track_id: self.track_id,
                epoch: packet.source_epoch,
                start_offset_ns: None,
                end_offset_ns: None,
                reason: SourceGapReason::TimestampMissing,
                dropped_frames: Some(u64::from(packet.frame_count)),
            })?;
            return Ok(PacketPushResult::Dropped {
                frames: packet.frame_count,
            });
        };
        if packet.discontinuity_flags.timestamp_reset
            || packet.discontinuity_flags.source_restarted
            || packet.discontinuity_flags.route_changed
        {
            self.store.record_gap(&SourceGap {
                track_id: self.track_id,
                epoch: packet.source_epoch,
                start_offset_ns: Some(start_offset_ns),
                end_offset_ns: Some(start_offset_ns),
                reason: SourceGapReason::TimestampDiscontinuity,
                dropped_frames: None,
            })?;
        }
        let duration_ns = u64::from(packet.frame_count)
            .checked_mul(1_000_000_000)
            .and_then(|frames| frames.checked_div(u64::from(packet.sample_rate_hz)))
            .ok_or(StoreError::Invalid)?;
        let payload = f32_payload(samples);
        let record_offset = self.records.seek(SeekFrom::End(0))?;
        let pending = write_encrypted_record(
            &mut self.records,
            &mut self.index,
            &self.key,
            self.track_id,
            packet.sequence,
            packet.source_epoch,
            start_offset_ns,
            duration_ns,
            packet.frame_count,
            packet.format(),
            packet.discontinuity_flags,
            &payload,
            record_offset,
        )?;
        self.next_sequence = packet.sequence.checked_add(1).ok_or(StoreError::Corrupt)?;
        self.pending.push(pending);
        let should_checkpoint = self
            .pending
            .last()
            .and_then(|record| record.end_offset_ns)
            .zip(self.durable_end_offset_ns)
            .map(|(end, durable)| end.saturating_sub(durable) >= self.checkpoint_interval_ns)
            .unwrap_or(false);
        if should_checkpoint {
            self.checkpoint()?;
        }
        Ok(PacketPushResult::Accepted)
    }

    pub fn checkpoint(&mut self) -> Result<(), StoreError> {
        if self.pending.is_empty() {
            return Ok(());
        }
        self.records.sync_data()?;
        self.index.sync_data()?;
        self.store
            .commit_durable_records(self.track_id, &self.pending)?;
        self.durable_end_offset_ns = self.pending.last().and_then(|record| record.end_offset_ns);
        self.pending.clear();
        Ok(())
    }

    pub fn seal(mut self) -> Result<(), StoreError> {
        self.checkpoint()?;
        self.records.sync_all()?;
        self.index.sync_all()?;
        sync_parent_directory(&self.files.records)?;
        Ok(())
    }

    pub fn abandon(mut self, reason: SourceGapReason) -> Result<(), StoreError> {
        self.checkpoint()?;
        self.store.record_gap(&SourceGap {
            track_id: self.track_id,
            epoch: SourceEpoch::new(0),
            start_offset_ns: self.durable_end_offset_ns,
            end_offset_ns: None,
            reason,
            dropped_frames: None,
        })
    }
}

impl MeetingStore {
    fn next_track_sequence(&self, track_id: SourceTrackId) -> Result<u64, StoreError> {
        let connection = self.connection()?;
        let sequence: i64 = connection.query_row(
            "SELECT COALESCE(MAX(source_sequence), -1) + 1 FROM meeting_track_records WHERE track_id = ?1",
            params![id(track_id)],
            |row| row.get(0),
        )?;
        u64::try_from(sequence).map_err(|_| StoreError::Corrupt)
    }

    fn commit_durable_records(
        &self,
        track_id: SourceTrackId,
        pending: &[PendingRecord],
    ) -> Result<(), StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        for record in pending {
            insert_durable_record(&transaction, track_id, record)?;
        }
        let last = pending.last().ok_or(StoreError::Invalid)?;
        transaction.execute(
            "INSERT INTO meeting_track_checkpoints (
                track_id, next_sequence, durable_offset_ns, durable_bytes, updated_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(track_id) DO UPDATE SET
                next_sequence = excluded.next_sequence,
                durable_offset_ns = excluded.durable_offset_ns,
                durable_bytes = excluded.durable_bytes,
                updated_at_utc_ms = excluded.updated_at_utc_ms",
            params![
                id(track_id),
                to_i64(last.sequence.checked_add(1).ok_or(StoreError::Corrupt)?)?,
                optional_i64(last.end_offset_ns)?,
                to_i64(
                    last.record_offset
                        .checked_add(last.record_bytes)
                        .ok_or(StoreError::Corrupt)?
                )?,
                utc_now_ms(),
            ],
        )?;
        transaction.execute(
            "UPDATE meeting_source_tracks
             SET first_offset_ns = COALESCE(first_offset_ns, ?1), last_offset_ns = ?2
             WHERE track_id = ?3",
            params![
                optional_i64(last.start_offset_ns)?,
                optional_i64(last.end_offset_ns)?,
                id(track_id),
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }
}

struct SessionRow {
    phase: MeetingPhase,
    revision: u64,
    title: String,
    preflight_json: String,
    processing_status_json: String,
    retention_policy_json: String,
    started_at_utc_ms: Option<i64>,
    delete_after_utc_ms: Option<i64>,
}

struct TrackRow {
    session_id: MeetingSessionId,
    bridge: TimestampBridge,
}

struct DeletionJobRow {
    session_id: String,
    cause_json: String,
    live_relative_path: String,
    trash_relative_path: String,
}

#[derive(Clone)]
struct TrackFiles {
    records: PathBuf,
    index: PathBuf,
}

#[derive(Clone)]
struct PendingRecord {
    sequence: u64,
    epoch: u64,
    start_offset_ns: Option<u64>,
    end_offset_ns: Option<u64>,
    duration_ns: u64,
    frame_count: u32,
    record_offset: u64,
    record_bytes: u64,
}

#[derive(Clone, Copy)]
struct DurableRecordDescriptor {
    sequence: u64,
    epoch: u64,
    start_offset_ns: u64,
    duration_ns: u64,
    frame_count: u32,
    record_offset: u64,
    record_bytes: u64,
}

struct RepairResult {
    records: Vec<PendingRecord>,
    truncated: bool,
    last_epoch: Option<u64>,
    last_end_offset_ns: Option<u64>,
}

fn open_encrypted_connection(
    path: &Path,
    key: &MeetingStorageKey,
) -> Result<Connection, StoreError> {
    let connection = Connection::open(path)?;
    let key_hex = Zeroizing::new(hex::encode(key.as_bytes()));
    let pragma = Zeroizing::new(format!("PRAGMA key = \"x'{}'\";", key_hex.as_str()));
    connection.execute_batch(pragma.as_str())?;
    let cipher_version: String =
        connection.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
    if cipher_version.trim().is_empty() {
        return Err(StoreError::EncryptionUnavailable);
    }
    configure_connection(&connection)?;
    Ok(connection)
}

fn configure_connection(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA secure_delete = ON;
        PRAGMA cipher_memory_security = ON;
        ",
    )?;
    Ok(())
}

fn session_row(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<SessionRow, StoreError> {
    connection
        .query_row(
            "SELECT phase, revision, title, preflight_json, processing_status,
                    retention_policy_json, started_at_utc_ms, delete_after_utc_ms
             FROM meeting_sessions WHERE id = ?1",
            params![id(session_id)],
            |row| {
                let revision: i64 = row.get(1)?;
                Ok(SessionRow {
                    phase: phase_from_db(&row.get::<_, String>(0)?).map_err(to_sql_error)?,
                    revision: u64::try_from(revision)
                        .map_err(|_| to_sql_error(StoreError::Corrupt))?,
                    title: row.get(2)?,
                    preflight_json: row.get(3)?,
                    processing_status_json: row.get(4)?,
                    retention_policy_json: row.get(5)?,
                    started_at_utc_ms: row.get(6)?,
                    delete_after_utc_ms: row.get(7)?,
                })
            },
        )
        .optional()?
        .ok_or(StoreError::NotFound)
}

fn operation_receipt_in(
    transaction: &Transaction<'_>,
    operation_id: MeetingOperationId,
) -> Result<Option<OperationReceipt>, StoreError> {
    let json = transaction
        .query_row(
            "SELECT receipt_json FROM meeting_operation_receipts WHERE operation_id = ?1",
            params![id(operation_id)],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    json.map(|value| decode_json(&value)).transpose()
}

fn validate_mutation(
    transaction: &Transaction<'_>,
    mutation: StoreMutation,
    current: &SessionRow,
    allowed_from: &[MeetingPhase],
) -> Result<Option<OperationReceipt>, StoreError> {
    if let Some(receipt) = operation_receipt_in(transaction, mutation.operation_id)? {
        return Ok(Some(receipt));
    }
    let reason = if mutation.expected_revision != current.revision {
        Some(MeetingReasonCode::StaleRevision)
    } else if !allowed_from.contains(&current.phase) {
        Some(MeetingReasonCode::InvalidTransition)
    } else {
        None
    };
    let Some(reason) = reason else {
        return Ok(None);
    };
    let receipt = rejected_receipt(mutation, current.phase, current.revision, reason);
    insert_operation_receipt(transaction, &receipt, utc_now_ms())?;
    Ok(Some(receipt))
}

fn committed_receipt(
    mutation: StoreMutation,
    from_phase: MeetingPhase,
    to_phase: MeetingPhase,
    committed_at_utc_ms: i64,
    new_revision: u64,
    effect_ids: Vec<String>,
) -> OperationReceipt {
    OperationReceipt {
        schema_version: STORE_SCHEMA_VERSION,
        operation_id: mutation.operation_id,
        session_id: Some(mutation.session_id),
        actor: OperationActor::User,
        command: mutation.command,
        expected_revision: mutation.expected_revision,
        from_phase: Some(from_phase),
        to_phase: Some(to_phase),
        requested_at_utc_ms: mutation.requested_at_utc_ms,
        committed_at_utc_ms: Some(committed_at_utc_ms),
        result: OperationResult::Committed,
        reason_codes: Vec::new(),
        new_revision: Some(new_revision),
        effect_ids,
    }
}
fn committed_global_receipt(
    operation_id: MeetingOperationId,
    command: MeetingCommandKind,
    expected_revision: u64,
    requested_at_utc_ms: i64,
    committed_at_utc_ms: i64,
    new_revision: u64,
) -> OperationReceipt {
    OperationReceipt {
        schema_version: STORE_SCHEMA_VERSION,
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
        effect_ids: Vec::new(),
    }
}

fn rejected_global_receipt(
    operation_id: MeetingOperationId,
    command: MeetingCommandKind,
    expected_revision: u64,
    current_revision: u64,
    requested_at_utc_ms: i64,
    reason: MeetingReasonCode,
) -> OperationReceipt {
    OperationReceipt {
        schema_version: STORE_SCHEMA_VERSION,
        operation_id,
        session_id: None,
        actor: OperationActor::User,
        command,
        expected_revision,
        from_phase: None,
        to_phase: None,
        requested_at_utc_ms,
        committed_at_utc_ms: Some(utc_now_ms()),
        result: OperationResult::Rejected,
        reason_codes: vec![reason],
        new_revision: Some(current_revision),
        effect_ids: Vec::new(),
    }
}
fn export_result_for_receipt(
    connection: &Connection,
    receipt: OperationReceipt,
) -> Result<MeetingExportResult, StoreError> {
    if receipt.command != MeetingCommandKind::Export || receipt.result != OperationResult::Committed
    {
        return Err(StoreError::Invalid);
    }
    let [effect_id] = receipt.effect_ids.as_slice() else {
        return Err(StoreError::Corrupt);
    };
    let export_receipt_id = MeetingExportReceiptId::from_uuid(parse_uuid(effect_id)?);
    let (
        session_id,
        format,
        snapshot_revision,
        capture_completeness,
        transcript_revision_id,
        created_at_utc_ms,
    ): (String, String, i64, String, Option<String>, i64) = connection
        .query_row(
            "SELECT session_id, format, snapshot_revision, capture_completeness,
                    transcript_revision_id, created_at_utc_ms
             FROM meeting_export_receipts WHERE export_receipt_id = ?1",
            params![id(export_receipt_id)],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()?
        .ok_or(StoreError::Corrupt)?;
    Ok(MeetingExportResult {
        receipt,
        export_receipt: MeetingExportReceipt {
            export_receipt_id,
            session_id: MeetingSessionId::from_uuid(parse_uuid(&session_id)?),
            format: decode_json(&format)?,
            snapshot_revision: from_i64(snapshot_revision)?,
            capture_completeness: decode_json(&capture_completeness)?,
            transcript_revision_id: transcript_revision_id
                .map(|value| parse_uuid(&value).map(TranscriptRevisionId::from_uuid))
                .transpose()?,
            created_at_utc_ms,
        },
    })
}

fn rejected_receipt(
    mutation: StoreMutation,
    phase: MeetingPhase,
    current_revision: u64,
    reason: MeetingReasonCode,
) -> OperationReceipt {
    OperationReceipt {
        schema_version: STORE_SCHEMA_VERSION,
        operation_id: mutation.operation_id,
        session_id: Some(mutation.session_id),
        actor: OperationActor::User,
        command: mutation.command,
        expected_revision: mutation.expected_revision,
        from_phase: Some(phase),
        to_phase: Some(phase),
        requested_at_utc_ms: mutation.requested_at_utc_ms,
        committed_at_utc_ms: Some(utc_now_ms()),
        result: OperationResult::Rejected,
        reason_codes: vec![reason],
        new_revision: Some(current_revision),
        effect_ids: Vec::new(),
    }
}

fn insert_operation_receipt(
    transaction: &Transaction<'_>,
    receipt: &OperationReceipt,
    created_at_utc_ms: i64,
) -> Result<(), StoreError> {
    transaction.execute(
        "INSERT INTO meeting_operation_receipts (operation_id, session_id, receipt_json, created_at_utc_ms)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            id(receipt.operation_id),
            receipt.session_id.map(id),
            encode_json(receipt)?,
            created_at_utc_ms,
        ],
    )?;
    Ok(())
}

fn append_event(
    transaction: &Transaction<'_>,
    session_id: MeetingSessionId,
    sequence: u64,
    prior_phase: MeetingPhase,
    next_phase: MeetingPhase,
    event_kind: &str,
    session_offset_ns: Option<u64>,
) -> Result<(), StoreError> {
    transaction.execute(
        "INSERT INTO meeting_session_events (
            session_id, sequence, prior_phase, next_phase, event_kind, observed_at_utc_ms,
            session_offset_ns, details_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '{}')",
        params![
            id(session_id),
            to_i64(sequence)?,
            phase_db(prior_phase),
            phase_db(next_phase),
            event_kind,
            utc_now_ms(),
            optional_i64(session_offset_ns)?,
        ],
    )?;
    Ok(())
}

fn source_snapshots(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<Vec<MeetingSourceSnapshot>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT track_id, source_kind, required, format_json, health, last_offset_ns,
                (SELECT COUNT(*) FROM meeting_source_gaps g WHERE g.track_id = t.track_id)
         FROM meeting_source_tracks t WHERE session_id = ?1 ORDER BY source_kind",
    )?;
    let rows = statement.query_map(params![id(session_id)], |row| {
        let required: i64 = row.get(2)?;
        let format: Option<String> = row.get(3)?;
        let last_offset: Option<i64> = row.get(5)?;
        let gap_count: i64 = row.get(6)?;
        Ok(MeetingSourceSnapshot {
            track_id: Some(SourceTrackId::from_uuid(
                parse_uuid(&row.get::<_, String>(0)?).map_err(to_sql_error)?,
            )),
            source_kind: source_kind_from_db(&row.get::<_, String>(1)?).map_err(to_sql_error)?,
            required: required != 0,
            availability: SourceAvailability::Available,
            health: decode_json(&row.get::<_, String>(4)?).map_err(to_sql_error)?,
            format: format
                .map(|value| decode_json(&value))
                .transpose()
                .map_err(to_sql_error)?,
            last_durable_offset_ns: last_offset
                .map(from_i64)
                .transpose()
                .map_err(to_sql_error)?,
            gap_count: u64::try_from(gap_count).map_err(|_| to_sql_error(StoreError::Corrupt))?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn derive_completeness(
    connection: &Connection,
    session_id: MeetingSessionId,
    sources: &[MeetingSourceSnapshot],
) -> Result<CaptureCompleteness, StoreError> {
    let window_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM meeting_capture_windows WHERE session_id = ?1",
        params![id(session_id)],
        |row| row.get(0),
    )?;
    if window_count == 0 {
        return Ok(CaptureCompleteness::NotStarted);
    }
    if sources.len() < SourceKind::ALL.len()
        || sources.iter().any(|source| {
            source.health != SourceHealth::Healthy
                || source.gap_count > 0
                || source.last_durable_offset_ns.is_none()
        })
    {
        return Ok(CaptureCompleteness::Partial);
    }
    let open_windows: i64 = connection.query_row(
        "SELECT COUNT(*) FROM meeting_capture_windows WHERE session_id = ?1 AND end_offset_ns IS NULL",
        params![id(session_id)],
        |row| row.get(0),
    )?;
    if open_windows > 0 {
        return Ok(CaptureCompleteness::Partial);
    }
    Ok(CaptureCompleteness::Complete)
}

fn allowed_actions(phase: MeetingPhase) -> Vec<AllowedMeetingAction> {
    match phase {
        MeetingPhase::Preflight => vec![
            AllowedMeetingAction::RefreshPreflight,
            AllowedMeetingAction::CancelPreflight,
            AllowedMeetingAction::Start,
        ],
        MeetingPhase::Starting
        | MeetingPhase::CapturingRecording
        | MeetingPhase::CapturingPausing
        | MeetingPhase::CapturingResuming => vec![
            AllowedMeetingAction::Pause,
            AllowedMeetingAction::Stop,
            AllowedMeetingAction::Discard,
        ],
        MeetingPhase::CapturingPaused => vec![
            AllowedMeetingAction::Resume,
            AllowedMeetingAction::Stop,
            AllowedMeetingAction::Discard,
            AllowedMeetingAction::Edit,
        ],
        MeetingPhase::Stopping | MeetingPhase::Processing => vec![AllowedMeetingAction::Discard],
        MeetingPhase::ReviewReady => vec![
            AllowedMeetingAction::Edit,
            AllowedMeetingAction::Regenerate,
            AllowedMeetingAction::AskQuestion,
            AllowedMeetingAction::Export,
            AllowedMeetingAction::Delete,
        ],
        MeetingPhase::RecoveryRequired => vec![
            AllowedMeetingAction::FinalizePartial,
            AllowedMeetingAction::Discard,
            AllowedMeetingAction::Delete,
        ],
        MeetingPhase::Deleting => Vec::new(),
    }
}

fn track_snapshots(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<Vec<MeetingTrackSnapshot>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT t.track_id, t.source_kind, t.format_json, t.first_offset_ns, t.last_offset_ns,
                (SELECT COUNT(*) FROM meeting_track_records r WHERE r.track_id = t.track_id)
         FROM meeting_source_tracks t WHERE t.session_id = ?1 ORDER BY t.source_kind",
    )?;
    let rows = statement.query_map(params![id(session_id)], |row| {
        let format: Option<String> = row.get(2)?;
        let first: Option<i64> = row.get(3)?;
        let last: Option<i64> = row.get(4)?;
        let count: i64 = row.get(5)?;
        Ok(MeetingTrackSnapshot {
            track_id: SourceTrackId::from_uuid(
                parse_uuid(&row.get::<_, String>(0)?).map_err(to_sql_error)?,
            ),
            source_kind: source_kind_from_db(&row.get::<_, String>(1)?).map_err(to_sql_error)?,
            format: format
                .map(|value| decode_json(&value))
                .transpose()
                .map_err(to_sql_error)?,
            first_offset_ns: first.map(from_i64).transpose().map_err(to_sql_error)?,
            last_offset_ns: last.map(from_i64).transpose().map_err(to_sql_error)?,
            durable_record_count: u64::try_from(count)
                .map_err(|_| to_sql_error(StoreError::Corrupt))?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn gaps_for_session(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<Vec<SourceGap>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT g.track_id, g.source_epoch, g.start_offset_ns, g.end_offset_ns, g.reason, g.dropped_frames
         FROM meeting_source_gaps g JOIN meeting_source_tracks t ON t.track_id = g.track_id
         WHERE t.session_id = ?1 ORDER BY g.gap_id",
    )?;
    let rows = statement.query_map(params![id(session_id)], |row| {
        let epoch: i64 = row.get(1)?;
        let start: Option<i64> = row.get(2)?;
        let end: Option<i64> = row.get(3)?;
        let dropped: Option<i64> = row.get(5)?;
        Ok(SourceGap {
            track_id: SourceTrackId::from_uuid(
                parse_uuid(&row.get::<_, String>(0)?).map_err(to_sql_error)?,
            ),
            epoch: SourceEpoch::new(
                u64::try_from(epoch).map_err(|_| to_sql_error(StoreError::Corrupt))?,
            ),
            start_offset_ns: start.map(from_i64).transpose().map_err(to_sql_error)?,
            end_offset_ns: end.map(from_i64).transpose().map_err(to_sql_error)?,
            reason: decode_json(&row.get::<_, String>(4)?).map_err(to_sql_error)?,
            dropped_frames: dropped.map(from_i64).transpose().map_err(to_sql_error)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn speakers_for_session(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<Vec<MeetingSpeaker>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT speaker_id, source_kind, display_name, revision FROM meeting_speakers WHERE session_id = ?1 ORDER BY display_name",
    )?;
    let rows = statement.query_map(params![id(session_id)], |row| {
        let revision: i64 = row.get(3)?;
        Ok(MeetingSpeaker {
            speaker_id: SpeakerId::from_uuid(
                parse_uuid(&row.get::<_, String>(0)?).map_err(to_sql_error)?,
            ),
            session_id,
            source_kind: source_kind_from_db(&row.get::<_, String>(1)?).map_err(to_sql_error)?,
            display_name: row.get(2)?,
            revision: u64::try_from(revision).map_err(|_| to_sql_error(StoreError::Corrupt))?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn effective_segments_for_session(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<Vec<EffectiveTranscriptSegment>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT s.segment_id, s.transcript_revision_id, s.track_id, s.ordinal, s.start_offset_ns,
                s.end_offset_ns, s.speaker_id, s.base_text, s.confidence_milli,
                e.replacement_text, e.removed, e.edit_sequence,
                COALESCE(a.speaker_id, s.speaker_id),
                COALESCE(a.assignment_kind,
                    CASE t.source_kind WHEN 'microphone' THEN 'local_speaker' ELSE 'unknown' END)
         FROM meeting_sessions m
         JOIN meeting_transcript_segments s
           ON s.transcript_revision_id = m.current_transcript_revision_id
         JOIN meeting_source_tracks t ON t.track_id = s.track_id
         LEFT JOIN meeting_diarization_assignments a
           ON a.generation_id = m.current_diarization_generation_id AND a.segment_id = s.segment_id
         LEFT JOIN meeting_segment_edits e ON e.segment_id = s.segment_id
             AND e.edit_sequence = (SELECT MAX(edit_sequence) FROM meeting_segment_edits WHERE segment_id = s.segment_id)
         WHERE m.id = ?1 ORDER BY s.start_offset_ns, s.ordinal",
    )?;
    let rows = statement.query_map(params![id(session_id)], |row| {
        let ordinal: i64 = row.get(3)?;
        let start: i64 = row.get(4)?;
        let end: i64 = row.get(5)?;
        let confidence: Option<i64> = row.get(8)?;
        let edit_sequence: Option<i64> = row.get(11)?;
        Ok(EffectiveTranscriptSegment {
            base: TranscriptSegment {
                segment_id: TranscriptSegmentId::from_uuid(
                    parse_uuid(&row.get::<_, String>(0)?).map_err(to_sql_error)?,
                ),
                transcript_revision_id: TranscriptRevisionId::from_uuid(
                    parse_uuid(&row.get::<_, String>(1)?).map_err(to_sql_error)?,
                ),
                track_id: SourceTrackId::from_uuid(
                    parse_uuid(&row.get::<_, String>(2)?).map_err(to_sql_error)?,
                ),
                ordinal: u64::try_from(ordinal).map_err(|_| to_sql_error(StoreError::Corrupt))?,
                start_offset_ns: from_i64(start).map_err(to_sql_error)?,
                end_offset_ns: from_i64(end).map_err(to_sql_error)?,
                speaker_id: SpeakerId::from_uuid(
                    parse_uuid(&row.get::<_, String>(6)?).map_err(to_sql_error)?,
                ),
                text: row.get(7)?,
                confidence_milli: confidence
                    .map(|value| {
                        u16::try_from(value).map_err(|_| to_sql_error(StoreError::Corrupt))
                    })
                    .transpose()?,
            },
            replacement_text: row.get(9)?,
            removed: row.get::<_, Option<i64>>(10)?.unwrap_or(0) != 0,
            edit_revision: edit_sequence
                .map(|value| u64::try_from(value).map_err(|_| to_sql_error(StoreError::Corrupt)))
                .transpose()?,
            assigned_speaker_id: SpeakerId::from_uuid(
                parse_uuid(&row.get::<_, String>(12)?).map_err(to_sql_error)?,
            ),
            speaker_assignment: speaker_assignment_from_db(&row.get::<_, String>(13)?)
                .map_err(to_sql_error)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn notes_for_session(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<Vec<ManualNote>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT note_id, start_offset_ns, end_offset_ns, body, note_revision, created_at_utc_ms, updated_at_utc_ms
         FROM meeting_notes WHERE session_id = ?1 ORDER BY created_at_utc_ms",
    )?;
    let rows = statement.query_map(params![id(session_id)], |row| {
        let start: Option<i64> = row.get(1)?;
        let end: Option<i64> = row.get(2)?;
        let revision: i64 = row.get(4)?;
        Ok(ManualNote {
            note_id: ManualNoteId::from_uuid(
                parse_uuid(&row.get::<_, String>(0)?).map_err(to_sql_error)?,
            ),
            session_id,
            start_offset_ns: start.map(from_i64).transpose().map_err(to_sql_error)?,
            end_offset_ns: end.map(from_i64).transpose().map_err(to_sql_error)?,
            body: row.get(3)?,
            revision: u64::try_from(revision).map_err(|_| to_sql_error(StoreError::Corrupt))?,
            created_at_utc_ms: row.get(5)?,
            updated_at_utc_ms: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn source_speaker_for(
    transaction: &Transaction<'_>,
    session_id: MeetingSessionId,
    source_kind: SourceKind,
) -> Result<SpeakerId, StoreError> {
    let display_name = match source_kind {
        SourceKind::Microphone => "Local speaker",
        SourceKind::SystemAudio => "Unknown speaker",
    };
    named_speaker_for(transaction, session_id, source_kind, display_name)
}

fn named_speaker_for(
    transaction: &Transaction<'_>,
    session_id: MeetingSessionId,
    source_kind: SourceKind,
    display_name: &str,
) -> Result<SpeakerId, StoreError> {
    let existing: Option<String> = transaction
        .query_row(
            "SELECT speaker_id FROM meeting_speakers
             WHERE session_id = ?1 AND source_kind = ?2 AND display_name = ?3
               AND merged_into_speaker_id IS NULL
             ORDER BY speaker_id LIMIT 1",
            params![id(session_id), source_kind.as_str(), display_name],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(existing) = existing {
        return Ok(SpeakerId::from_uuid(parse_uuid(&existing)?));
    }
    let speaker_id = SpeakerId::new();
    transaction.execute(
        "INSERT INTO meeting_speakers (
            speaker_id, session_id, source_kind, display_name, revision, merged_into_speaker_id
         ) VALUES (?1, ?2, ?3, ?4, 0, NULL)",
        params![
            id(speaker_id),
            id(session_id),
            source_kind.as_str(),
            display_name,
        ],
    )?;
    Ok(speaker_id)
}

fn artifact_revision_for_key(
    connection: &Connection,
    session_id: MeetingSessionId,
    generation_key: &str,
) -> Result<Option<MeetingArtifactRevision>, StoreError> {
    connection
        .query_row(
            "SELECT artifact_id, transcript_revision_id, input_revision, template_id,
                    template_version, generation_key, state, content_json, generated_at_utc_ms
             FROM meeting_artifact_revisions
             WHERE session_id = ?1 AND generation_key = ?2",
            params![id(session_id), generation_key],
            |row| artifact_revision_from_row(row, session_id),
        )
        .optional()
        .map_err(Into::into)
}

fn artifact_revisions_for_session(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<Vec<MeetingArtifactRevision>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT artifact_id, transcript_revision_id, input_revision, template_id,
                template_version, generation_key, state, content_json, generated_at_utc_ms
         FROM meeting_artifact_revisions
         WHERE session_id = ?1 ORDER BY generated_at_utc_ms DESC",
    )?;
    let rows = statement.query_map(params![id(session_id)], |row| {
        artifact_revision_from_row(row, session_id)
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn artifact_revision_from_row(
    row: &rusqlite::Row<'_>,
    session_id: MeetingSessionId,
) -> rusqlite::Result<MeetingArtifactRevision> {
    let input_revision: i64 = row.get(2)?;
    let template_version: i64 = row.get(4)?;
    let content_json: Option<String> = row.get(7)?;
    Ok(MeetingArtifactRevision {
        artifact_id: MeetingArtifactId::from_uuid(
            parse_uuid(&row.get::<_, String>(0)?).map_err(to_sql_error)?,
        ),
        session_id,
        transcript_revision_id: TranscriptRevisionId::from_uuid(
            parse_uuid(&row.get::<_, String>(1)?).map_err(to_sql_error)?,
        ),
        input_revision: from_i64(input_revision).map_err(to_sql_error)?,
        template_id: row.get(3)?,
        template_version: u32::try_from(template_version)
            .map_err(|_| to_sql_error(StoreError::Corrupt))?,
        generation_key: row.get(5)?,
        state: artifact_state_from_db(&row.get::<_, String>(6)?).map_err(to_sql_error)?,
        generated_at_utc_ms: row.get(8)?,
        content: content_json
            .as_deref()
            .map(decode_json)
            .transpose()
            .map_err(to_sql_error)?,
    })
}

fn question_history_for_session(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<Vec<MeetingAnswer>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT question_id, question_text, scope_json, answer_state, answer_text,
                input_revision, revision, created_at_utc_ms
         FROM meeting_questions WHERE session_id = ?1 ORDER BY created_at_utc_ms",
    )?;
    let rows = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    rows.into_iter()
        .map(
            |(
                question_id,
                question,
                scope,
                state,
                answer,
                input_revision,
                revision,
                created_at,
            )| {
                let question_id = MeetingQuestionId::from_uuid(parse_uuid(&question_id)?);
                Ok(MeetingAnswer {
                    question_id,
                    session_id,
                    scope: decode_json(&scope)?,
                    question: Some(question),
                    state: meeting_answer_state_from_db(&state)?,
                    answer,
                    citations: question_citations(connection, question_id)?,
                    input_revision: from_i64(input_revision)?,
                    revision: from_i64(revision)?,
                    created_at_utc_ms: created_at,
                })
            },
        )
        .collect()
}

fn question_citations(
    connection: &Connection,
    question_id: MeetingQuestionId,
) -> Result<Vec<MeetingCitation>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT citation_json FROM meeting_question_citations
         WHERE question_id = ?1 ORDER BY ordinal",
    )?;
    let rows = statement.query_map(params![id(question_id)], |row| row.get::<_, String>(0))?;
    rows.map(|row| {
        row.map_err(Into::into)
            .and_then(|citation| decode_json(&citation))
    })
    .collect()
}

fn diarization_snapshot_for_session(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<MeetingDiarizationSnapshot, StoreError> {
    let (status, model_id, model_version, generation_id): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = connection.query_row(
        "SELECT diarization_status, diarization_model_id, diarization_model_version,
                current_diarization_generation_id
         FROM meeting_sessions WHERE id = ?1",
        params![id(session_id)],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let generation_id = generation_id
        .as_deref()
        .map(parse_uuid)
        .transpose()?
        .map(MeetingDiarizationGenerationId::from_uuid);
    let assigned_segment_count = match generation_id {
        Some(generation_id) => connection.query_row(
            "SELECT COUNT(*) FROM meeting_diarization_assignments WHERE generation_id = ?1",
            params![id(generation_id)],
            |row| row.get::<_, i64>(0),
        )?,
        None => 0,
    };
    Ok(MeetingDiarizationSnapshot {
        status: diarization_status_from_db(&status)?,
        model_id: model_id
            .unwrap_or_else(|| crate::meeting::diarization::model_manifest().id.clone()),
        model_version: model_version.unwrap_or_else(|| {
            crate::meeting::diarization::model_manifest()
                .revision
                .clone()
        }),
        generation_id,
        assigned_segment_count: from_i64(assigned_segment_count)?,
    })
}

fn mark_artifacts_out_of_date(
    transaction: &Transaction<'_>,
    session_id: MeetingSessionId,
) -> Result<(), StoreError> {
    transaction.execute(
        "UPDATE meeting_artifacts SET state = 'out_of_date' WHERE session_id = ?1 AND state = 'current'",
        params![id(session_id)],
    )?;
    transaction.execute(
        "UPDATE meeting_artifact_revisions
         SET state = 'out_of_date' WHERE session_id = ?1 AND state = 'current'",
        params![id(session_id)],
    )?;
    transaction.execute(
        "UPDATE meeting_questions
         SET answer_state = 'out_of_date'
         WHERE session_id = ?1 AND answer_state != 'forgotten'",
        params![id(session_id)],
    )?;
    Ok(())
}

fn rebuild_search_documents_in(
    transaction: &Transaction<'_>,
    session_id: MeetingSessionId,
) -> Result<(), StoreError> {
    transaction.execute(
        "DELETE FROM meeting_search_documents WHERE session_id = ?1",
        params![id(session_id)],
    )?;
    let title: String = transaction.query_row(
        "SELECT title FROM meeting_sessions WHERE id = ?1",
        params![id(session_id)],
        |row| row.get(0),
    )?;
    transaction.execute(
        "INSERT INTO meeting_search_documents (session_id, entity_kind, entity_id, content)
         VALUES (?1, 'title', ?1, ?2)",
        params![id(session_id), title],
    )?;
    transaction.execute(
        "INSERT INTO meeting_search_documents (session_id, entity_kind, entity_id, content)
         SELECT n.session_id, 'note', n.note_id, n.body FROM meeting_notes n WHERE n.session_id = ?1",
        params![id(session_id)],
    )?;
    transaction.execute(
        "INSERT INTO meeting_search_documents (session_id, entity_kind, entity_id, content)
         SELECT m.id, 'segment', s.segment_id,
            COALESCE((SELECT e.replacement_text FROM meeting_segment_edits e
                      WHERE e.segment_id = s.segment_id ORDER BY e.edit_sequence DESC LIMIT 1), s.base_text)
         FROM meeting_sessions m
         JOIN meeting_transcript_segments s
           ON s.transcript_revision_id = m.current_transcript_revision_id
         WHERE m.id = ?1
           AND COALESCE((SELECT e.removed FROM meeting_segment_edits e
                         WHERE e.segment_id = s.segment_id ORDER BY e.edit_sequence DESC LIMIT 1), 0) = 0",
        params![id(session_id)],
    )?;
    Ok(())
}

fn insert_durable_record(
    transaction: &Transaction<'_>,
    track_id: SourceTrackId,
    record: &PendingRecord,
) -> Result<(), StoreError> {
    transaction.execute(
        "INSERT OR IGNORE INTO meeting_track_records (
            track_id, source_sequence, source_epoch, start_offset_ns, duration_ns, frame_count,
            record_offset_bytes, record_bytes, durable_at_utc_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id(track_id),
            to_i64(record.sequence)?,
            to_i64(record.epoch)?,
            optional_i64(record.start_offset_ns)?,
            to_i64(record.duration_ns)?,
            i64::from(record.frame_count),
            to_i64(record.record_offset)?,
            to_i64(record.record_bytes)?,
            utc_now_ms(),
        ],
    )?;
    Ok(())
}

fn f32_payload(samples: &[f32]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(samples.len().saturating_mul(std::mem::size_of::<f32>()));
    for sample in samples {
        payload.extend_from_slice(&sample.to_le_bytes());
    }
    payload
}

#[allow(clippy::too_many_arguments)]
fn write_encrypted_record(
    records: &mut File,
    index: &mut File,
    key: &[u8; 32],
    track_id: SourceTrackId,
    sequence: u64,
    epoch: SourceEpoch,
    start_offset_ns: u64,
    duration_ns: u64,
    frame_count: u32,
    format: AudioFormat,
    flags: PacketDiscontinuityFlags,
    payload: &[u8],
    record_offset: u64,
) -> Result<PendingRecord, StoreError> {
    let payload_len = u32::try_from(payload.len()).map_err(|_| StoreError::Invalid)?;
    let mut nonce_bytes = [0_u8; 12];
    getrandom::fill(&mut nonce_bytes).map_err(|_| StoreError::Unavailable)?;
    let checksum = Sha256::digest(payload);
    let mut header = [0_u8; RECORD_HEADER_BYTES];
    header[..4].copy_from_slice(&RECORD_MAGIC);
    header[4] = RECORD_FORMAT_VERSION;
    header[5] = (u8::from(flags.timestamp_reset))
        | (u8::from(flags.route_changed) << 1)
        | (u8::from(flags.source_restarted) << 2);
    header[8..16].copy_from_slice(&sequence.to_le_bytes());
    header[16..24].copy_from_slice(&epoch.get().to_le_bytes());
    header[24..32].copy_from_slice(&start_offset_ns.to_le_bytes());
    header[32..36].copy_from_slice(&frame_count.to_le_bytes());
    header[36..40].copy_from_slice(&format.sample_rate_hz.to_le_bytes());
    header[40..42].copy_from_slice(&format.channels.to_le_bytes());
    header[44..48].copy_from_slice(&payload_len.to_le_bytes());
    header[48..80].copy_from_slice(&checksum);
    header[80..92].copy_from_slice(&nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| StoreError::Corrupt)?;
    let aad = audio_aad(track_id, &header);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: payload,
                aad: &aad,
            },
        )
        .map_err(|_| StoreError::Corrupt)?;
    records.write_all(&header)?;
    records.write_all(&ciphertext)?;
    let record_bytes = u64::try_from(RECORD_HEADER_BYTES)
        .ok()
        .and_then(|header_bytes| header_bytes.checked_add(u64::try_from(ciphertext.len()).ok()?))
        .ok_or(StoreError::Corrupt)?;
    let end_offset_ns = start_offset_ns.checked_add(duration_ns);

    let mut index_plaintext = [0_u8; INDEX_PLAINTEXT_BYTES];
    index_plaintext[..8].copy_from_slice(&sequence.to_le_bytes());
    index_plaintext[8..16].copy_from_slice(&record_offset.to_le_bytes());
    index_plaintext[16..24].copy_from_slice(&start_offset_ns.to_le_bytes());
    index_plaintext[24..32].copy_from_slice(&duration_ns.to_le_bytes());
    index_plaintext[32..36].copy_from_slice(&frame_count.to_le_bytes());
    index_plaintext[36..40].copy_from_slice(
        &u32::try_from(record_bytes)
            .map_err(|_| StoreError::Corrupt)?
            .to_le_bytes(),
    );
    index_plaintext[40..48].copy_from_slice(&epoch.get().to_le_bytes());
    let mut index_nonce = [0_u8; 12];
    getrandom::fill(&mut index_nonce).map_err(|_| StoreError::Unavailable)?;
    let index_aad = index_aad(track_id);
    let encrypted_index = cipher
        .encrypt(
            Nonce::from_slice(&index_nonce),
            Payload {
                msg: &index_plaintext,
                aad: &index_aad,
            },
        )
        .map_err(|_| StoreError::Corrupt)?;
    if encrypted_index.len() != INDEX_RECORD_BYTES - index_nonce.len() {
        return Err(StoreError::Corrupt);
    }
    index.write_all(&index_nonce)?;
    index.write_all(&encrypted_index)?;
    Ok(PendingRecord {
        sequence,
        epoch: epoch.get(),
        start_offset_ns: Some(start_offset_ns),
        end_offset_ns,
        duration_ns,
        frame_count,
        record_offset,
        record_bytes,
    })
}

fn decrypt_durable_record(
    file: &mut File,
    key: &[u8; 32],
    track_id: SourceTrackId,
    descriptor: DurableRecordDescriptor,
) -> Result<DurableTrackRecord, StoreError> {
    let mut header = [0_u8; RECORD_HEADER_BYTES];
    if !read_exact_at(file, descriptor.record_offset, &mut header)? {
        return Err(StoreError::Corrupt);
    }
    if header[..4] != RECORD_MAGIC || header[4] != RECORD_FORMAT_VERSION {
        return Err(StoreError::Corrupt);
    }
    let sequence = read_u64(&header[8..16]);
    let epoch = read_u64(&header[16..24]);
    let start_offset_ns = read_u64(&header[24..32]);
    let frame_count = read_u32(&header[32..36]);
    let format = AudioFormat {
        sample_rate_hz: read_u32(&header[36..40]),
        channels: read_u16(&header[40..42]),
    };
    let payload_len =
        usize::try_from(read_u32(&header[44..48])).map_err(|_| StoreError::Corrupt)?;
    let expected_samples = format
        .checked_frame_samples(frame_count)
        .ok_or(StoreError::Corrupt)?;
    if payload_len
        != expected_samples
            .checked_mul(std::mem::size_of::<f32>())
            .ok_or(StoreError::Corrupt)?
    {
        return Err(StoreError::Corrupt);
    }
    let duration_ns = u64::from(frame_count)
        .checked_mul(1_000_000_000)
        .and_then(|frames| frames.checked_div(u64::from(format.sample_rate_hz)))
        .ok_or(StoreError::Corrupt)?;
    let ciphertext_len = payload_len.checked_add(16).ok_or(StoreError::Corrupt)?;
    let record_bytes = u64::try_from(RECORD_HEADER_BYTES)
        .ok()
        .and_then(|header_bytes| header_bytes.checked_add(u64::try_from(ciphertext_len).ok()?))
        .ok_or(StoreError::Corrupt)?;
    if sequence != descriptor.sequence
        || epoch != descriptor.epoch
        || start_offset_ns != descriptor.start_offset_ns
        || duration_ns != descriptor.duration_ns
        || frame_count != descriptor.frame_count
        || record_bytes != descriptor.record_bytes
    {
        return Err(StoreError::Corrupt);
    }
    let cipher_offset = descriptor
        .record_offset
        .checked_add(u64::try_from(RECORD_HEADER_BYTES).map_err(|_| StoreError::Corrupt)?)
        .ok_or(StoreError::Corrupt)?;
    let mut ciphertext = vec![0_u8; ciphertext_len];
    if !read_exact_at(file, cipher_offset, &mut ciphertext)? {
        return Err(StoreError::Corrupt);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| StoreError::Corrupt)?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&header[80..92]),
            Payload {
                msg: &ciphertext,
                aad: &audio_aad(track_id, &header),
            },
        )
        .map_err(|_| StoreError::Corrupt)?;
    if Sha256::digest(&plaintext).as_slice() != &header[48..80] {
        return Err(StoreError::Corrupt);
    }
    let samples = parse_f32_payload(&plaintext, expected_samples)?;
    Ok(DurableTrackRecord {
        track_id,
        sequence,
        source_epoch: SourceEpoch::new(epoch),
        start_offset_ns,
        duration_ns,
        format,
        samples,
    })
}

fn parse_f32_payload(payload: &[u8], expected_samples: usize) -> Result<Vec<f32>, StoreError> {
    if payload.len()
        != expected_samples
            .checked_mul(std::mem::size_of::<f32>())
            .ok_or(StoreError::Corrupt)?
    {
        return Err(StoreError::Corrupt);
    }
    let (chunks, remainder) = payload.as_chunks::<4>();
    if !remainder.is_empty() || chunks.len() != expected_samples {
        return Err(StoreError::Corrupt);
    }
    let mut samples = Vec::with_capacity(expected_samples);
    for bytes in chunks {
        let sample = f32::from_le_bytes(*bytes);
        if !sample.is_finite() {
            return Err(StoreError::Corrupt);
        }
        samples.push(sample);
    }
    Ok(samples)
}

fn repair_track_files(
    files: &TrackFiles,
    key: &[u8; 32],
    track_id: SourceTrackId,
) -> Result<RepairResult, StoreError> {
    let mut records_file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&files.records)?;
    let mut index_file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&files.index)?;
    let record_len = records_file.metadata()?.len();
    let mut records = Vec::new();
    let mut offset = 0_u64;
    let mut truncated = false;
    let mut last_epoch = None;
    let mut last_end_offset_ns = None;
    while offset < record_len {
        let mut header = [0_u8; RECORD_HEADER_BYTES];
        if !read_exact_at(&mut records_file, offset, &mut header)? {
            truncated = true;
            break;
        }
        if header[..4] != RECORD_MAGIC || header[4] != RECORD_FORMAT_VERSION {
            truncated = true;
            break;
        }
        let sequence = read_u64(&header[8..16]);
        let epoch = read_u64(&header[16..24]);
        let start = read_u64(&header[24..32]);
        let frame_count = read_u32(&header[32..36]);
        let sample_rate_hz = read_u32(&header[36..40]);
        let channels = read_u16(&header[40..42]);
        let payload_len =
            usize::try_from(read_u32(&header[44..48])).map_err(|_| StoreError::Corrupt)?;
        let Some(expected_samples) = AudioFormat {
            sample_rate_hz,
            channels,
        }
        .checked_frame_samples(frame_count) else {
            truncated = true;
            break;
        };
        if payload_len
            != expected_samples
                .checked_mul(std::mem::size_of::<f32>())
                .ok_or(StoreError::Corrupt)?
        {
            truncated = true;
            break;
        }
        let cipher_len = payload_len.checked_add(16).ok_or(StoreError::Corrupt)?;
        let mut ciphertext = vec![0_u8; cipher_len];
        let cipher_offset = offset
            .checked_add(u64::try_from(RECORD_HEADER_BYTES).map_err(|_| StoreError::Corrupt)?)
            .ok_or(StoreError::Corrupt)?;
        if !read_exact_at(&mut records_file, cipher_offset, &mut ciphertext)? {
            truncated = true;
            break;
        }
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| StoreError::Corrupt)?;
        let aad = audio_aad(track_id, &header);
        let plaintext = match cipher.decrypt(
            Nonce::from_slice(&header[80..92]),
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        ) {
            Ok(plaintext) => plaintext,
            Err(_) => {
                truncated = true;
                break;
            }
        };
        if Sha256::digest(&plaintext).as_slice() != &header[48..80] {
            truncated = true;
            break;
        }
        let duration_ns = u64::from(frame_count)
            .checked_mul(1_000_000_000)
            .and_then(|frames| frames.checked_div(u64::from(sample_rate_hz)))
            .ok_or(StoreError::Corrupt)?;
        let record_bytes = u64::try_from(RECORD_HEADER_BYTES)
            .ok()
            .and_then(|header_bytes| header_bytes.checked_add(u64::try_from(cipher_len).ok()?))
            .ok_or(StoreError::Corrupt)?;
        let end_offset_ns = start.checked_add(duration_ns);
        records.push(PendingRecord {
            sequence,
            epoch,
            start_offset_ns: Some(start),
            end_offset_ns,
            duration_ns,
            frame_count,
            record_offset: offset,
            record_bytes,
        });
        offset = offset
            .checked_add(record_bytes)
            .ok_or(StoreError::Corrupt)?;
        last_epoch = Some(epoch);
        last_end_offset_ns = end_offset_ns;
    }
    if offset != record_len {
        records_file.set_len(offset)?;
        records_file.sync_all()?;
    }
    let valid_index_bytes = rebuild_and_validate_index(&mut index_file, key, track_id, &records)?;
    if index_file.metadata()?.len() != valid_index_bytes {
        index_file.set_len(valid_index_bytes)?;
        index_file.sync_all()?;
        truncated = true;
    }
    Ok(RepairResult {
        records,
        truncated,
        last_epoch,
        last_end_offset_ns,
    })
}

fn rebuild_and_validate_index(
    file: &mut File,
    key: &[u8; 32],
    track_id: SourceTrackId,
    records: &[PendingRecord],
) -> Result<u64, StoreError> {
    let expected_len = u64::try_from(records.len())
        .ok()
        .and_then(|count| count.checked_mul(u64::try_from(INDEX_RECORD_BYTES).ok()?))
        .ok_or(StoreError::Corrupt)?;
    let current_len = file.metadata()?.len();
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| StoreError::Corrupt)?;
    let aad = index_aad(track_id);
    let mut valid_records = 0_u64;
    while valid_records < u64::try_from(records.len()).map_err(|_| StoreError::Corrupt)? {
        let offset = valid_records
            .checked_mul(u64::try_from(INDEX_RECORD_BYTES).map_err(|_| StoreError::Corrupt)?)
            .ok_or(StoreError::Corrupt)?;
        if offset
            .checked_add(u64::try_from(INDEX_RECORD_BYTES).map_err(|_| StoreError::Corrupt)?)
            .ok_or(StoreError::Corrupt)?
            > current_len
        {
            break;
        }
        let mut bytes = [0_u8; INDEX_RECORD_BYTES];
        if !read_exact_at(file, offset, &mut bytes)? {
            break;
        }
        let plaintext = match cipher.decrypt(
            Nonce::from_slice(&bytes[..12]),
            Payload {
                msg: &bytes[12..],
                aad: &aad,
            },
        ) {
            Ok(value) => value,
            Err(_) => break,
        };
        let record = records
            .get(usize::try_from(valid_records).map_err(|_| StoreError::Corrupt)?)
            .ok_or(StoreError::Corrupt)?;
        if plaintext.len() != INDEX_PLAINTEXT_BYTES
            || read_u64(&plaintext[..8]) != record.sequence
            || read_u64(&plaintext[8..16]) != record.record_offset
            || read_u64(&plaintext[16..24]) != record.start_offset_ns.unwrap_or(MISSING_OFFSET)
            || read_u64(&plaintext[24..32]) != record.duration_ns
            || read_u32(&plaintext[32..36]) != record.frame_count
            || u64::from(read_u32(&plaintext[36..40])) != record.record_bytes
            || read_u64(&plaintext[40..48]) != record.epoch
        {
            break;
        }
        valid_records = valid_records.checked_add(1).ok_or(StoreError::Corrupt)?;
    }
    if valid_records == u64::try_from(records.len()).map_err(|_| StoreError::Corrupt)? {
        Ok(expected_len)
    } else {
        Ok(valid_records
            .checked_mul(u64::try_from(INDEX_RECORD_BYTES).map_err(|_| StoreError::Corrupt)?)
            .ok_or(StoreError::Corrupt)?)
    }
}

fn audio_aad(track_id: SourceTrackId, header: &[u8; RECORD_HEADER_BYTES]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(16 + header.len());
    aad.extend_from_slice(track_id.uuid().as_bytes());
    aad.extend_from_slice(header);
    aad
}

fn index_aad(track_id: SourceTrackId) -> [u8; 21] {
    let mut aad = [0_u8; 21];
    aad[..16].copy_from_slice(track_id.uuid().as_bytes());
    aad[16..].copy_from_slice(b"index");
    aad
}

fn read_exact_at(file: &mut File, offset: u64, buffer: &mut [u8]) -> Result<bool, StoreError> {
    file.seek(SeekFrom::Start(offset))?;
    let mut read = 0_usize;
    while read < buffer.len() {
        let count = file.read(&mut buffer[read..])?;
        if count == 0 {
            return Ok(false);
        }
        read = read.checked_add(count).ok_or(StoreError::Corrupt)?;
    }
    Ok(true)
}

fn open_private_append_file(path: &Path) -> Result<File, StoreError> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
            return Err(StoreError::Invalid);
        }
    }
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .read(true)
        .open(path)?;
    set_private_file_permissions(path)?;
    Ok(file)
}

fn ensure_private_directory(path: &Path) -> Result<(), StoreError> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(StoreError::Invalid);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn set_private_file_permissions(path: &Path) -> Result<(), StoreError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn sync_parent_directory(path: &Path) -> Result<(), StoreError> {
    #[cfg(unix)]
    {
        let parent = path.parent().ok_or(StoreError::Invalid)?;
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

fn validated_relative(root: &Path, relative: &str) -> Result<PathBuf, StoreError> {
    let candidate = Path::new(relative);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(StoreError::Invalid);
    }
    Ok(root.join(candidate))
}

fn phase_db(phase: MeetingPhase) -> &'static str {
    match phase {
        MeetingPhase::Preflight => "preflight",
        MeetingPhase::Starting => "starting",
        MeetingPhase::CapturingRecording => "capturing_recording",
        MeetingPhase::CapturingPausing => "capturing_pausing",
        MeetingPhase::CapturingPaused => "capturing_paused",
        MeetingPhase::CapturingResuming => "capturing_resuming",
        MeetingPhase::Stopping => "stopping",
        MeetingPhase::Processing => "processing",
        MeetingPhase::ReviewReady => "review_ready",
        MeetingPhase::RecoveryRequired => "recovery_required",
        MeetingPhase::Deleting => "deleting",
    }
}

fn cloud_outbox_kind_to_db(kind: CloudOutboxKind) -> &'static str {
    match kind {
        CloudOutboxKind::Object => "object",
        CloudOutboxKind::Tombstone => "tombstone",
        CloudOutboxKind::Share => "share",
    }
}

fn cloud_outbox_kind_from_db(value: &str) -> Result<CloudOutboxKind, StoreError> {
    match value {
        "object" => Ok(CloudOutboxKind::Object),
        "tombstone" => Ok(CloudOutboxKind::Tombstone),
        "share" => Ok(CloudOutboxKind::Share),
        _ => Err(StoreError::Corrupt),
    }
}

fn cloud_outbox_state_to_db(state: CloudOutboxState) -> &'static str {
    match state {
        CloudOutboxState::Pending => "pending",
        CloudOutboxState::Claimed => "claimed",
        CloudOutboxState::Completed => "completed",
        CloudOutboxState::Cancelled => "cancelled",
        CloudOutboxState::Terminal => "terminal",
    }
}

fn cloud_outbox_state_from_db(value: &str) -> Result<CloudOutboxState, StoreError> {
    match value {
        "pending" => Ok(CloudOutboxState::Pending),
        "claimed" => Ok(CloudOutboxState::Claimed),
        "completed" => Ok(CloudOutboxState::Completed),
        "cancelled" => Ok(CloudOutboxState::Cancelled),
        "terminal" => Ok(CloudOutboxState::Terminal),
        _ => Err(StoreError::Corrupt),
    }
}

fn cloud_share_state_to_db(state: CloudShareState) -> &'static str {
    match state {
        CloudShareState::Pending => "pending",
        CloudShareState::Active => "active",
        CloudShareState::Revoked => "revoked",
        CloudShareState::Failed => "failed",
    }
}

fn cloud_share_state_from_db(value: &str) -> Result<CloudShareState, StoreError> {
    match value {
        "pending" => Ok(CloudShareState::Pending),
        "active" => Ok(CloudShareState::Active),
        "revoked" => Ok(CloudShareState::Revoked),
        "failed" => Ok(CloudShareState::Failed),
        _ => Err(StoreError::Corrupt),
    }
}

fn cloud_share_content_kind_to_db(kind: CloudShareContentKind) -> &'static str {
    match kind {
        CloudShareContentKind::CapabilityBundle => "capability_bundle",
        CloudShareContentKind::BrowserMarkdown => "browser_markdown",
    }
}

fn cloud_share_content_kind_from_db(value: &str) -> Result<CloudShareContentKind, StoreError> {
    match value {
        "capability_bundle" => Ok(CloudShareContentKind::CapabilityBundle),
        "browser_markdown" => Ok(CloudShareContentKind::BrowserMarkdown),
        _ => Err(StoreError::Corrupt),
    }
}

fn cloud_head_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CloudHead> {
    let source_session_id: Option<String> = row.get(1)?;
    let sequence: i64 = row.get(5)?;
    Ok(CloudHead {
        object_id: row.get(0)?,
        source_session_id: source_session_id
            .as_deref()
            .map(parse_uuid)
            .transpose()
            .map_err(to_sql_error)?
            .map(MeetingSessionId::from_uuid),
        remote_revision_id: row.get(2)?,
        tombstone: row.get::<_, i64>(3)? != 0,
        acknowledged_revision_id: row.get(4)?,
        change_sequence: from_i64(sequence).map_err(to_sql_error)?,
    })
}

fn cloud_head_in(
    connection: &Connection,
    object_id: &str,
) -> Result<Option<CloudHead>, StoreError> {
    connection
        .query_row(
            "SELECT object_id, source_session_id, remote_revision_id, tombstone,
                    acknowledged_revision_id, change_sequence
             FROM meeting_cloud_heads WHERE object_id = ?1",
            params![object_id],
            cloud_head_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn upsert_cloud_head_in(transaction: &Transaction<'_>, head: &CloudHead) -> Result<(), StoreError> {
    validate_cloud_head(head)?;
    let changed = transaction.execute(
        "INSERT INTO meeting_cloud_heads (
            object_id, source_session_id, remote_revision_id, tombstone,
            acknowledged_revision_id, change_sequence, updated_at_utc_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(object_id) DO UPDATE SET
            source_session_id = excluded.source_session_id,
            remote_revision_id = excluded.remote_revision_id,
            tombstone = excluded.tombstone,
            acknowledged_revision_id = excluded.acknowledged_revision_id,
            change_sequence = excluded.change_sequence,
            updated_at_utc_ms = excluded.updated_at_utc_ms
         WHERE excluded.change_sequence >= meeting_cloud_heads.change_sequence",
        params![
            head.object_id,
            head.source_session_id.map(id),
            head.remote_revision_id,
            bool_to_i64(head.tombstone),
            head.acknowledged_revision_id,
            to_i64(head.change_sequence)?,
            utc_now_ms(),
        ],
    )?;
    if changed != 1 {
        return Err(StoreError::Conflict);
    }
    Ok(())
}

fn cloud_outbox_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CloudOutboxRecord> {
    let source_session_id: Option<String> = row.get(3)?;
    let source_revision: Option<i64> = row.get(4)?;
    let share_content_kind: Option<String> = row.get(6)?;
    let attempt_count: i64 = row.get(11)?;
    Ok(CloudOutboxRecord {
        outbox_id: row.get(0)?,
        kind: cloud_outbox_kind_from_db(&row.get::<_, String>(1)?).map_err(to_sql_error)?,
        object_id: row.get(2)?,
        source_session_id: source_session_id
            .as_deref()
            .map(parse_uuid)
            .transpose()
            .map_err(to_sql_error)?
            .map(MeetingSessionId::from_uuid),
        source_revision: source_revision
            .map(from_i64)
            .transpose()
            .map_err(to_sql_error)?,
        base_remote_revision_id: row.get(5)?,
        share_content_kind: share_content_kind
            .as_deref()
            .map(cloud_share_content_kind_from_db)
            .transpose()
            .map_err(to_sql_error)?,
        remote_revision_id: row.get(7)?,
        upload_id: row.get(8)?,
        idempotency_key: row.get(9)?,
        state: cloud_outbox_state_from_db(&row.get::<_, String>(10)?).map_err(to_sql_error)?,
        attempt_count: u32::try_from(attempt_count)
            .map_err(|_| to_sql_error(StoreError::Corrupt))?,
        next_attempt_utc_ms: row.get(12)?,
        terminal_error: row.get(13)?,
        payload_relative_dir: row.get(14)?,
        claim_token: row.get(15)?,
    })
}

fn cloud_outbox_in(
    connection: &Connection,
    outbox_id: &str,
) -> Result<Option<CloudOutboxRecord>, StoreError> {
    connection
        .query_row(
            "SELECT outbox_id, kind, object_id, source_session_id, source_revision,
                    base_remote_revision_id, share_content_kind, remote_revision_id, upload_id,
                    idempotency_key, state, attempt_count, next_attempt_utc_ms, terminal_error,
                    payload_relative_dir, claim_token
             FROM meeting_cloud_outbox WHERE outbox_id = ?1",
            params![outbox_id],
            cloud_outbox_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn cloud_outbox_by_idempotency_in(
    connection: &Connection,
    idempotency_key: &str,
) -> Result<Option<CloudOutboxRecord>, StoreError> {
    connection
        .query_row(
            "SELECT outbox_id, kind, object_id, source_session_id, source_revision,
                    base_remote_revision_id, share_content_kind, remote_revision_id, upload_id,
                    idempotency_key, state, attempt_count, next_attempt_utc_ms, terminal_error,
                    payload_relative_dir, claim_token
             FROM meeting_cloud_outbox WHERE idempotency_key = ?1",
            params![idempotency_key],
            cloud_outbox_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn cloud_conflict_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CloudConflict> {
    let source_session_id: Option<String> = row.get(1)?;
    let source_revision: Option<i64> = row.get(2)?;
    Ok(CloudConflict {
        object_id: row.get(0)?,
        source_session_id: source_session_id
            .as_deref()
            .map(parse_uuid)
            .transpose()
            .map_err(to_sql_error)?
            .map(MeetingSessionId::from_uuid),
        source_revision: source_revision
            .map(from_i64)
            .transpose()
            .map_err(to_sql_error)?,
        remote_revision_id: row.get(3)?,
        remote_sequence: from_i64(row.get(4)?).map_err(to_sql_error)?,
        remote_bundle_relative_path: row.get(5)?,
    })
}

fn cloud_conflict_in(
    connection: &Connection,
    object_id: &str,
) -> Result<Option<CloudConflict>, StoreError> {
    connection
        .query_row(
            "SELECT object_id, source_session_id, source_revision, remote_revision_id,
                    remote_sequence, remote_bundle_relative_path
             FROM meeting_cloud_conflicts WHERE object_id = ?1",
            params![object_id],
            cloud_conflict_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn cloud_share_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CloudShareRecord> {
    let source_session_id: Option<String> = row.get(2)?;
    Ok(CloudShareRecord {
        share_id: row.get(0)?,
        object_id: row.get(1)?,
        source_session_id: source_session_id
            .as_deref()
            .map(parse_uuid)
            .transpose()
            .map_err(to_sql_error)?
            .map(MeetingSessionId::from_uuid),
        expires_at_utc_ms: row.get(3)?,
        state: cloud_share_state_from_db(&row.get::<_, String>(4)?).map_err(to_sql_error)?,
        content_kind: cloud_share_content_kind_from_db(&row.get::<_, String>(5)?)
            .map_err(to_sql_error)?,
        encrypted_link_material: row.get(6)?,
        outbox_id: row.get(7)?,
        revoked_at_utc_ms: row.get(8)?,
    })
}

fn cloud_share_in(
    connection: &Connection,
    share_id: &str,
) -> Result<Option<CloudShareRecord>, StoreError> {
    connection
        .query_row(
            "SELECT share_id, object_id, source_session_id, expires_at_utc_ms, state,
                    content_kind, encrypted_link_material, outbox_id, revoked_at_utc_ms
             FROM meeting_cloud_shares WHERE share_id = ?1",
            params![share_id],
            cloud_share_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn validate_cloud_text(value: &str) -> Result<(), StoreError> {
    if value.is_empty() || value.len() > 4_096 || value.contains(char::from(0)) {
        return Err(StoreError::Invalid);
    }
    Ok(())
}

fn validate_optional_cloud_text(value: &Option<String>) -> Result<(), StoreError> {
    value.as_deref().map(validate_cloud_text).transpose()?;
    Ok(())
}

fn validate_cloud_identifier(value: &str) -> Result<(), StoreError> {
    validate_cloud_text(value)?;
    if value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(StoreError::Invalid);
    }
    Ok(())
}

fn validate_optional_cloud_identifier(value: &Option<String>) -> Result<(), StoreError> {
    value
        .as_deref()
        .map(validate_cloud_identifier)
        .transpose()?;
    Ok(())
}

fn validate_cloud_local_id(value: &str) -> Result<(), StoreError> {
    Uuid::parse_str(value).map_err(|_| StoreError::Invalid)?;
    Ok(())
}

fn validate_cloud_state(state: &CloudState) -> Result<(), StoreError> {
    validate_cloud_identifier(&state.vault_id)?;
    validate_cloud_identifier(&state.device_id)?;
    validate_cloud_text(&state.endpoint)?;
    validate_optional_cloud_text(&state.cursor)?;
    validate_optional_cloud_text(&state.snapshot_high_water)
}

fn validate_cloud_head(head: &CloudHead) -> Result<(), StoreError> {
    validate_cloud_identifier(&head.object_id)?;
    validate_optional_cloud_identifier(&head.remote_revision_id)?;
    validate_optional_cloud_identifier(&head.acknowledged_revision_id)?;
    if head.tombstone && head.remote_revision_id.is_none() {
        return Err(StoreError::Invalid);
    }
    Ok(())
}

fn validate_cloud_outbox_input(input: &CloudOutboxInput) -> Result<(), StoreError> {
    validate_cloud_identifier(&input.object_id)?;
    validate_optional_cloud_identifier(&input.base_remote_revision_id)?;
    validate_optional_cloud_identifier(&input.remote_revision_id)?;
    validate_cloud_text(&input.idempotency_key)?;
    match input.kind {
        CloudOutboxKind::Object => {
            if input.source_session_id.is_none()
                || input.source_revision.is_none()
                || input.share_content_kind.is_some()
            {
                return Err(StoreError::Invalid);
            }
        }
        CloudOutboxKind::Tombstone => {
            if input.share_content_kind.is_some() {
                return Err(StoreError::Invalid);
            }
        }
        CloudOutboxKind::Share => {
            if input.share_content_kind.is_none() {
                return Err(StoreError::Invalid);
            }
        }
    }
    Ok(())
}

fn validate_cloud_outbox_source(
    transaction: &Transaction<'_>,
    input: &CloudOutboxInput,
) -> Result<(), StoreError> {
    let Some(session_id) = input.source_session_id else {
        return Ok(());
    };
    let session = session_row(transaction, session_id)?;
    match input.kind {
        CloudOutboxKind::Object | CloudOutboxKind::Share => {
            if !matches!(
                session.phase,
                MeetingPhase::ReviewReady | MeetingPhase::RecoveryRequired
            ) || input
                .source_revision
                .is_some_and(|revision| revision != session.revision)
            {
                return Err(StoreError::Conflict);
            }
        }
        CloudOutboxKind::Tombstone => {
            if session.phase != MeetingPhase::Deleting
                || input
                    .source_revision
                    .is_some_and(|revision| revision != session.revision)
            {
                return Err(StoreError::Conflict);
            }
        }
    }
    Ok(())
}

fn validate_cloud_outbox_update(update: &CloudOutboxUpdate) -> Result<(), StoreError> {
    validate_optional_cloud_identifier(&update.remote_revision_id)?;
    validate_optional_cloud_identifier(&update.upload_id)?;
    validate_optional_cloud_text(&update.terminal_error)?;
    match update.state {
        CloudOutboxState::Completed if update.terminal_error.is_none() => Ok(()),
        CloudOutboxState::Terminal if update.terminal_error.is_some() => Ok(()),
        _ => Err(StoreError::Invalid),
    }
}

fn validate_cloud_chunks(chunks: &[CloudOutboxChunk]) -> Result<(), StoreError> {
    let mut indices = HashSet::new();
    for chunk in chunks {
        if chunk.accepted || !indices.insert(chunk.chunk_index) {
            return Err(StoreError::Invalid);
        }
        validate_cloud_text(&chunk.sha256)?;
    }
    Ok(())
}

fn cloud_outbox_relative_dir(outbox_id: &str) -> String {
    format!(".cloud-outbox/{outbox_id}")
}

fn validated_cloud_outbox_dir(
    root: &Path,
    outbox_id: &str,
    relative: &str,
) -> Result<PathBuf, StoreError> {
    if relative != cloud_outbox_relative_dir(outbox_id) {
        return Err(StoreError::Invalid);
    }
    validated_relative(root, relative)
}

fn validated_cloud_conflict_bundle_path(
    root: &Path,
    relative: &str,
) -> Result<PathBuf, StoreError> {
    if !relative.starts_with(".cloud-conflicts/") || !relative.ends_with(".bundle") {
        return Err(StoreError::Invalid);
    }
    validated_relative(root, relative)
}

fn validate_cloud_conflict(conflict: &CloudConflict) -> Result<(), StoreError> {
    validate_cloud_identifier(&conflict.object_id)?;
    validate_cloud_identifier(&conflict.remote_revision_id)?;
    if conflict.remote_bundle_relative_path.len() > 256 {
        return Err(StoreError::Invalid);
    }
    Ok(())
}

fn validate_cloud_share_input(input: &CloudShareInput) -> Result<(), StoreError> {
    validate_cloud_identifier(&input.share_id)?;
    validate_cloud_identifier(&input.object_id)?;
    validate_cloud_text(&input.encrypted_link_material)?;
    if let Some(outbox_id) = &input.outbox_id {
        validate_cloud_local_id(outbox_id)?;
    }
    Ok(())
}

fn validate_cloud_share_source(
    transaction: &Transaction<'_>,
    session_id: Option<MeetingSessionId>,
) -> Result<(), StoreError> {
    let session_id = session_id.ok_or(StoreError::Invalid)?;
    let session = session_row(transaction, session_id)?;
    if !matches!(
        session.phase,
        MeetingPhase::ReviewReady | MeetingPhase::RecoveryRequired
    ) {
        return Err(StoreError::Conflict);
    }
    Ok(())
}

fn validate_cloud_share_update(update: &CloudShareUpdate) -> Result<(), StoreError> {
    if let Some(outbox_id) = &update.outbox_id {
        validate_cloud_local_id(outbox_id)?;
    }
    match update.state {
        CloudShareState::Revoked if update.revoked_at_utc_ms.is_some() => Ok(()),
        CloudShareState::Revoked => Err(StoreError::Invalid),
        _ if update.revoked_at_utc_ms.is_none() => Ok(()),
        _ => Err(StoreError::Invalid),
    }
}

fn cloud_bundle_task_state_from_db(
    value: &str,
) -> Result<cloud_bundle::CloudBundleTaskState, StoreError> {
    match value {
        "running" => Ok(cloud_bundle::CloudBundleTaskState::Running),
        "completed" => Ok(cloud_bundle::CloudBundleTaskState::Completed),
        "failed" => Ok(cloud_bundle::CloudBundleTaskState::Failed),
        _ => Err(StoreError::Corrupt),
    }
}

fn cloud_bundle_task_state_to_db(state: cloud_bundle::CloudBundleTaskState) -> &'static str {
    match state {
        cloud_bundle::CloudBundleTaskState::Running => "running",
        cloud_bundle::CloudBundleTaskState::Completed => "completed",
        cloud_bundle::CloudBundleTaskState::Failed => "failed",
    }
}

fn export_cloud_meeting_bundle_in(
    connection: &Connection,
    session_id: MeetingSessionId,
) -> Result<cloud_bundle::CloudMeetingBundleV1, StoreError> {
    let session = connection
        .query_row(
            "SELECT phase, revision, title, origin_kind, preflight_json, created_at_utc_ms,
                started_at_utc_ms, ended_at_utc_ms, recovered_at_utc_ms, successful_plan_id,
                processing_status, retention_policy_json, delete_after_utc_ms,
                current_transcript_revision_id, current_diarization_generation_id,
                diarization_status, diarization_model_id, diarization_model_version
         FROM meeting_sessions WHERE id = ?1",
            params![id(session_id)],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, Option<i64>>(12)?,
                    row.get::<_, Option<String>>(13)?,
                    row.get::<_, Option<String>>(14)?,
                    row.get::<_, String>(15)?,
                    row.get::<_, Option<String>>(16)?,
                    row.get::<_, Option<String>>(17)?,
                ))
            },
        )
        .optional()?
        .ok_or(StoreError::NotFound)?;
    let phase = phase_from_db(&session.0)?;
    if !matches!(
        phase,
        MeetingPhase::ReviewReady | MeetingPhase::RecoveryRequired
    ) {
        return Err(StoreError::Conflict);
    }
    let bundle_session = cloud_bundle::CloudBundleSession {
        session_id,
        phase,
        revision: from_i64(session.1)?,
        title: session.2,
        origin: decode_json(&session.3)?,
        preflight: decode_json(&session.4)?,
        created_at_utc_ms: session.5,
        started_at_utc_ms: session.6,
        ended_at_utc_ms: session.7,
        recovered_at_utc_ms: session.8,
        successful_plan_id: session
            .9
            .as_deref()
            .map(parse_uuid)
            .transpose()?
            .map(MeetingPlanId::from_uuid),
        processing_status: decode_json(&session.10)?,
        retention_policy: decode_json(&session.11)?,
        delete_after_utc_ms: session.12,
        current_transcript_revision_id: session
            .13
            .as_deref()
            .map(parse_uuid)
            .transpose()?
            .map(TranscriptRevisionId::from_uuid),
        current_diarization_generation_id: session
            .14
            .as_deref()
            .map(parse_uuid)
            .transpose()?
            .map(MeetingDiarizationGenerationId::from_uuid),
        diarization_status: diarization_status_from_db(&session.15)?,
        diarization_model_id: session.16,
        diarization_model_version: session.17,
    };

    let mut statement = connection.prepare(
        "SELECT plan_id, consent_id, attempt_number, schema_version, canonical_plan_json, created_at_utc_ms
         FROM meeting_run_plans WHERE session_id = ?1 ORDER BY attempt_number",
    )?;
    let run_plans = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleRunPlan {
                plan_id: MeetingPlanId::from_uuid(parse_uuid(&row.0)?),
                consent_id: ConsentId::from_uuid(parse_uuid(&row.1)?),
                attempt_number: u32::try_from(row.2).map_err(|_| StoreError::Corrupt)?,
                schema_version: u32::try_from(row.3).map_err(|_| StoreError::Corrupt)?,
                canonical_plan: decode_json(&row.4)?,
                created_at_utc_ms: row.5,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let mut statement = connection.prepare(
        "SELECT consent_id, attempt_number, preflight_revision, policy_version, acknowledgement_json,
                acknowledged_at_utc_ms FROM meeting_consents WHERE session_id = ?1 ORDER BY attempt_number",
    )?;
    let consents = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleConsent {
                consent_id: ConsentId::from_uuid(parse_uuid(&row.0)?),
                attempt_number: u32::try_from(row.1).map_err(|_| StoreError::Corrupt)?,
                preflight_revision: from_i64(row.2)?,
                policy_version: u32::try_from(row.3).map_err(|_| StoreError::Corrupt)?,
                acknowledgement: decode_json(&row.4)?,
                acknowledged_at_utc_ms: row.5,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let mut statement = connection.prepare(
        "SELECT track_id, plan_id, source_kind, required, requested, descriptor_json,
                timestamp_bridge_json, format_json, first_offset_ns, last_offset_ns, health
         FROM meeting_source_tracks WHERE session_id = ?1 ORDER BY source_kind",
    )?;
    let source_tracks = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, String>(10)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleSourceTrack {
                track_id: SourceTrackId::from_uuid(parse_uuid(&row.0)?),
                plan_id: MeetingPlanId::from_uuid(parse_uuid(&row.1)?),
                source_kind: source_kind_from_db(&row.2)?,
                required: row.3 != 0,
                requested: row.4 != 0,
                descriptor_json: row.5,
                timestamp_bridge: decode_json(&row.6)?,
                format: row.7.as_deref().map(decode_json).transpose()?,
                first_offset_ns: row.8.map(from_i64).transpose()?,
                last_offset_ns: row.9.map(from_i64).transpose()?,
                health: decode_json(&row.10)?,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let mut statement = connection.prepare(
        "SELECT e.track_id, e.source_epoch, e.format_epoch, e.bridge_json,
                e.observed_host_monotonic_ns
         FROM meeting_source_clock_epochs e
         JOIN meeting_source_tracks t ON t.track_id = e.track_id
         WHERE t.session_id = ?1 ORDER BY e.track_id, e.source_epoch, e.format_epoch",
    )?;
    let source_clock_epochs = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleSourceClockEpoch {
                track_id: SourceTrackId::from_uuid(parse_uuid(&row.0)?),
                source_epoch: SourceEpoch::new(from_i64(row.1)?),
                format_epoch: from_i64(row.2)?,
                bridge: decode_json(&row.3)?,
                observed_host_monotonic_ns: from_i64(row.4)?,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let mut statement = connection.prepare(
        "SELECT sequence, start_offset_ns, end_offset_ns, close_reason
         FROM meeting_capture_windows WHERE session_id = ?1 ORDER BY sequence",
    )?;
    let capture_windows = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleCaptureWindow {
                sequence: from_i64(row.0)?,
                start_offset_ns: from_i64(row.1)?,
                end_offset_ns: row.2.map(from_i64).transpose()?,
                close_reason: row.3,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let mut statement = connection.prepare(
        "SELECT g.track_id, g.source_epoch, g.start_offset_ns, g.end_offset_ns, g.reason,
                g.dropped_frames, g.observed_at_utc_ms
         FROM meeting_source_gaps g JOIN meeting_source_tracks t ON t.track_id = g.track_id
         WHERE t.session_id = ?1 ORDER BY g.gap_id",
    )?;
    let source_gaps = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<i64>>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleSourceGap {
                track_id: SourceTrackId::from_uuid(parse_uuid(&row.0)?),
                source_epoch: SourceEpoch::new(from_i64(row.1)?),
                start_offset_ns: row.2.map(from_i64).transpose()?,
                end_offset_ns: row.3.map(from_i64).transpose()?,
                reason: decode_json(&row.4)?,
                dropped_frames: row.5.map(from_i64).transpose()?,
                observed_at_utc_ms: row.6,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let mut statement = connection.prepare(
        "SELECT speaker_id, source_kind, display_name, revision, merged_into_speaker_id
         FROM meeting_speakers WHERE session_id = ?1 ORDER BY speaker_id",
    )?;
    let speakers = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleSpeaker {
                speaker_id: SpeakerId::from_uuid(parse_uuid(&row.0)?),
                source_kind: source_kind_from_db(&row.1)?,
                display_name: row.2,
                revision: from_i64(row.3)?,
                merged_into_speaker_id: row
                    .4
                    .as_deref()
                    .map(parse_uuid)
                    .transpose()?
                    .map(SpeakerId::from_uuid),
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let mut statement = connection.prepare(
        "SELECT transcript_revision_id, engine_id, model_version, destination_json, source_set_json,
                language, state, created_at_utc_ms, completed_at_utc_ms, error_code
         FROM meeting_transcript_revisions WHERE session_id = ?1 ORDER BY created_at_utc_ms, transcript_revision_id",
    )?;
    let transcript_revisions = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleTranscriptRevision {
                transcript_revision_id: TranscriptRevisionId::from_uuid(parse_uuid(&row.0)?),
                engine_id: row.1,
                model_version: row.2,
                destination: decode_json(&row.3)?,
                source_set: decode_json(&row.4)?,
                language: row.5,
                state: cloud_bundle_task_state_from_db(&row.6)?,
                created_at_utc_ms: row.7,
                completed_at_utc_ms: row.8,
                error_code: row.9,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let mut statement = connection.prepare(
        "SELECT s.segment_id, s.transcript_revision_id, s.track_id, s.ordinal, s.start_offset_ns,
                s.end_offset_ns, s.speaker_id, s.base_text, s.confidence_milli
         FROM meeting_transcript_segments s
         JOIN meeting_transcript_revisions r ON r.transcript_revision_id = s.transcript_revision_id
         WHERE r.session_id = ?1 ORDER BY s.transcript_revision_id, s.ordinal",
    )?;
    let transcript_segments = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<i64>>(8)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleTranscriptSegment {
                segment_id: TranscriptSegmentId::from_uuid(parse_uuid(&row.0)?),
                transcript_revision_id: TranscriptRevisionId::from_uuid(parse_uuid(&row.1)?),
                track_id: SourceTrackId::from_uuid(parse_uuid(&row.2)?),
                ordinal: from_i64(row.3)?,
                start_offset_ns: from_i64(row.4)?,
                end_offset_ns: from_i64(row.5)?,
                speaker_id: SpeakerId::from_uuid(parse_uuid(&row.6)?),
                base_text: row.7,
                confidence_milli: row
                    .8
                    .map(|value| u16::try_from(value).map_err(|_| StoreError::Corrupt))
                    .transpose()?,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let mut statement = connection.prepare(
        "SELECT e.segment_id, e.edit_sequence, e.replacement_text, e.removed, e.operator_at_utc_ms
         FROM meeting_segment_edits e
         JOIN meeting_transcript_segments s ON s.segment_id = e.segment_id
         JOIN meeting_transcript_revisions r ON r.transcript_revision_id = s.transcript_revision_id
         WHERE r.session_id = ?1 ORDER BY e.segment_id, e.edit_sequence",
    )?;
    let segment_edits = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleSegmentEdit {
                segment_id: TranscriptSegmentId::from_uuid(parse_uuid(&row.0)?),
                edit_sequence: from_i64(row.1)?,
                replacement_text: row.2,
                removed: row.3 != 0,
                operator_at_utc_ms: row.4,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let notes = notes_for_session(connection, session_id)?;
    let mut statement = connection.prepare(
        "SELECT artifact_id, kind, transcript_revision_id, input_revision, state, created_at_utc_ms
         FROM meeting_artifacts WHERE session_id = ?1 ORDER BY created_at_utc_ms, artifact_id",
    )?;
    let artifacts = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleArtifact {
                artifact_id: MeetingArtifactId::from_uuid(parse_uuid(&row.0)?),
                kind: artifact_kind_from_db(&row.1)?,
                transcript_revision_id: row
                    .2
                    .as_deref()
                    .map(parse_uuid)
                    .transpose()?
                    .map(TranscriptRevisionId::from_uuid),
                input_revision: from_i64(row.3)?,
                state: artifact_state_from_db(&row.4)?,
                created_at_utc_ms: row.5,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let artifact_revisions = artifact_revisions_for_session(connection, session_id)?;
    let questions = question_history_for_session(connection, session_id)?;
    let mut statement = connection.prepare(
        "SELECT generation_id, transcript_revision_id, input_revision, model_id, model_version,
                state, created_at_utc_ms, completed_at_utc_ms
         FROM meeting_diarization_generations WHERE session_id = ?1 ORDER BY created_at_utc_ms, generation_id",
    )?;
    let diarization_generations = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<i64>>(7)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleDiarizationGeneration {
                generation_id: MeetingDiarizationGenerationId::from_uuid(parse_uuid(&row.0)?),
                transcript_revision_id: TranscriptRevisionId::from_uuid(parse_uuid(&row.1)?),
                input_revision: from_i64(row.2)?,
                model_id: row.3,
                model_version: row.4,
                state: cloud_bundle_task_state_from_db(&row.5)?,
                created_at_utc_ms: row.6,
                completed_at_utc_ms: row.7,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    let mut statement = connection.prepare(
        "SELECT a.generation_id, a.segment_id, a.speaker_id, a.assignment_kind
         FROM meeting_diarization_assignments a
         JOIN meeting_diarization_generations g ON g.generation_id = a.generation_id
         WHERE g.session_id = ?1 ORDER BY a.generation_id, a.segment_id",
    )?;
    let diarization_assignments = statement
        .query_map(params![id(session_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|row| {
            Ok(cloud_bundle::CloudBundleDiarizationAssignment {
                generation_id: MeetingDiarizationGenerationId::from_uuid(parse_uuid(&row.0)?),
                segment_id: TranscriptSegmentId::from_uuid(parse_uuid(&row.1)?),
                speaker_id: SpeakerId::from_uuid(parse_uuid(&row.2)?),
                assignment_kind: speaker_assignment_from_db(&row.3)?,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;

    Ok(cloud_bundle::CloudMeetingBundleV1 {
        format_version: cloud_bundle::CLOUD_MEETING_BUNDLE_VERSION,
        audio_included: false,
        session: bundle_session,
        run_plans,
        consents,
        source_tracks,
        source_clock_epochs,
        capture_windows,
        source_gaps,
        speakers,
        transcript_revisions,
        transcript_segments,
        segment_edits,
        notes,
        artifacts,
        artifact_revisions,
        questions,
        diarization_generations,
        diarization_assignments,
    })
}

fn import_cloud_meeting_bundle_in(
    transaction: &Transaction<'_>,
    bundle: &cloud_bundle::CloudMeetingBundleV1,
) -> Result<(), StoreError> {
    let session_id = bundle.session.session_id;
    let exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM meeting_sessions WHERE id = ?1)",
        params![id(session_id)],
        |row| row.get(0),
    )?;
    if exists {
        return Err(StoreError::Conflict);
    }
    transaction.execute(
        "INSERT INTO meeting_sessions (
            id, phase, revision, title, origin_kind, preflight_json, created_at_utc_ms,
            started_at_utc_ms, ended_at_utc_ms, recovered_at_utc_ms, successful_plan_id,
            processing_status, retention_policy_json, delete_after_utc_ms,
            current_transcript_revision_id, current_diarization_generation_id,
            diarization_status, diarization_model_id, diarization_model_version
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12, ?13,
                   NULL, NULL, ?14, ?15, ?16)",
        params![
            id(session_id),
            phase_db(bundle.session.phase),
            to_i64(bundle.session.revision)?,
            bundle.session.title,
            encode_json(&bundle.session.origin)?,
            encode_json(&bundle.session.preflight)?,
            bundle.session.created_at_utc_ms,
            bundle.session.started_at_utc_ms,
            bundle.session.ended_at_utc_ms,
            bundle.session.recovered_at_utc_ms,
            encode_json(&bundle.session.processing_status)?,
            encode_json(&bundle.session.retention_policy)?,
            bundle.session.delete_after_utc_ms,
            diarization_status_to_db(bundle.session.diarization_status),
            bundle.session.diarization_model_id,
            bundle.session.diarization_model_version,
        ],
    )?;

    for consent in &bundle.consents {
        transaction.execute(
            "INSERT INTO meeting_consents (
                consent_id, session_id, attempt_number, preflight_revision, policy_version,
                acknowledgement_json, acknowledged_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id(consent.consent_id),
                id(session_id),
                i64::from(consent.attempt_number),
                to_i64(consent.preflight_revision)?,
                i64::from(consent.policy_version),
                encode_json(&consent.acknowledgement)?,
                consent.acknowledged_at_utc_ms,
            ],
        )?;
    }
    for plan in &bundle.run_plans {
        transaction.execute(
            "INSERT INTO meeting_run_plans (
                plan_id, session_id, attempt_number, schema_version, consent_id,
                canonical_plan_json, created_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id(plan.plan_id),
                id(session_id),
                i64::from(plan.attempt_number),
                i64::from(plan.schema_version),
                id(plan.consent_id),
                encode_json(&plan.canonical_plan)?,
                plan.created_at_utc_ms,
            ],
        )?;
    }
    for window in &bundle.capture_windows {
        transaction.execute(
            "INSERT INTO meeting_capture_windows (
                session_id, sequence, start_offset_ns, end_offset_ns, close_reason
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id(session_id),
                to_i64(window.sequence)?,
                to_i64(window.start_offset_ns)?,
                window.end_offset_ns.map(to_i64).transpose()?,
                window.close_reason,
            ],
        )?;
    }
    for track in &bundle.source_tracks {
        transaction.execute(
            "INSERT INTO meeting_source_tracks (
                track_id, session_id, plan_id, source_kind, required, requested, descriptor_json,
                timestamp_bridge_json, format_json, first_offset_ns, last_offset_ns, health
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                id(track.track_id),
                id(session_id),
                id(track.plan_id),
                track.source_kind.as_str(),
                bool_to_i64(track.required),
                bool_to_i64(track.requested),
                track.descriptor_json,
                encode_json(&track.timestamp_bridge)?,
                track.format.as_ref().map(encode_json).transpose()?,
                track.first_offset_ns.map(to_i64).transpose()?,
                track.last_offset_ns.map(to_i64).transpose()?,
                encode_json(&track.health)?,
            ],
        )?;
    }
    for epoch in &bundle.source_clock_epochs {
        transaction.execute(
            "INSERT INTO meeting_source_clock_epochs (
                track_id, source_epoch, format_epoch, bridge_json, observed_host_monotonic_ns
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id(epoch.track_id),
                to_i64(epoch.source_epoch.get())?,
                to_i64(epoch.format_epoch)?,
                encode_json(&epoch.bridge)?,
                to_i64(epoch.observed_host_monotonic_ns)?,
            ],
        )?;
    }
    for gap in &bundle.source_gaps {
        transaction.execute(
            "INSERT INTO meeting_source_gaps (
                track_id, source_epoch, start_offset_ns, end_offset_ns, reason, dropped_frames,
                observed_at_utc_ms, details_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '{}')",
            params![
                id(gap.track_id),
                to_i64(gap.source_epoch.get())?,
                gap.start_offset_ns.map(to_i64).transpose()?,
                gap.end_offset_ns.map(to_i64).transpose()?,
                encode_json(&gap.reason)?,
                gap.dropped_frames.map(to_i64).transpose()?,
                gap.observed_at_utc_ms,
            ],
        )?;
    }
    for speaker in &bundle.speakers {
        transaction.execute(
            "INSERT INTO meeting_speakers (
                speaker_id, session_id, source_kind, display_name, revision, merged_into_speaker_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            params![
                id(speaker.speaker_id),
                id(session_id),
                speaker.source_kind.as_str(),
                speaker.display_name,
                to_i64(speaker.revision)?,
            ],
        )?;
    }
    for speaker in &bundle.speakers {
        if let Some(merged_into_speaker_id) = speaker.merged_into_speaker_id {
            transaction.execute(
                "UPDATE meeting_speakers SET merged_into_speaker_id = ?1 WHERE speaker_id = ?2",
                params![id(merged_into_speaker_id), id(speaker.speaker_id)],
            )?;
        }
    }
    for revision in &bundle.transcript_revisions {
        transaction.execute(
            "INSERT INTO meeting_transcript_revisions (
                transcript_revision_id, session_id, engine_id, model_version, destination_json,
                source_set_json, language, state, created_at_utc_ms, completed_at_utc_ms, error_code
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id(revision.transcript_revision_id),
                id(session_id),
                revision.engine_id,
                revision.model_version,
                encode_json(&revision.destination)?,
                encode_json(&revision.source_set)?,
                revision.language,
                cloud_bundle_task_state_to_db(revision.state),
                revision.created_at_utc_ms,
                revision.completed_at_utc_ms,
                revision.error_code,
            ],
        )?;
    }
    for segment in &bundle.transcript_segments {
        transaction.execute(
            "INSERT INTO meeting_transcript_segments (
                segment_id, transcript_revision_id, track_id, ordinal, start_offset_ns,
                end_offset_ns, speaker_id, base_text, confidence_milli
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id(segment.segment_id),
                id(segment.transcript_revision_id),
                id(segment.track_id),
                to_i64(segment.ordinal)?,
                to_i64(segment.start_offset_ns)?,
                to_i64(segment.end_offset_ns)?,
                id(segment.speaker_id),
                segment.base_text,
                segment.confidence_milli.map(i64::from),
            ],
        )?;
    }
    for edit in &bundle.segment_edits {
        transaction.execute(
            "INSERT INTO meeting_segment_edits (
                segment_id, edit_sequence, replacement_text, removed, operator_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id(edit.segment_id),
                to_i64(edit.edit_sequence)?,
                edit.replacement_text,
                bool_to_i64(edit.removed),
                edit.operator_at_utc_ms,
            ],
        )?;
    }
    for note in &bundle.notes {
        transaction.execute(
            "INSERT INTO meeting_notes (
                note_id, session_id, start_offset_ns, end_offset_ns, body, note_revision,
                created_at_utc_ms, updated_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id(note.note_id),
                id(session_id),
                note.start_offset_ns.map(to_i64).transpose()?,
                note.end_offset_ns.map(to_i64).transpose()?,
                note.body,
                to_i64(note.revision)?,
                note.created_at_utc_ms,
                note.updated_at_utc_ms,
            ],
        )?;
    }
    for artifact in &bundle.artifacts {
        transaction.execute(
            "INSERT INTO meeting_artifacts (
                artifact_id, session_id, kind, transcript_revision_id, input_revision, state,
                created_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id(artifact.artifact_id),
                id(session_id),
                cloud_artifact_kind_to_db(artifact.kind),
                artifact.transcript_revision_id.map(id),
                to_i64(artifact.input_revision)?,
                artifact_state_to_db(artifact.state),
                artifact.created_at_utc_ms,
            ],
        )?;
    }
    for artifact in &bundle.artifact_revisions {
        transaction.execute(
            "INSERT INTO meeting_artifact_revisions (
                artifact_id, session_id, transcript_revision_id, input_revision, template_id,
                template_version, generation_key, state, content_json, generated_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id(artifact.artifact_id),
                id(session_id),
                id(artifact.transcript_revision_id),
                to_i64(artifact.input_revision)?,
                artifact.template_id,
                i64::from(artifact.template_version),
                artifact.generation_key,
                artifact_state_to_db(artifact.state),
                artifact.content.as_ref().map(encode_json).transpose()?,
                artifact.generated_at_utc_ms,
            ],
        )?;
    }
    for question in &bundle.questions {
        let question_text = question.question.as_deref().ok_or(StoreError::Invalid)?;
        transaction.execute(
            "INSERT INTO meeting_questions (
                question_id, session_id, question_text, answer_state, answer_text, revision,
                created_at_utc_ms, scope_json, input_revision
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id(question.question_id),
                id(session_id),
                question_text,
                meeting_answer_state_to_db(question.state),
                question.answer,
                to_i64(question.revision)?,
                question.created_at_utc_ms,
                encode_json(&question.scope)?,
                to_i64(question.input_revision)?,
            ],
        )?;
        for (ordinal, citation) in question.citations.iter().enumerate() {
            transaction.execute(
                "INSERT INTO meeting_question_citations (question_id, ordinal, citation_json)
                 VALUES (?1, ?2, ?3)",
                params![
                    id(question.question_id),
                    i64::try_from(ordinal).map_err(|_| StoreError::Invalid)?,
                    encode_json(citation)?,
                ],
            )?;
        }
    }
    for generation in &bundle.diarization_generations {
        transaction.execute(
            "INSERT INTO meeting_diarization_generations (
                generation_id, session_id, transcript_revision_id, input_revision, model_id,
                model_version, state, created_at_utc_ms, completed_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id(generation.generation_id),
                id(session_id),
                id(generation.transcript_revision_id),
                to_i64(generation.input_revision)?,
                generation.model_id,
                generation.model_version,
                cloud_bundle_task_state_to_db(generation.state),
                generation.created_at_utc_ms,
                generation.completed_at_utc_ms,
            ],
        )?;
    }
    for assignment in &bundle.diarization_assignments {
        transaction.execute(
            "INSERT INTO meeting_diarization_assignments (
                generation_id, segment_id, speaker_id, assignment_kind
             ) VALUES (?1, ?2, ?3, ?4)",
            params![
                id(assignment.generation_id),
                id(assignment.segment_id),
                id(assignment.speaker_id),
                speaker_assignment_to_db(assignment.assignment_kind),
            ],
        )?;
    }
    let changed = transaction.execute(
        "UPDATE meeting_sessions SET successful_plan_id = ?1,
                current_transcript_revision_id = ?2, current_diarization_generation_id = ?3,
                diarization_status = ?4, diarization_model_id = ?5, diarization_model_version = ?6
         WHERE id = ?7",
        params![
            bundle.session.successful_plan_id.map(id),
            bundle.session.current_transcript_revision_id.map(id),
            bundle.session.current_diarization_generation_id.map(id),
            diarization_status_to_db(bundle.session.diarization_status),
            bundle.session.diarization_model_id,
            bundle.session.diarization_model_version,
            id(session_id),
        ],
    )?;
    if changed != 1 {
        return Err(StoreError::Corrupt);
    }
    Ok(())
}

fn cloud_artifact_kind_to_db(kind: MeetingArtifactKind) -> &'static str {
    match kind {
        MeetingArtifactKind::Notes => "notes",
        MeetingArtifactKind::Actions => "actions",
        MeetingArtifactKind::Decisions => "decisions",
        MeetingArtifactKind::Topics => "topics",
    }
}

fn artifact_kind_from_db(value: &str) -> Result<MeetingArtifactKind, StoreError> {
    match value {
        "notes" => Ok(MeetingArtifactKind::Notes),
        "actions" => Ok(MeetingArtifactKind::Actions),
        "decisions" => Ok(MeetingArtifactKind::Decisions),
        "topics" => Ok(MeetingArtifactKind::Topics),
        _ => Err(StoreError::Corrupt),
    }
}

fn phase_from_db(value: &str) -> Result<MeetingPhase, StoreError> {
    match value {
        "preflight" => Ok(MeetingPhase::Preflight),
        "starting" => Ok(MeetingPhase::Starting),
        "capturing_recording" => Ok(MeetingPhase::CapturingRecording),
        "capturing_pausing" => Ok(MeetingPhase::CapturingPausing),
        "capturing_paused" => Ok(MeetingPhase::CapturingPaused),
        "capturing_resuming" => Ok(MeetingPhase::CapturingResuming),
        "stopping" => Ok(MeetingPhase::Stopping),
        "processing" => Ok(MeetingPhase::Processing),
        "review_ready" => Ok(MeetingPhase::ReviewReady),
        "recovery_required" => Ok(MeetingPhase::RecoveryRequired),
        "deleting" => Ok(MeetingPhase::Deleting),
        _ => Err(StoreError::Corrupt),
    }
}

fn source_kind_from_db(value: &str) -> Result<SourceKind, StoreError> {
    match value {
        "microphone" => Ok(SourceKind::Microphone),
        "system_audio" => Ok(SourceKind::SystemAudio),
        _ => Err(StoreError::Corrupt),
    }
}

fn diarization_status_to_db(status: DiarizationStatus) -> &'static str {
    match status {
        DiarizationStatus::NotRequested => "not_requested",
        DiarizationStatus::ModelUnavailable => "model_unavailable",
        DiarizationStatus::Downloading => "downloading",
        DiarizationStatus::Running => "running",
        DiarizationStatus::Succeeded => "succeeded",
        DiarizationStatus::Failed => "failed",
    }
}

fn diarization_status_from_db(value: &str) -> Result<DiarizationStatus, StoreError> {
    match value {
        "not_requested" => Ok(DiarizationStatus::NotRequested),
        "model_unavailable" => Ok(DiarizationStatus::ModelUnavailable),
        "downloading" => Ok(DiarizationStatus::Downloading),
        "running" => Ok(DiarizationStatus::Running),
        "succeeded" => Ok(DiarizationStatus::Succeeded),
        "failed" => Ok(DiarizationStatus::Failed),
        _ => Err(StoreError::Corrupt),
    }
}

fn speaker_assignment_to_db(assignment: SpeakerAssignmentKind) -> &'static str {
    match assignment {
        SpeakerAssignmentKind::LocalSpeaker => "local_speaker",
        SpeakerAssignmentKind::SystemSpeaker => "system_speaker",
        SpeakerAssignmentKind::Unknown => "unknown",
        SpeakerAssignmentKind::Overlap => "overlap",
    }
}

fn speaker_assignment_from_db(value: &str) -> Result<SpeakerAssignmentKind, StoreError> {
    match value {
        "local_speaker" => Ok(SpeakerAssignmentKind::LocalSpeaker),
        "system_speaker" => Ok(SpeakerAssignmentKind::SystemSpeaker),
        "unknown" => Ok(SpeakerAssignmentKind::Unknown),
        "overlap" => Ok(SpeakerAssignmentKind::Overlap),
        _ => Err(StoreError::Corrupt),
    }
}

fn artifact_state_to_db(state: MeetingArtifactState) -> &'static str {
    match state {
        MeetingArtifactState::Current => "current",
        MeetingArtifactState::OutOfDate => "out_of_date",
        MeetingArtifactState::Failed => "failed",
    }
}

fn artifact_state_from_db(value: &str) -> Result<MeetingArtifactState, StoreError> {
    match value {
        "current" => Ok(MeetingArtifactState::Current),
        "out_of_date" => Ok(MeetingArtifactState::OutOfDate),
        "failed" => Ok(MeetingArtifactState::Failed),
        _ => Err(StoreError::Corrupt),
    }
}

fn meeting_answer_state_to_db(state: MeetingAnswerState) -> &'static str {
    match state {
        MeetingAnswerState::Supported => "supported",
        MeetingAnswerState::InsufficientEvidence => "insufficient_evidence",
        MeetingAnswerState::Unavailable => "unavailable",
        MeetingAnswerState::OutOfDate => "out_of_date",
        MeetingAnswerState::Forgotten => "forgotten",
    }
}

fn meeting_answer_state_from_db(value: &str) -> Result<MeetingAnswerState, StoreError> {
    match value {
        "supported" => Ok(MeetingAnswerState::Supported),
        "insufficient_evidence" => Ok(MeetingAnswerState::InsufficientEvidence),
        "unavailable" => Ok(MeetingAnswerState::Unavailable),
        "out_of_date" => Ok(MeetingAnswerState::OutOfDate),
        "forgotten" => Ok(MeetingAnswerState::Forgotten),
        _ => Err(StoreError::Corrupt),
    }
}

fn meeting_fts_match_query(user_text: &str) -> Option<String> {
    let mut expression = String::new();
    for token in user_text
        .split_whitespace()
        .filter(|token| token.chars().any(char::is_alphanumeric))
    {
        if !expression.is_empty() {
            expression.push(' ');
        }
        expression.push('"');
        for character in token.chars() {
            if character == '"' {
                expression.push('"');
            }
            expression.push(character);
        }
        expression.push_str("\"*");
    }
    (!expression.is_empty()).then_some(expression)
}

fn bounded_text(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_string();
    }
    let mut end = limit;
    while !value.is_char_boundary(end) {
        end = end.saturating_sub(1);
    }
    value[..end].to_string()
}

fn id<T: Into<Uuid>>(value: T) -> String {
    value.into().to_string()
}

macro_rules! id_into_uuid {
    ($($type:ty),+ $(,)?) => {
        $(
            impl From<$type> for Uuid {
                fn from(value: $type) -> Self {
                    value.uuid()
                }
            }
        )+
    };
}

id_into_uuid!(
    MeetingSessionId,
    MeetingPlanId,
    ConsentId,
    SourceTrackId,
    TranscriptRevisionId,
    TranscriptSegmentId,
    SpeakerId,
    ManualNoteId,
    MeetingSuggestionId,
    MeetingOperationId,
    MeetingDeletionJobId,
    MeetingExportReceiptId,
    MeetingQuestionId,
    MeetingArtifactId,
    MeetingDiarizationGenerationId,
);

fn encode_json<T: Serialize + ?Sized>(value: &T) -> Result<String, StoreError> {
    serde_json::to_string(value).map_err(|_| StoreError::Corrupt)
}

fn decode_json<T: DeserializeOwned>(value: &str) -> Result<T, StoreError> {
    serde_json::from_str(value).map_err(|_| StoreError::Corrupt)
}

fn parse_uuid(value: &str) -> Result<Uuid, StoreError> {
    Uuid::parse_str(value).map_err(|_| StoreError::Corrupt)
}

fn to_i64(value: u64) -> Result<i64, StoreError> {
    i64::try_from(value).map_err(|_| StoreError::Invalid)
}

fn from_i64(value: i64) -> Result<u64, StoreError> {
    u64::try_from(value).map_err(|_| StoreError::Corrupt)
}

fn optional_i64(value: Option<u64>) -> Result<Option<i64>, StoreError> {
    value.map(to_i64).transpose()
}

fn bool_to_i64(value: bool) -> i64 {
    i64::from(value)
}

fn utc_now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn read_u64(bytes: &[u8]) -> u64 {
    let mut array = [0_u8; 8];
    array.copy_from_slice(bytes);
    u64::from_le_bytes(array)
}

fn read_u32(bytes: &[u8]) -> u32 {
    let mut array = [0_u8; 4];
    array.copy_from_slice(bytes);
    u32::from_le_bytes(array)
}

fn read_u16(bytes: &[u8]) -> u16 {
    let mut array = [0_u8; 2];
    array.copy_from_slice(bytes);
    u16::from_le_bytes(array)
}

fn to_sql_error(_: StoreError) -> rusqlite::Error {
    rusqlite::Error::InvalidQuery
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analytics::DashboardTrendRange;
    use crate::secrets::SecretManager;
    use tempfile::TempDir;

    fn store() -> (TempDir, Arc<MeetingStore>) {
        let directory = TempDir::new().unwrap();
        let manager =
            SecretManager::with_backend(Arc::new(crate::secrets::MemorySecretBackend::new()));
        let key = tauri::async_runtime::block_on(manager.meeting_storage_key()).unwrap();
        let store = MeetingStore::open(directory.path().join("meetings"), key).unwrap();
        (directory, store)
    }

    fn preflight(session_id: MeetingSessionId) -> MeetingPreflightSnapshot {
        MeetingPreflightSnapshot {
            session_id,
            revision: 0,
            proposed_title: "Design sync".to_string(),
            origin: MeetingOrigin::Manual,
            sources: SourceKind::ALL
                .into_iter()
                .map(|source_kind| MeetingSourceSnapshot {
                    track_id: None,
                    source_kind,
                    required: true,
                    availability: SourceAvailability::Available,
                    health: SourceHealth::NotStarted,
                    format: None,
                    last_durable_offset_ns: None,
                    gap_count: 0,
                })
                .collect(),
            storage: StorageAvailability::Available,
            local_processing: SourceAvailability::Available,
            destination: ProcessingDestination::Local,
            microphone_device_uid: None,
            frozen_system_audio_application_bundle_ids: Vec::new(),
            accepted_known_missing_sources: Vec::new(),
            degraded_start_policy: DegradedStartPolicy::AbortIfRequiredSourceFails,
            required_acknowledgements: SourceKind::ALL.to_vec(),
            allowed_actions: vec![AllowedMeetingAction::Start],
        }
    }

    fn review_ready_session(store: &MeetingStore, session_id: MeetingSessionId) -> u64 {
        store
            .create_preflight(
                StoreMutation {
                    operation_id: MeetingOperationId::new(),
                    requested_at_utc_ms: 1,
                    session_id,
                    expected_revision: 0,
                    command: MeetingCommandKind::PreflightCreate,
                },
                "Design sync".to_string(),
                MeetingOrigin::Manual,
                preflight(session_id),
                MeetingRetentionPolicy::Forever,
            )
            .expect("preflight");
        let preflight = store
            .session_snapshot(session_id)
            .expect("preflight snapshot");
        store
            .transition(StoreTransition {
                operation_id: None,
                actor: OperationActor::System,
                command: MeetingCommandKind::RecoveryFinalize,
                requested_at_utc_ms: 2,
                session_id,
                expected_revision: preflight.revision,
                allowed_from: &[MeetingPhase::Preflight],
                next_phase: MeetingPhase::ReviewReady,
                event_kind: "test_review_ready",
                reason_codes: Vec::new(),
            })
            .expect("review transition");
        store
            .session_snapshot(session_id)
            .expect("review snapshot")
            .revision
    }

    fn local_noon_ms(date: chrono::NaiveDate) -> i64 {
        date.and_hms_opt(12, 0, 0)
            .expect("local noon")
            .and_local_timezone(Local)
            .earliest()
            .expect("representable local noon")
            .timestamp_millis()
    }

    fn trend_session(store: &MeetingStore, created_at_utc_ms: i64) -> MeetingSessionId {
        let session_id = MeetingSessionId::new();
        review_ready_session(store, session_id);
        store
            .connection()
            .expect("store connection")
            .execute(
                "UPDATE meeting_sessions SET created_at_utc_ms = ?1 WHERE id = ?2",
                params![created_at_utc_ms, id(session_id)],
            )
            .expect("set trend session date");
        session_id
    }

    fn trend_artifacts(action_count: usize) -> GeneratedMeetingArtifacts {
        let text = CitedArtifactText {
            text: "generated".to_string(),
            citations: Vec::new(),
        };
        GeneratedMeetingArtifacts {
            summary: text.clone(),
            outline: Vec::new(),
            decisions: Vec::new(),
            action_items: (0..action_count)
                .map(|_| MeetingActionItem {
                    text: text.clone(),
                    owner_text: None,
                    due_text: None,
                })
                .collect(),
            key_questions: Vec::new(),
            risks: Vec::new(),
            follow_up_draft: text,
        }
    }

    fn seed_trend_metrics(store: &MeetingStore, session_id: MeetingSessionId) {
        let plan_id = MeetingPlanId::new();
        let microphone_track_id = SourceTrackId::new();
        let system_track_id = SourceTrackId::new();
        let current_transcript_revision_id = TranscriptRevisionId::new();
        let prior_transcript_revision_id = TranscriptRevisionId::new();
        let speaker_id = SpeakerId::new();
        let connection = store.connection().expect("store connection");
        let revision: i64 = connection
            .query_row(
                "SELECT revision FROM meeting_sessions WHERE id = ?1",
                params![id(session_id)],
                |row| row.get(0),
            )
            .expect("session revision");

        connection
            .execute(
                "INSERT INTO meeting_run_plans (
                    plan_id, session_id, attempt_number, schema_version, consent_id,
                    canonical_plan_json, created_at_utc_ms
                 ) VALUES (?1, ?2, 1, 1, ?3, '{}', 1)",
                params![id(plan_id), id(session_id), id(ConsentId::new())],
            )
            .expect("insert trend plan");
        for (track_id, source_kind) in [
            (microphone_track_id, "microphone"),
            (system_track_id, "system_audio"),
        ] {
            connection
                .execute(
                    "INSERT INTO meeting_source_tracks (
                        track_id, session_id, plan_id, source_kind, required, requested,
                        descriptor_json, timestamp_bridge_json, health
                     ) VALUES (?1, ?2, ?3, ?4, 1, 1, '{}', '{}', '\"healthy\"')",
                    params![id(track_id), id(session_id), id(plan_id), source_kind],
                )
                .expect("insert trend track");
        }
        for (track_id, start_offset_ns) in [
            (microphone_track_id, 0_i64),
            (system_track_id, 1_000_000_000_i64),
        ] {
            connection
                .execute(
                    "INSERT INTO meeting_track_records (
                        track_id, source_sequence, source_epoch, start_offset_ns, duration_ns,
                        frame_count, record_offset_bytes, record_bytes, durable_at_utc_ms
                     ) VALUES (?1, 0, 0, ?2, 2000000000, 1, 0, 1, 1)",
                    params![id(track_id), start_offset_ns],
                )
                .expect("insert durable trend record");
        }
        for transcript_revision_id in [prior_transcript_revision_id, current_transcript_revision_id]
        {
            connection
                .execute(
                    "INSERT INTO meeting_transcript_revisions (
                        transcript_revision_id, session_id, engine_id, destination_json,
                        source_set_json, language, state, created_at_utc_ms, completed_at_utc_ms
                     ) VALUES (?1, ?2, 'test', '{}', '[]', 'en', 'completed', 1, 1)",
                    params![id(transcript_revision_id), id(session_id)],
                )
                .expect("insert transcript revision");
        }
        connection
            .execute(
                "UPDATE meeting_sessions
                 SET current_transcript_revision_id = ?1
                 WHERE id = ?2",
                params![id(current_transcript_revision_id), id(session_id)],
            )
            .expect("set current transcript revision");
        connection
            .execute(
                "INSERT INTO meeting_speakers (
                    speaker_id, session_id, source_kind, display_name, revision
                 ) VALUES (?1, ?2, 'microphone', 'Speaker', 0)",
                params![id(speaker_id), id(session_id)],
            )
            .expect("insert trend speaker");
        for (transcript_revision_id, ordinal) in [
            (prior_transcript_revision_id, 0_i64),
            (current_transcript_revision_id, 0_i64),
            (current_transcript_revision_id, 1_i64),
        ] {
            connection
                .execute(
                    "INSERT INTO meeting_transcript_segments (
                        segment_id, transcript_revision_id, track_id, ordinal, start_offset_ns,
                        end_offset_ns, speaker_id, base_text, confidence_milli
                     ) VALUES (?1, ?2, ?3, ?4, 0, 1000000000, ?5, 'segment', NULL)",
                    params![
                        id(TranscriptSegmentId::new()),
                        id(transcript_revision_id),
                        id(microphone_track_id),
                        ordinal,
                        id(speaker_id)
                    ],
                )
                .expect("insert transcript segment");
        }
        let removed_current_segment_id = TranscriptSegmentId::new();
        connection
            .execute(
                "INSERT INTO meeting_transcript_segments (
                    segment_id, transcript_revision_id, track_id, ordinal, start_offset_ns,
                    end_offset_ns, speaker_id, base_text, confidence_milli
                 ) VALUES (?1, ?2, ?3, 2, 0, 1000000000, ?4, 'removed segment', NULL)",
                params![
                    id(removed_current_segment_id),
                    id(current_transcript_revision_id),
                    id(microphone_track_id),
                    id(speaker_id)
                ],
            )
            .expect("insert removed current transcript segment");
        connection
            .execute(
                "INSERT INTO meeting_segment_edits (
                    segment_id, edit_sequence, replacement_text, removed, operator_at_utc_ms
                 ) VALUES (?1, 0, '', 1, 1)",
                params![id(removed_current_segment_id)],
            )
            .expect("remove current transcript segment");
        for (artifact_id, transcript_revision_id, input_revision, state, content) in [
            (
                MeetingArtifactId::new(),
                prior_transcript_revision_id,
                revision,
                "current",
                trend_artifacts(5),
            ),
            (
                MeetingArtifactId::new(),
                current_transcript_revision_id,
                revision,
                "out_of_date",
                trend_artifacts(7),
            ),
            (
                MeetingArtifactId::new(),
                current_transcript_revision_id,
                revision
                    .checked_add(1)
                    .expect("test revision can be incremented"),
                "current",
                trend_artifacts(11),
            ),
            (
                MeetingArtifactId::new(),
                current_transcript_revision_id,
                revision,
                "current",
                trend_artifacts(2),
            ),
        ] {
            connection
                .execute(
                    "INSERT INTO meeting_artifact_revisions (
                        artifact_id, session_id, transcript_revision_id, input_revision,
                        template_id, template_version, generation_key, state, content_json,
                        generated_at_utc_ms
                     ) VALUES (?1, ?2, ?3, ?4, 'test', 1, ?5, ?6, ?7, 1)",
                    params![
                        id(artifact_id),
                        id(session_id),
                        id(transcript_revision_id),
                        input_revision,
                        id(artifact_id),
                        state,
                        encode_json(&content).expect("encode trend artifact")
                    ],
                )
                .expect("insert trend artifact");
        }
    }

    #[test]
    fn meeting_trend_zero_fills_an_empty_requested_range() {
        let (_directory, store) = store();
        let now = Local::now();
        for range in [
            DashboardTrendRange::Days7,
            DashboardTrendRange::Days30,
            DashboardTrendRange::Days180,
        ] {
            let request = DashboardTrendRequest { range };
            let trend = {
                let mut connection = store.connection().expect("store connection");
                MeetingStore::trend_projection_with_connection_at(
                    &mut connection,
                    request,
                    now.clone(),
                )
                .expect("empty meeting trend")
            };

            let MeetingTrendProjection::Available {
                range: returned_range,
                range_total,
                all_time,
                points,
                ..
            } = trend
            else {
                panic!("opened store must have an available trend projection");
            };
            assert_eq!(returned_range, range);
            assert_eq!(points.len(), range.days());
            assert!(points.iter().all(|point| {
                point.meetings == 0
                    && point.verified_captured_duration_ms == 0
                    && point.transcript_segments == 0
                    && point.generated_action_items == 0
            }));
            assert_eq!(range_total.meetings, 0);
            assert_eq!(all_time.meetings, 0);
        }
    }

    #[test]
    fn meeting_trend_uses_retained_sessions_current_segments_artifacts_and_unfiltered_data() {
        let (_directory, store) = store();
        let request = DashboardTrendRequest {
            range: DashboardTrendRange::Days7,
        };
        let now = Local::now();
        let calendar =
            LocalCalendarRange::at(now.clone(), request.range).expect("local calendar range");
        let dates = calendar.local_dates().expect("requested local dates");

        let captured = trend_session(&store, local_noon_ms(dates[0]));
        seed_trend_metrics(&store, captured);
        let uncaptured = trend_session(&store, local_noon_ms(dates[2]));
        let deleting = trend_session(&store, local_noon_ms(dates[1]));
        let deleted = trend_session(&store, local_noon_ms(dates[3]));
        let outside_range = trend_session(&store, calendar.end_exclusive_utc_ms());

        {
            let connection = store.connection().expect("store connection");
            connection
                .execute(
                    "UPDATE meeting_sessions SET phase = 'deleting' WHERE id = ?1",
                    params![id(deleting)],
                )
                .expect("tombstone meeting");
            connection
                .execute(
                    "DELETE FROM meeting_sessions WHERE id = ?1",
                    params![id(deleted)],
                )
                .expect("delete meeting");
            connection
                .execute(
                    "INSERT INTO meeting_search_documents (
                        session_id, entity_kind, entity_id, content
                     ) VALUES (?1, 'title', ?2, 'captured only')",
                    params![id(captured), id(captured)],
                )
                .expect("seed a narrowed search document");
        }

        let filtered = store
            .search_evidence(&[captured], "captured", 10)
            .expect("narrowed meeting search");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].citation.session_id, captured);

        let mut connection = store.connection().expect("store connection");
        let trend =
            MeetingStore::trend_projection_with_connection_at(&mut connection, request, now)
                .expect("meeting trend");

        let MeetingTrendProjection::Available {
            range,
            range_total,
            all_time,
            points,
            ..
        } = trend
        else {
            panic!("opened store must have an available trend projection");
        };
        assert_eq!(range, DashboardTrendRange::Days7);
        assert_eq!(points.len(), 7);
        assert_eq!(points[0].meetings, 1);
        assert_eq!(points[0].verified_captured_duration_ms, 3_000);
        assert_eq!(points[0].transcript_segments, 2);
        assert_eq!(points[0].generated_action_items, 2);
        assert_eq!(points[1].meetings, 0);
        assert_eq!(points[2].meetings, 1);
        assert_eq!(points[2].verified_captured_duration_ms, 0);
        assert_eq!(points[2].transcript_segments, 0);
        assert_eq!(points[2].generated_action_items, 0);
        assert_eq!(range_total.meetings, 2);
        assert_eq!(range_total.verified_captured_duration_ms, 3_000);
        assert_eq!(range_total.transcript_segments, 2);
        assert_eq!(range_total.generated_action_items, 2);
        assert_eq!(all_time.meetings, 3);
        assert_eq!(all_time.verified_captured_duration_ms, 3_000);
        assert_eq!(all_time.transcript_segments, 2);
        assert_eq!(all_time.generated_action_items, 2);
        assert_ne!(outside_range, captured);
        assert_ne!(uncaptured, captured);
    }

    #[test]
    fn meeting_trend_uses_local_calendar_boundaries() {
        let (_directory, store) = store();
        let request = DashboardTrendRequest {
            range: DashboardTrendRange::Days7,
        };
        let now = Local::now();
        let calendar =
            LocalCalendarRange::at(now.clone(), request.range).expect("local calendar range");

        let _before_range = trend_session(
            &store,
            calendar
                .start_utc_ms()
                .checked_sub(1)
                .expect("current range has a preceding millisecond"),
        );
        let _first_in_range = trend_session(&store, calendar.start_utc_ms());
        let _last_in_range = trend_session(
            &store,
            calendar
                .end_exclusive_utc_ms()
                .checked_sub(1)
                .expect("range has a final millisecond"),
        );
        let _after_range = trend_session(&store, calendar.end_exclusive_utc_ms());

        let mut connection = store.connection().expect("store connection");
        let trend =
            MeetingStore::trend_projection_with_connection_at(&mut connection, request, now)
                .expect("meeting trend");

        let MeetingTrendProjection::Available {
            range_total,
            all_time,
            points,
            ..
        } = trend
        else {
            panic!("opened store must have an available trend projection");
        };
        assert_eq!(range_total.meetings, 2);
        assert_eq!(all_time.meetings, 4);
        assert_eq!(points.first().map(|point| point.meetings), Some(1));
        assert_eq!(points.last().map(|point| point.meetings), Some(1));
        assert_eq!(
            points.first().map(|point| point.local_date.clone()),
            Some(calendar.start_local_date())
        );
        assert_eq!(
            points.last().map(|point| point.local_date.clone()),
            Some(calendar.end_local_date())
        );
    }

    #[test]
    fn migrations_create_encrypted_store_and_idempotent_preflight_receipt() {
        let (_directory, store) = store();
        let session_id = MeetingSessionId::new();
        let operation_id = MeetingOperationId::new();
        let receipt = store
            .create_preflight(
                StoreMutation {
                    operation_id,
                    requested_at_utc_ms: 1,
                    session_id,
                    expected_revision: 0,
                    command: MeetingCommandKind::PreflightCreate,
                },
                "Design sync".to_string(),
                MeetingOrigin::Manual,
                preflight(session_id),
                MeetingRetentionPolicy::Forever,
            )
            .unwrap();
        let duplicate_session_id = MeetingSessionId::new();
        let duplicate = store
            .create_preflight(
                StoreMutation {
                    operation_id,
                    requested_at_utc_ms: 2,
                    session_id: duplicate_session_id,
                    expected_revision: 0,
                    command: MeetingCommandKind::PreflightCreate,
                },
                "Other".to_string(),
                MeetingOrigin::Manual,
                preflight(session_id),
                MeetingRetentionPolicy::Forever,
            )
            .unwrap();
        assert_eq!(receipt, duplicate);
        assert_eq!(store.list_sessions(None, 10).unwrap().entries.len(), 1);
    }

    #[test]
    fn encrypted_track_repair_truncates_only_unauthenticated_tail() {
        let (_directory, store) = store();
        let session_id = MeetingSessionId::new();
        let operation_id = MeetingOperationId::new();
        store
            .create_preflight(
                StoreMutation {
                    operation_id,
                    requested_at_utc_ms: 1,
                    session_id,
                    expected_revision: 0,
                    command: MeetingCommandKind::PreflightCreate,
                },
                "Design sync".to_string(),
                MeetingOrigin::Manual,
                preflight(session_id),
                MeetingRetentionPolicy::Forever,
            )
            .unwrap();
        let plan = MeetingRunPlan {
            plan_id: MeetingPlanId::new(),
            session_id,
            consent_id: ConsentId::new(),
            attempt_number: 1,
            schema_version: 1,
            app_build: "test".to_string(),
            preflight_revision: 0,
            requested_sources: vec![SourceKind::Microphone],
            required_sources: vec![SourceKind::Microphone],
            accepted_known_missing_sources: Vec::new(),
            degraded_start_policy: DegradedStartPolicy::AbortIfRequiredSourceFails,
            microphone_device_uid: None,
            frozen_system_audio_application_bundle_ids: Vec::new(),
            session_clock_anchor: SessionClockAnchor {
                host_monotonic_anchor_ns: 0,
                wall_start_utc_ms: 0,
                clock_policy_version: 1,
            },
            storage: MeetingStoragePlan {
                format_version: 1,
                record_max_payload_bytes: 1024,
                checkpoint_interval_ms: 1,
                source_lane_sample_capacity: 4,
                source_lane_descriptor_capacity: 2,
            },
            language: "en".to_string(),
            asr_model_id: None,
            asr_model_version: None,
            diarization_model_id: None,
            diarization_model_version: None,
            destination: ProcessingDestination::Local,
            remote_acknowledgement: None,
            retention_policy: MeetingRetentionPolicy::Forever,
        };
        let consent = MeetingConsent {
            consent_id: plan.consent_id,
            session_id,
            attempt_number: 1,
            preflight_revision: 0,
            policy_version: 1,
            acknowledged_at_utc_ms: 0,
            microphone_acknowledged: true,
            system_audio_acknowledged: false,
            known_missing_sources_acknowledged: Vec::new(),
            degraded_start_policy: DegradedStartPolicy::AbortIfRequiredSourceFails,
            destination: ProcessingDestination::Local,
            remote_acknowledgement: None,
        };
        store
            .start_with_plan_and_consent(MeetingOperationId::new(), 1, &plan, &consent, 0)
            .unwrap();
        let track_id = SourceTrackId::new();
        store
            .create_track(TrackCreation {
                session_id,
                plan_id: plan.plan_id,
                source_kind: SourceKind::Microphone,
                required: true,
                requested: true,
                descriptor_json: "{}",
                report: SourceStartReport {
                    track_id,
                    source_kind: SourceKind::Microphone,
                    format: AudioFormat {
                        sample_rate_hz: 48_000,
                        channels: 1,
                    },
                    epoch: SourceEpoch::new(1),
                    format_epoch: 1,
                    timestamp_bridge: TimestampBridge {
                        native_anchor_value: 0,
                        native_timescale: 1_000_000_000,
                        host_monotonic_anchor_ns: 0,
                        session_offset_ns: 0,
                    },
                },
            })
            .unwrap();
        let mut writer = store
            .open_track_writer(session_id, track_id, plan.storage.clone())
            .unwrap();
        writer
            .accept(
                CapturedPacket {
                    track_id,
                    source_epoch: SourceEpoch::new(1),
                    format_epoch: 1,
                    sequence: 0,
                    native_timestamp_value: Some(0),
                    native_timestamp_timescale: Some(1_000_000_000),
                    host_monotonic_anchor_ns: Some(0),
                    sample_rate_hz: 48_000,
                    channels: 1,
                    frame_count: 2,
                    discontinuity_flags: PacketDiscontinuityFlags::default(),
                },
                &[0.1, -0.1],
            )
            .unwrap();
        writer.seal().unwrap();
        let files = store.track_files(session_id, track_id);
        let before = fs::metadata(&files.records).unwrap().len();
        OpenOptions::new()
            .append(true)
            .open(&files.records)
            .unwrap()
            .write_all(&[1, 2, 3])
            .unwrap();
        store.repair_session_tracks(session_id).unwrap();
        assert_eq!(fs::metadata(&files.records).unwrap().len(), before);
    }
    #[test]
    fn retention_policy_receipts_are_idempotent_and_reject_stale_writes() {
        let (_directory, store) = store();
        let operation_id = MeetingOperationId::new();
        let policy = MeetingRetentionPolicy::DeleteAfterDays { days: 14 };
        let (receipt, revision) = store
            .set_default_retention_policy(operation_id, 1, 0, &policy)
            .unwrap();
        assert_eq!(receipt.result, OperationResult::Committed);
        assert_eq!(revision, 1);

        let (duplicate, duplicate_revision) = store
            .set_default_retention_policy(operation_id, 2, 99, &MeetingRetentionPolicy::Forever)
            .unwrap();
        assert_eq!(duplicate, receipt);
        assert_eq!(duplicate_revision, revision);

        let stale_operation = MeetingOperationId::new();
        let (stale, actual_revision) = store
            .set_default_retention_policy(stale_operation, 3, 0, &MeetingRetentionPolicy::Forever)
            .unwrap();
        assert_eq!(stale.result, OperationResult::Rejected);
        assert_eq!(stale.reason_codes, vec![MeetingReasonCode::StaleRevision]);
        assert_eq!(actual_revision, revision);
        assert_eq!(
            store.default_retention_policy().unwrap(),
            (policy, revision)
        );
    }
    #[test]
    fn export_receipt_is_idempotent_for_an_immutable_review_revision() {
        let (_directory, store) = store();
        let session_id = MeetingSessionId::new();
        store
            .create_preflight(
                StoreMutation {
                    operation_id: MeetingOperationId::new(),
                    requested_at_utc_ms: 1,
                    session_id,
                    expected_revision: 0,
                    command: MeetingCommandKind::PreflightCreate,
                },
                "Design sync".to_string(),
                MeetingOrigin::Manual,
                preflight(session_id),
                MeetingRetentionPolicy::Forever,
            )
            .unwrap();
        store
            .transition(StoreTransition {
                operation_id: None,
                actor: OperationActor::System,
                command: MeetingCommandKind::Start,
                requested_at_utc_ms: 2,
                session_id,
                expected_revision: 0,
                allowed_from: &[MeetingPhase::Preflight],
                next_phase: MeetingPhase::Starting,
                event_kind: "test_start",
                reason_codes: Vec::new(),
            })
            .unwrap();
        store
            .transition(StoreTransition {
                operation_id: None,
                actor: OperationActor::System,
                command: MeetingCommandKind::Stop,
                requested_at_utc_ms: 3,
                session_id,
                expected_revision: 1,
                allowed_from: &[MeetingPhase::Starting],
                next_phase: MeetingPhase::ReviewReady,
                event_kind: "test_review_ready",
                reason_codes: Vec::new(),
            })
            .unwrap();

        let operation_id = MeetingOperationId::new();
        let result = store
            .record_export(operation_id, 4, session_id, 2, MeetingExportFormat::Json)
            .unwrap();
        assert_eq!(result.receipt.result, OperationResult::Committed);
        assert_eq!(result.export_receipt.snapshot_revision, 2);
        assert_eq!(
            result.export_receipt.capture_completeness,
            CaptureCompleteness::NotStarted
        );
        assert_eq!(
            store
                .record_export(
                    operation_id,
                    5,
                    session_id,
                    99,
                    MeetingExportFormat::Markdown
                )
                .unwrap(),
            result
        );
    }
    #[test]
    fn no_store_question_keeps_prompt_answer_and_citations_out_of_history() {
        let (_directory, store) = store();
        let session_id = MeetingSessionId::new();
        let revision = review_ready_session(&store, session_id);
        let answer = MeetingAnswer {
            question_id: MeetingQuestionId::new(),
            session_id,
            scope: MeetingQuestionScope::ThisMeeting,
            question: Some("What changed?".to_string()),
            state: MeetingAnswerState::InsufficientEvidence,
            answer: None,
            citations: Vec::new(),
            input_revision: revision,
            revision: 0,
            created_at_utc_ms: 3,
        };
        let receipt = store
            .record_question_answer(
                MeetingOperationId::new(),
                3,
                session_id,
                revision,
                &answer,
                false,
            )
            .expect("no-store receipt");
        assert_eq!(receipt.result, OperationResult::Committed);
        assert!(store
            .review_snapshot(session_id)
            .expect("review")
            .questions
            .is_empty());
        let connection = store.connection().expect("connection");
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM meeting_questions WHERE session_id = ?1",
                params![id(session_id)],
                |row| row.get(0),
            )
            .expect("question count");
        assert_eq!(count, 0);
    }

    #[test]
    fn correction_marks_saved_question_out_of_date_and_rejects_stale_answer() {
        let (_directory, store) = store();
        let session_id = MeetingSessionId::new();
        let revision = review_ready_session(&store, session_id);
        let stale = MeetingAnswer {
            question_id: MeetingQuestionId::new(),
            session_id,
            scope: MeetingQuestionScope::ThisMeeting,
            question: Some("Stale?".to_string()),
            state: MeetingAnswerState::InsufficientEvidence,
            answer: None,
            citations: Vec::new(),
            input_revision: revision,
            revision: 0,
            created_at_utc_ms: 3,
        };
        let stale_receipt = store
            .record_question_answer(
                MeetingOperationId::new(),
                3,
                session_id,
                revision.saturating_add(1),
                &stale,
                true,
            )
            .expect("stale receipt");
        assert_eq!(stale_receipt.result, OperationResult::Rejected);

        let answer = MeetingAnswer {
            question_id: MeetingQuestionId::new(),
            session_id,
            scope: MeetingQuestionScope::ThisMeeting,
            question: Some("Saved?".to_string()),
            state: MeetingAnswerState::Supported,
            answer: Some("A cited answer.".to_string()),
            citations: Vec::new(),
            input_revision: revision,
            revision: 0,
            created_at_utc_ms: 4,
        };
        store
            .record_question_answer(
                MeetingOperationId::new(),
                4,
                session_id,
                revision,
                &answer,
                true,
            )
            .expect("saved answer");
        let receipt = store
            .set_title(
                MeetingOperationId::new(),
                5,
                session_id,
                revision,
                "Corrected title".to_string(),
            )
            .expect("correction");
        assert_eq!(receipt.result, OperationResult::Committed);
        let questions = store.review_snapshot(session_id).expect("review").questions;
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].state, MeetingAnswerState::OutOfDate);
    }
    #[test]
    fn cloud_migration_creates_non_cascading_durable_tables() {
        let (_directory, store) = store();
        let connection = store.connection().expect("store connection");
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (
                    'meeting_cloud_state', 'meeting_cloud_capabilities', 'meeting_cloud_heads',
                    'meeting_cloud_outbox', 'meeting_cloud_outbox_chunks',
                    'meeting_cloud_conflicts', 'meeting_cloud_shares'
                 )",
                [],
                |row| row.get(0),
            )
            .expect("cloud migration tables");
        assert_eq!(count, 7);
        for table in [
            "meeting_cloud_heads",
            "meeting_cloud_outbox",
            "meeting_cloud_conflicts",
            "meeting_cloud_shares",
        ] {
            let mut statement = connection
                .prepare(&format!("PRAGMA foreign_key_list({table})"))
                .expect("foreign key query");
            let targets = statement
                .query_map([], |row| row.get::<_, String>(2))
                .expect("foreign key rows")
                .collect::<Result<Vec<_>, _>>()
                .expect("foreign key targets");
            assert!(!targets.iter().any(|target| target == "meeting_sessions"));
        }
    }

    #[test]
    fn cloud_tombstone_outbox_survives_finished_local_deletion() {
        let (_directory, store) = store();
        let session_id = MeetingSessionId::new();
        let revision = review_ready_session(&store, session_id);
        let (receipt, job_id) = store
            .reserve_deletion(
                MeetingOperationId::new(),
                10,
                session_id,
                revision,
                DeletionCause::User,
            )
            .expect("reserve deletion");
        let outbox = store
            .enqueue_cloud_outbox(CloudOutboxInput {
                kind: CloudOutboxKind::Tombstone,
                object_id: "object_123456789".to_string(),
                source_session_id: Some(session_id),
                source_revision: receipt.new_revision,
                base_remote_revision_id: Some("revision_1234567".to_string()),
                share_content_kind: None,
                remote_revision_id: None,
                idempotency_key: "delete-intent".to_string(),
                next_attempt_utc_ms: 10,
            })
            .expect("queue tombstone");
        store.finish_deletion(job_id).expect("finish deletion");
        assert!(store.session_snapshot(session_id).is_err());
        assert_eq!(
            store
                .cloud_outbox(&outbox.outbox_id)
                .expect("outbox lookup"),
            Some(outbox)
        );
    }

    #[test]
    fn cloud_claimed_outbox_preserves_immutable_intent() {
        let (_directory, store) = store();
        let session_id = MeetingSessionId::new();
        let revision = review_ready_session(&store, session_id);
        let outbox = store
            .enqueue_cloud_outbox(CloudOutboxInput {
                kind: CloudOutboxKind::Object,
                object_id: "object_123456789".to_string(),
                source_session_id: Some(session_id),
                source_revision: Some(revision),
                base_remote_revision_id: None,
                share_content_kind: None,
                remote_revision_id: None,
                idempotency_key: "object-intent".to_string(),
                next_attempt_utc_ms: 1,
            })
            .expect("queue object");
        let claimed = store
            .claim_cloud_outbox(&outbox.outbox_id, "claim-token", 1)
            .expect("claim outbox")
            .expect("claimed outbox");
        let connection = store.connection().expect("store connection");
        assert!(connection
            .execute(
                "UPDATE meeting_cloud_outbox SET object_id = 'other_1234567890' WHERE outbox_id = ?1",
                params![claimed.outbox_id],
            )
            .is_err());
        drop(connection);
        let with_upload = store
            .set_cloud_outbox_upload_id(
                &claimed.outbox_id,
                "claim-token",
                "upload_123456789".to_string(),
            )
            .expect("persist upload id");
        assert_eq!(with_upload.object_id, outbox.object_id);
        assert_eq!(with_upload.upload_id.as_deref(), Some("upload_123456789"));
    }

    #[test]
    fn cloud_restart_requeues_claimed_intent_without_mutating_it() {
        let (_directory, store) = store();
        let session_id = MeetingSessionId::new();
        let revision = review_ready_session(&store, session_id);
        let outbox = store
            .enqueue_cloud_outbox(CloudOutboxInput {
                kind: CloudOutboxKind::Object,
                object_id: "object_123456789".to_string(),
                source_session_id: Some(session_id),
                source_revision: Some(revision),
                base_remote_revision_id: None,
                share_content_kind: None,
                remote_revision_id: Some("revision_1234567".to_string()),
                idempotency_key: "restart-intent".to_string(),
                next_attempt_utc_ms: 50,
            })
            .expect("queue object");
        let claimed = store
            .claim_cloud_outbox(&outbox.outbox_id, "restart-claim", 50)
            .expect("claim object")
            .expect("claimed object");

        assert_eq!(
            store
                .recover_claimed_cloud_outbox(75)
                .expect("recover claims"),
            1
        );
        let recovered = store
            .cloud_outbox(&claimed.outbox_id)
            .expect("recovered outbox")
            .expect("outbox exists");
        assert_eq!(recovered.state, CloudOutboxState::Pending);
        assert_eq!(recovered.claim_token, None);
        assert_eq!(recovered.object_id, claimed.object_id);
        assert_eq!(recovered.remote_revision_id, claimed.remote_revision_id);
        assert_eq!(recovered.next_attempt_utc_ms, 50);
        assert_eq!(
            store
                .cloud_outboxes_for_session(session_id)
                .expect("session outboxes"),
            vec![recovered]
        );
    }
    #[test]
    fn cloud_bundle_imports_valid_review_data_and_rejects_invalid_data() {
        let (_directory, source) = store();
        let session_id = MeetingSessionId::new();
        review_ready_session(&source, session_id);
        let bundle = cloud_bundle::CloudMeetingBundleV1::export_from_store(&source, session_id)
            .expect("export bundle");
        assert!(!bundle.audio_included);
        let (_destination_directory, destination) = store();
        let imported = bundle
            .clone()
            .import_into_store(&destination)
            .expect("import bundle");
        assert_eq!(imported, session_id);
        assert_eq!(
            destination
                .session_snapshot(imported)
                .expect("imported review")
                .phase,
            MeetingPhase::ReviewReady
        );
        let mut invalid = bundle;
        invalid.audio_included = true;
        assert_eq!(
            invalid.import_into_store(&destination),
            Err(StoreError::Invalid)
        );
    }

    #[test]
    fn cloud_conflict_choice_keeps_local_or_acknowledges_installed_remote() {
        let (_directory, store) = store();
        let session_id = MeetingSessionId::new();
        let revision = review_ready_session(&store, session_id);
        let object_id = "object_123456789";
        let remote_revision_id = "revision_1234567";
        let path = store
            .cloud_conflict_staging_path(object_id)
            .expect("conflict staging path");
        fs::write(&path, b"validated remote bundle").expect("cache remote bundle");
        let conflict = CloudConflict {
            object_id: object_id.to_string(),
            source_session_id: Some(session_id),
            source_revision: Some(revision),
            remote_revision_id: remote_revision_id.to_string(),
            remote_sequence: 7,
            remote_bundle_relative_path: format!(".cloud-conflicts/{object_id}.bundle"),
        };
        store
            .cache_cloud_conflict(&conflict)
            .expect("cache conflict");
        let local = store
            .resolve_cloud_conflict_keep_local(object_id, "keep-local".to_string(), 2)
            .expect("keep local");
        assert_eq!(
            local.base_remote_revision_id.as_deref(),
            Some(remote_revision_id)
        );
        assert!(store
            .cloud_conflict(object_id)
            .expect("conflict lookup")
            .is_none());
        store
            .cache_cloud_conflict(&conflict)
            .expect("recache conflict");
        let head = store
            .resolve_cloud_conflict_use_remote(object_id, session_id)
            .expect("use remote");
        assert_eq!(
            head.acknowledged_revision_id.as_deref(),
            Some(remote_revision_id)
        );
        assert!(store
            .cloud_conflict(object_id)
            .expect("conflict lookup")
            .is_none());
    }
}
