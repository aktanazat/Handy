use crate::analytics::{DashboardTrendRange, DashboardTrendRequest, LocalCalendarRange};
use crate::context::ContextReceipt;
use crate::delivery::{DeliveryMethod, DeliveryOutcome, DeliveryReceipt};
use crate::modes::ModeReceipt;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Local, Utc};
use log::{debug, error, info};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tauri_specta::Event;

mod storage;

use storage::HistoryStorage;
pub use storage::HistoryStorageStatus;

/// Emitted after the startup unlock decides whether history is encrypted at
/// rest. The payload is [`HistoryStorageStatus`]; a listener that gets a
/// non-encrypted or locked status should surface the degraded state, and one
/// that was refused a read while locked should retry.
pub const HISTORY_STORAGE_EVENT: &str = "history-storage-changed";

/// Database migrations for transcription history.
/// Each migration is applied in order. The library tracks which migrations
/// have been applied using SQLite's user_version pragma.
///
/// Note: For users upgrading from tauri-plugin-sql, migrate_from_tauri_plugin_sql()
/// converts the old _sqlx_migrations table tracking to the user_version pragma,
/// ensuring migrations don't re-run on existing databases.
static MIGRATIONS: &[M] = &[
    M::up(
        "CREATE TABLE IF NOT EXISTS transcription_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            saved BOOLEAN NOT NULL DEFAULT 0,
            title TEXT NOT NULL,
            transcription_text TEXT NOT NULL
        );",
    ),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_processed_text TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_process_prompt TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_process_requested BOOLEAN NOT NULL DEFAULT 0;"),
    M::up(
        "CREATE VIRTUAL TABLE transcription_history_fts USING fts5(
            transcription_text,
            post_processed_text,
            content = 'transcription_history',
            content_rowid = 'id'
        );

        CREATE TRIGGER transcription_history_fts_insert
        AFTER INSERT ON transcription_history BEGIN
            INSERT INTO transcription_history_fts(
                rowid,
                transcription_text,
                post_processed_text
            ) VALUES (
                new.id,
                new.transcription_text,
                new.post_processed_text
            );
        END;

        CREATE TRIGGER transcription_history_fts_delete
        AFTER DELETE ON transcription_history BEGIN
            INSERT INTO transcription_history_fts(
                transcription_history_fts,
                rowid,
                transcription_text,
                post_processed_text
            ) VALUES (
                'delete',
                old.id,
                old.transcription_text,
                old.post_processed_text
            );
        END;

        CREATE TRIGGER transcription_history_fts_update
        AFTER UPDATE OF transcription_text, post_processed_text ON transcription_history BEGIN
            INSERT INTO transcription_history_fts(
                transcription_history_fts,
                rowid,
                transcription_text,
                post_processed_text
            ) VALUES (
                'delete',
                old.id,
                old.transcription_text,
                old.post_processed_text
            );
            INSERT INTO transcription_history_fts(
                rowid,
                transcription_text,
                post_processed_text
            ) VALUES (
                new.id,
                new.transcription_text,
                new.post_processed_text
            );
        END;

        INSERT INTO transcription_history_fts(transcription_history_fts)
        VALUES ('rebuild');",
    ),
    M::up(
        "CREATE TABLE transcription_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            history_id INTEGER NOT NULL,
            run_id INTEGER NOT NULL,
            retry_of_run_id INTEGER,
            started_at_ms INTEGER NOT NULL,
            completed_at_ms INTEGER NOT NULL,
            mode_id TEXT NOT NULL,
            mode_revision INTEGER NOT NULL,
            mode_receipt_json TEXT NOT NULL,
            context_receipt_json TEXT NOT NULL,
            delivery_method TEXT NOT NULL,
            delivery_outcome TEXT NOT NULL,
            delivery_dispatched_at_ms INTEGER NOT NULL,
            FOREIGN KEY(history_id) REFERENCES transcription_history(id)
        );
        CREATE INDEX transcription_runs_history_id ON transcription_runs(history_id, id DESC);
        CREATE TRIGGER transcription_runs_history_delete
        AFTER DELETE ON transcription_history BEGIN
            DELETE FROM transcription_runs WHERE history_id = old.id;
        END;",
    ),
    // The `UPDATE ... SET post_process_prompt = NULL` below is deliberately
    // irreversible: a stored prompt body can embed captured application
    // context, which history has no business retaining. Applied migration SQL
    // is never rewritten, so the column itself is dropped by the last
    // migration in this list instead.
    M::up(
        "ALTER TABLE transcription_history ADD COLUMN duration_ms INTEGER;
         ALTER TABLE transcription_history ADD COLUMN word_count INTEGER;
         ALTER TABLE transcription_history ADD COLUMN source_kind TEXT;
         ALTER TABLE transcription_history ADD COLUMN has_audio BOOLEAN NOT NULL DEFAULT 1;
         UPDATE transcription_history SET post_process_prompt = NULL;
         CREATE TABLE delivery_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            history_id INTEGER NOT NULL,
            run_receipt_id INTEGER NOT NULL,
            delivery_method TEXT NOT NULL,
            delivery_outcome TEXT NOT NULL,
            dispatched_at_ms INTEGER NOT NULL,
            FOREIGN KEY(history_id) REFERENCES transcription_history(id),
            FOREIGN KEY(run_receipt_id) REFERENCES transcription_runs(id)
         );
         CREATE INDEX delivery_attempts_run_receipt_id
            ON delivery_attempts(run_receipt_id, id ASC);
         CREATE TRIGGER delivery_attempts_run_delete
         AFTER DELETE ON transcription_runs BEGIN
            DELETE FROM delivery_attempts WHERE run_receipt_id = old.id;
         END;",
    ),
    M::up(
        "CREATE TABLE upstream_import_history (
            source_identity TEXT NOT NULL,
            source_history_id INTEGER NOT NULL,
            source_row_sha256 TEXT NOT NULL,
            history_id INTEGER NOT NULL,
            PRIMARY KEY (source_identity, source_history_id),
            FOREIGN KEY(history_id) REFERENCES transcription_history(id)
        );
        CREATE INDEX upstream_import_history_history_id
            ON upstream_import_history(history_id);
        CREATE TRIGGER upstream_import_history_delete
        AFTER DELETE ON transcription_history BEGIN
            DELETE FROM upstream_import_history WHERE history_id = old.id;
        END;",
    ),
    // `post_process_prompt` is dead storage. Migration 7 wiped every value, no
    // reader, trigger, index, or FTS content column names it, and nothing
    // writes it. `DROP COLUMN` needs SQLite >= 3.35; `rusqlite` is pinned with
    // the `bundled` feature (3.50.2), so the DDL exists on every platform this
    // fork ships.
    M::up("ALTER TABLE transcription_history DROP COLUMN post_process_prompt;"),
    // A capture overrun keeps a playable prefix, but it must remain visibly
    // distinct from a complete capture. Retries and imported rows stay NULL.
    M::up("ALTER TABLE transcription_runs ADD COLUMN capture_status TEXT;"),
];

const MAX_HISTORY_PAGE_SIZE: usize = 100;
const DEFAULT_HISTORY_SEARCH_PAGE_SIZE: usize = 50;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct PaginatedHistory {
    pub entries: Vec<HistoryEntry>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(tag = "action")]
pub enum HistoryUpdatePayload {
    #[serde(rename = "added")]
    Added { entry: HistoryEntry },
    #[serde(rename = "updated")]
    Updated { entry: HistoryEntry },
    #[serde(rename = "deleted")]
    Deleted { id: i64 },
    #[serde(rename = "toggled")]
    Toggled { id: i64 },
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct HistoryEntry {
    pub id: i64,
    pub file_name: String,
    pub timestamp: i64,
    pub saved: bool,
    pub title: String,
    pub transcription_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_requested: bool,
}

/// Where the captured audio originated. Existing history rows intentionally
/// retain `NULL`: inventing a source for old data would be false provenance.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum HistorySourceKind {
    Microphone,
    File,
}

impl HistorySourceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::File => "file",
        }
    }

    fn from_stored(value: Option<String>) -> Option<Self> {
        match value.as_deref() {
            Some("microphone") => Some(Self::Microphone),
            Some("file") => Some(Self::File),
            _ => None,
        }
    }
}

/// Whether the original microphone capture was complete. This belongs to the
/// capture run only; retries and imported rows have no capture status.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CaptureStatus {
    Complete,
    Truncated,
    NoSpeechDetected,
}

impl CaptureStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Truncated => "truncated",
            Self::NoSpeechDetected => "no_speech_detected",
        }
    }

    fn from_stored(value: Option<String>) -> Option<Self> {
        match value.as_deref() {
            Some("complete") => Some(Self::Complete),
            Some("truncated") => Some(Self::Truncated),
            Some("no_speech_detected") => Some(Self::NoSpeechDetected),
            _ => None,
        }
    }
}

/// One source-kind subtotal in the all-time history summary. Older rows can
/// have no source because Sona does not invent provenance during migration.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct HistoryStatsBySource {
    pub source_kind: Option<HistorySourceKind>,
    pub entries: u64,
    pub total_duration_ms: u64,
    pub total_words: u64,
}

/// Content-free, read-only aggregates over the retained history rows.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct HistoryStats {
    pub entries: u64,
    pub total_duration_ms: u64,
    pub total_words: u64,
    pub by_source: Vec<HistoryStatsBySource>,
}

/// One source subtotal in a trend point or aggregate. A `None` source kind
/// represents retained rows without recognized source provenance.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct HistoryTrendSourceTotals {
    pub source_kind: Option<HistorySourceKind>,
    pub recordings: u64,
    pub duration_ms: u64,
    pub words: u64,
}

/// Content-free aggregate for either the selected trend range or all retained
/// history.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct HistoryTrendTotals {
    pub recordings: u64,
    pub duration_ms: u64,
    pub words: u64,
    pub by_source: Vec<HistoryTrendSourceTotals>,
}

/// One local-calendar day in the history trend. Every requested date is
/// present, including dates with zero recordings.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct HistoryTrendPoint {
    pub local_date: String,
    pub recordings: u64,
    pub duration_ms: u64,
    pub words: u64,
    pub by_source: Vec<HistoryTrendSourceTotals>,
}

/// A bounded local-calendar projection over retained transcription history.
/// `active_days` and `current_streak_days` are calculated within `range`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct HistoryTrendProjection {
    pub range: DashboardTrendRange,
    pub range_start_local_date: String,
    pub range_end_local_date: String,
    pub all_time: HistoryTrendTotals,
    pub range_total: HistoryTrendTotals,
    pub active_days: u16,
    pub current_streak_days: u16,
    pub points: Vec<HistoryTrendPoint>,
}

#[derive(Clone, Copy, Default)]
struct HistoryTrendValues {
    recordings: u64,
    duration_ms: u64,
    words: u64,
}

impl HistoryTrendValues {
    fn add(&mut self, other: Self) -> Result<()> {
        self.recordings = self
            .recordings
            .checked_add(other.recordings)
            .ok_or_else(|| anyhow!("history trend recording count overflowed"))?;
        self.duration_ms = self
            .duration_ms
            .checked_add(other.duration_ms)
            .ok_or_else(|| anyhow!("history trend duration overflowed"))?;
        self.words = self
            .words
            .checked_add(other.words)
            .ok_or_else(|| anyhow!("history trend word count overflowed"))?;
        Ok(())
    }
}

const HISTORY_TREND_MICROPHONE: usize = 0;
const HISTORY_TREND_FILE: usize = 1;
const HISTORY_TREND_UNKNOWN: usize = 2;

fn history_trend_source_slot(source_kind: Option<&str>) -> Result<usize> {
    match source_kind {
        Some("microphone") => Ok(HISTORY_TREND_MICROPHONE),
        Some("file") => Ok(HISTORY_TREND_FILE),
        None => Ok(HISTORY_TREND_UNKNOWN),
        Some(_) => Err(anyhow!("history trend source kind is invalid")),
    }
}

fn history_trend_source_kind(slot: usize) -> Option<HistorySourceKind> {
    match slot {
        HISTORY_TREND_MICROPHONE => Some(HistorySourceKind::Microphone),
        HISTORY_TREND_FILE => Some(HistorySourceKind::File),
        _ => None,
    }
}

fn history_trend_totals(values: [HistoryTrendValues; 3]) -> Result<HistoryTrendTotals> {
    let mut total = HistoryTrendValues::default();
    let mut by_source = Vec::with_capacity(values.len());
    for (slot, value) in values.into_iter().enumerate() {
        total.add(value)?;
        by_source.push(HistoryTrendSourceTotals {
            source_kind: history_trend_source_kind(slot),
            recordings: value.recordings,
            duration_ms: value.duration_ms,
            words: value.words,
        });
    }
    Ok(HistoryTrendTotals {
        recordings: total.recordings,
        duration_ms: total.duration_ms,
        words: total.words,
        by_source,
    })
}

fn history_trend_value(value: i64, name: &str) -> Result<u64> {
    u64::try_from(value).map_err(|_| anyhow!("history trend {name} is negative"))
}

/// One immutable run receipt linked to a recording. Text remains only in the
/// history entry and FTS table; this table holds content-free provenance.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct HistoryRunReceipt {
    pub id: i64,
    pub history_id: i64,
    pub run_id: u64,
    pub retry_of_run_id: Option<u64>,
    pub started_at_ms: u64,
    pub completed_at_ms: u64,
    pub mode: ModeReceipt,
    pub context: ContextReceipt,
    pub duration_ms: Option<u64>,
    pub word_count: Option<u64>,
    pub source_kind: Option<HistorySourceKind>,
    pub has_audio: bool,
    pub capture_status: Option<CaptureStatus>,
    pub delivery_attempts: Vec<HistoryDeliveryAttempt>,
}

/// One immutable delivery observation associated with a persisted run. A
/// second observation is another row; no outcome is ever overwritten.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct HistoryDeliveryAttempt {
    pub id: i64,
    pub history_id: i64,
    pub run_receipt_id: i64,
    pub delivery: DeliveryReceipt,
}

/// Data persisted atomically with a new or retried transcription result.
#[derive(Clone, Debug)]
pub struct NewRunReceipt {
    pub run: ModeReceipt,
    pub context: ContextReceipt,
    pub started_at_ms: u64,
    pub completed_at_ms: u64,
    pub duration_ms: Option<u64>,
    pub word_count: Option<u64>,
    pub source_kind: HistorySourceKind,
    pub has_audio: bool,
    pub capture_status: Option<CaptureStatus>,
}
/// A validated row from the upstream SQLite database. It is deliberately
/// internal: transcript text never crosses the importer IPC boundary.
#[derive(Clone, Debug)]
pub(crate) struct UpstreamHistoryImportEntry {
    pub source_history_id: i64,
    pub source_row_sha256: String,
    pub timestamp: i64,
    pub saved: bool,
    pub title: String,
    pub transcription_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_requested: bool,
    pub duration_ms: Option<u64>,
    pub word_count: Option<u64>,
    pub source_kind: Option<HistorySourceKind>,
    pub runs: Vec<UpstreamHistoryImportRun>,
}

#[derive(Clone, Debug)]
pub(crate) struct UpstreamHistoryImportRun {
    pub source_run_receipt_id: i64,
    pub run_id: u64,
    pub retry_of_run_id: Option<u64>,
    pub started_at_ms: u64,
    pub completed_at_ms: u64,
    pub mode: ModeReceipt,
    pub context: ContextReceipt,
    pub deliveries: Vec<UpstreamHistoryImportDelivery>,
}

#[derive(Clone, Debug)]
pub(crate) struct UpstreamHistoryImportDelivery {
    pub delivery: DeliveryReceipt,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UpstreamHistoryImportOutcome {
    Inserted { history_id: i64 },
    Existing { history_id: i64 },
}
pub struct HistoryManager {
    app_handle: AppHandle,
    recordings_dir: PathBuf,
    storage: HistoryStorage,
}

impl HistoryManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        // Create recordings directory in app data dir
        let app_data_dir = crate::portable::app_data_dir(app_handle)?;
        let recordings_dir = app_data_dir.join("recordings");
        let storage = HistoryStorage::at_startup(app_data_dir.join("history.db"));

        // Ensure recordings directory exists
        if !recordings_dir.exists() {
            fs::create_dir_all(&recordings_dir)?;
            debug!("Created recordings directory: {:?}", recordings_dir);
        }

        let manager = Self {
            app_handle: app_handle.clone(),
            recordings_dir,
            storage,
        };

        // Initialize database and run migrations synchronously, unless the file
        // is encrypted and still waiting for its key. `unlock_storage` runs
        // migrations for that one, off the startup critical path.
        if manager.storage.is_ready() {
            manager.init_database()?;
        }

        Ok(manager)
    }

    /// Resolve the storage key, encrypt the database if it is still plaintext,
    /// and bring the schema to the latest migration. Called once, after the
    /// window is up, because reading the OS credential store can block behind a
    /// system prompt.
    pub async fn unlock_storage(&self, secrets: &crate::secrets::SecretManager) {
        let status = self
            .storage
            .unlock(secrets, Utc::now().timestamp_millis())
            .await;
        if let Err(error) = self.init_database() {
            error!("History database is unavailable: {error:#}");
        }
        if let Err(error) = self.app_handle.emit(HISTORY_STORAGE_EVENT, &status) {
            error!("Failed to emit {HISTORY_STORAGE_EVENT} event: {error}");
        }
    }

    /// Whether dictation history is encrypted at rest right now.
    pub fn storage_status(&self) -> HistoryStorageStatus {
        self.storage.status()
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing database at {:?}", self.storage.path());

        let mut conn = self.storage.connect()?;

        // Handle migration from tauri-plugin-sql to rusqlite_migration
        // tauri-plugin-sql used _sqlx_migrations table, rusqlite_migration uses user_version pragma
        self.migrate_from_tauri_plugin_sql(&conn)?;

        // Create migrations object and run to latest version
        let migrations = Migrations::new(MIGRATIONS.to_vec());

        // Validate migrations in debug builds without turning a malformed
        // checked-in migration into an unexplained process panic.
        #[cfg(debug_assertions)]
        migrations
            .validate()
            .map_err(|error| anyhow!("Invalid migrations: {error}"))?;

        // Get current version before migration
        let version_before: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        debug!("Database version before migration: {}", version_before);

        // Apply any pending migrations
        migrations.to_latest(&mut conn)?;

        // Get version after migration
        let version_after: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if version_after > version_before {
            info!(
                "Database migrated from version {} to {}",
                version_before, version_after
            );
        } else {
            debug!("Database already at latest version {}", version_after);
        }

        Ok(())
    }

    /// Migrate from tauri-plugin-sql's migration tracking to rusqlite_migration's.
    /// tauri-plugin-sql used a _sqlx_migrations table, while rusqlite_migration uses
    /// SQLite's user_version pragma. This function checks if the old system was in use
    /// and sets the user_version accordingly so migrations don't re-run.
    fn migrate_from_tauri_plugin_sql(&self, conn: &Connection) -> Result<()> {
        // Check if the old _sqlx_migrations table exists
        let has_sqlx_migrations: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !has_sqlx_migrations {
            return Ok(());
        }

        // Check current user_version
        let current_version: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if current_version > 0 {
            // Already migrated to rusqlite_migration system
            return Ok(());
        }

        // Get the highest version from the old migrations table
        let old_version: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations WHERE success = 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if old_version > 0 {
            info!(
                "Migrating from tauri-plugin-sql (version {}) to rusqlite_migration",
                old_version
            );

            // Set user_version to match the old migration state
            conn.pragma_update(None, "user_version", old_version)?;

            // Optionally drop the old migrations table (keeping it doesn't hurt)
            // conn.execute("DROP TABLE IF EXISTS _sqlx_migrations", [])?;

            info!(
                "Migration tracking converted: user_version set to {}",
                old_version
            );
        }

        Ok(())
    }

    fn get_connection(&self) -> Result<Connection> {
        self.storage.connect()
    }

    fn map_history_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
        Ok(HistoryEntry {
            id: row.get("id")?,
            file_name: row.get("file_name")?,
            timestamp: row.get("timestamp")?,
            saved: row.get("saved")?,
            title: row.get("title")?,
            transcription_text: row.get("transcription_text")?,
            post_processed_text: row.get("post_processed_text")?,
            post_process_requested: row.get("post_process_requested")?,
        })
    }

    pub fn recordings_dir(&self) -> &std::path::Path {
        &self.recordings_dir
    }
    /// Insert one validated upstream row through this manager's schema. It
    /// preserves source timestamps and text while letting SQLite allocate fresh
    /// IDs, fire FTS triggers, and keep receipt foreign keys local to this DB.
    pub(crate) fn import_upstream_entry(
        &self,
        source_identity: &str,
        entry: &UpstreamHistoryImportEntry,
        file_name: &str,
        has_audio: bool,
    ) -> Result<UpstreamHistoryImportOutcome> {
        let mut conn = self.get_connection()?;
        let outcome = Self::import_upstream_entry_with_connection(
            &mut conn,
            source_identity,
            entry,
            file_name,
            has_audio,
        )?;
        if let UpstreamHistoryImportOutcome::Inserted { history_id } = outcome {
            let event = HistoryEntry {
                id: history_id,
                file_name: file_name.to_string(),
                timestamp: entry.timestamp,
                saved: entry.saved,
                title: entry.title.clone(),
                transcription_text: entry.transcription_text.clone(),
                post_processed_text: entry.post_processed_text.clone(),
                post_process_requested: entry.post_process_requested,
            };
            if let Err(error) =
                (HistoryUpdatePayload::Added { entry: event }).emit(&self.app_handle)
            {
                error!("Failed to emit imported history update: {error}");
            }
        }
        Ok(outcome)
    }

    pub(crate) fn import_upstream_entry_with_connection(
        conn: &mut Connection,
        source_identity: &str,
        entry: &UpstreamHistoryImportEntry,
        file_name: &str,
        has_audio: bool,
    ) -> Result<UpstreamHistoryImportOutcome> {
        if !is_sha256_hex(source_identity) || !is_sha256_hex(&entry.source_row_sha256) {
            return Err(anyhow!("Invalid upstream import identity"));
        }
        let transaction = conn.transaction()?;
        let outcome = Self::import_upstream_entry_with_transaction(
            &transaction,
            source_identity,
            entry,
            file_name,
            has_audio,
        )?;
        transaction.commit()?;
        Ok(outcome)
    }

    fn import_upstream_entry_with_transaction(
        transaction: &rusqlite::Transaction<'_>,
        source_identity: &str,
        entry: &UpstreamHistoryImportEntry,
        file_name: &str,
        has_audio: bool,
    ) -> Result<UpstreamHistoryImportOutcome> {
        if let Some((history_id, existing_has_audio)) = transaction
            .query_row(
                "SELECT h.id, h.has_audio
                 FROM upstream_import_history AS imported
                 JOIN transcription_history AS h ON h.id = imported.history_id
                 WHERE imported.source_identity = ?1
                   AND imported.source_history_id = ?2",
                params![source_identity, entry.source_history_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, bool>(1)?)),
            )
            .optional()?
        {
            if has_audio && !existing_has_audio {
                transaction.execute(
                    "UPDATE transcription_history
                     SET file_name = ?1, has_audio = 1
                     WHERE id = ?2",
                    params![file_name, history_id],
                )?;
            }
            return Ok(UpstreamHistoryImportOutcome::Existing { history_id });
        }

        transaction.execute(
            "INSERT INTO transcription_history (
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_requested,
                duration_ms,
                word_count,
                source_kind,
                has_audio
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                file_name,
                entry.timestamp,
                entry.saved,
                &entry.title,
                &entry.transcription_text,
                &entry.post_processed_text,
                entry.post_process_requested,
                entry.duration_ms.map(as_sql_i64).transpose()?,
                entry.word_count.map(as_sql_i64).transpose()?,
                entry.source_kind.map(HistorySourceKind::as_str),
                has_audio,
            ],
        )?;
        let history_id = transaction.last_insert_rowid();
        Self::insert_upstream_run_receipts(transaction, history_id, entry)?;
        transaction.execute(
            "INSERT INTO upstream_import_history (
                source_identity,
                source_history_id,
                source_row_sha256,
                history_id
            ) VALUES (?1, ?2, ?3, ?4)",
            params![
                source_identity,
                entry.source_history_id,
                &entry.source_row_sha256,
                history_id,
            ],
        )?;
        Ok(UpstreamHistoryImportOutcome::Inserted { history_id })
    }

    fn insert_upstream_run_receipts(
        transaction: &rusqlite::Transaction<'_>,
        history_id: i64,
        entry: &UpstreamHistoryImportEntry,
    ) -> Result<()> {
        let mut imported_runs = HashMap::with_capacity(entry.runs.len());
        for run in &entry.runs {
            let mode_json = serde_json::to_string(&run.mode)?;
            let context_json = serde_json::to_string(&run.context)?;
            let legacy_method = serde_json::to_string(&DeliveryMethod::None)?;
            let legacy_outcome = serde_json::to_string(&DeliveryOutcome::DefinitelyNotDispatched)?;
            transaction.execute(
                "INSERT INTO transcription_runs (
                    history_id, run_id, retry_of_run_id, started_at_ms, completed_at_ms,
                    mode_id, mode_revision, mode_receipt_json, context_receipt_json,
                    delivery_method, delivery_outcome, delivery_dispatched_at_ms
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    history_id,
                    as_sql_i64(run.run_id)?,
                    run.retry_of_run_id.map(as_sql_i64).transpose()?,
                    as_sql_i64(run.started_at_ms)?,
                    as_sql_i64(run.completed_at_ms)?,
                    &run.mode.mode_id,
                    as_sql_i64(run.mode.settings_revision)?,
                    mode_json,
                    context_json,
                    legacy_method,
                    legacy_outcome,
                    as_sql_i64(run.completed_at_ms)?,
                ],
            )?;
            imported_runs.insert(run.source_run_receipt_id, transaction.last_insert_rowid());
        }

        for run in &entry.runs {
            let Some(run_receipt_id) = imported_runs.get(&run.source_run_receipt_id) else {
                continue;
            };
            for delivery in &run.deliveries {
                transaction.execute(
                    "INSERT INTO delivery_attempts (
                        history_id,
                        run_receipt_id,
                        delivery_method,
                        delivery_outcome,
                        dispatched_at_ms
                    ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        history_id,
                        run_receipt_id,
                        serde_json::to_string(&delivery.delivery.method)?,
                        serde_json::to_string(&delivery.delivery.outcome)?,
                        as_sql_i64(delivery.delivery.dispatched_at_ms)?,
                    ],
                )?;
            }
        }
        Ok(())
    }

    /// Saves a history entry and its immutable run receipt before any delivery
    /// side effect is attempted. Prompt bodies are intentionally never accepted
    /// by this API, so a caller cannot accidentally persist one.
    pub fn save_entry_with_receipt(
        &self,
        file_name: String,
        transcription_text: String,
        post_process_requested: bool,
        post_processed_text: Option<String>,
        receipt: Option<NewRunReceipt>,
    ) -> Result<HistoryEntry> {
        self.save_entry_with_receipt_internal(
            file_name,
            transcription_text,
            post_process_requested,
            post_processed_text,
            None,
            receipt,
        )
    }

    /// A retry creates a new immutable history row and child run receipt. The
    /// original transcription and its prior receipts remain untouched.
    pub fn save_retry_entry_with_receipt(
        &self,
        retry_of_history_id: i64,
        file_name: String,
        transcription_text: String,
        post_process_requested: bool,
        post_processed_text: Option<String>,
        receipt: NewRunReceipt,
    ) -> Result<HistoryEntry> {
        self.save_entry_with_receipt_internal(
            file_name,
            transcription_text,
            post_process_requested,
            post_processed_text,
            Some(retry_of_history_id),
            Some(receipt),
        )
    }

    fn save_entry_with_receipt_internal(
        &self,
        file_name: String,
        transcription_text: String,
        post_process_requested: bool,
        post_processed_text: Option<String>,
        retry_of_history_id: Option<i64>,
        receipt: Option<NewRunReceipt>,
    ) -> Result<HistoryEntry> {
        let timestamp = Utc::now().timestamp();
        let title = self.format_timestamp_title(timestamp);
        let mut conn = self.get_connection()?;
        let transaction = conn.transaction()?;
        let retry_of_run_id = retry_of_history_id
            .map(|history_id| Self::latest_run_id(&transaction, history_id))
            .transpose()?
            .flatten();
        let (duration_ms, word_count, source_kind, has_audio) = match receipt.as_ref() {
            Some(receipt) => (
                receipt.duration_ms.map(as_sql_i64).transpose()?,
                receipt.word_count.map(as_sql_i64).transpose()?,
                Some(receipt.source_kind.as_str()),
                receipt.has_audio,
            ),
            None => (None, None, None, true),
        };
        transaction.execute(
            "INSERT INTO transcription_history (
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_requested,
                duration_ms,
                word_count,
                source_kind,
                has_audio
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                &file_name,
                timestamp,
                false,
                &title,
                &transcription_text,
                &post_processed_text,
                post_process_requested,
                duration_ms,
                word_count,
                source_kind,
                has_audio,
            ],
        )?;
        let history_id = transaction.last_insert_rowid();
        if let Some(receipt) = receipt.as_ref() {
            Self::insert_run_receipt(&transaction, history_id, retry_of_run_id, receipt)?;
        }
        transaction.commit()?;

        let entry = HistoryEntry {
            id: history_id,
            file_name,
            timestamp,
            saved: false,
            title,
            transcription_text,
            post_processed_text,
            post_process_requested,
        };

        debug!("Saved history entry with id {}", entry.id);
        self.cleanup_old_entries()?;
        if let Err(error) = (HistoryUpdatePayload::Added {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history-updated event: {error}");
        }
        Ok(entry)
    }

    /// Appends the one result of a delivery dispatch. It looks up the exact
    /// frozen run rather than a mutable "latest status" column.
    pub fn append_delivery_attempt(
        &self,
        history_id: i64,
        run_id: u64,
        delivery: DeliveryReceipt,
    ) -> Result<HistoryDeliveryAttempt> {
        let mut conn = self.get_connection()?;
        let transaction = conn.transaction()?;
        let run_receipt_id = transaction
            .query_row(
                "SELECT id FROM transcription_runs
                 WHERE history_id = ?1 AND run_id = ?2
                 ORDER BY id DESC LIMIT 1",
                params![history_id, as_sql_i64(run_id)?],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| anyhow!("Run {} for history entry {} not found", run_id, history_id))?;
        let id =
            Self::insert_delivery_attempt(&transaction, history_id, run_receipt_id, &delivery)?;
        transaction.commit()?;
        Ok(HistoryDeliveryAttempt {
            id,
            history_id,
            run_receipt_id,
            delivery,
        })
    }

    fn latest_run_id(conn: &Connection, history_id: i64) -> Result<Option<u64>> {
        conn.query_row(
            "SELECT run_id FROM transcription_runs WHERE history_id = ?1 ORDER BY id DESC LIMIT 1",
            params![history_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .map(u64::try_from)
        .transpose()
        .map_err(|_| anyhow!("Stored run id is negative"))
    }

    fn insert_run_receipt(
        conn: &Connection,
        history_id: i64,
        retry_of_run_id: Option<u64>,
        receipt: &NewRunReceipt,
    ) -> Result<i64> {
        let mode_json = serde_json::to_string(&receipt.run)?;
        let context_json = serde_json::to_string(&receipt.context)?;
        // The first interrupted migration stored delivery columns on the run
        // row. New data uses `delivery_attempts`; these content-free sentinels
        // preserve compatibility with databases that already applied it.
        let legacy_method = serde_json::to_string(&DeliveryMethod::None)?;
        let legacy_outcome = serde_json::to_string(&DeliveryOutcome::DefinitelyNotDispatched)?;
        conn.execute(
            "INSERT INTO transcription_runs (
                history_id, run_id, retry_of_run_id, started_at_ms, completed_at_ms,
                mode_id, mode_revision, mode_receipt_json, context_receipt_json,
                delivery_method, delivery_outcome, delivery_dispatched_at_ms,
                capture_status
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                history_id,
                as_sql_i64(receipt.run.run_id)?,
                retry_of_run_id.map(as_sql_i64).transpose()?,
                as_sql_i64(receipt.started_at_ms)?,
                as_sql_i64(receipt.completed_at_ms)?,
                &receipt.run.mode_id,
                as_sql_i64(receipt.run.settings_revision)?,
                mode_json,
                context_json,
                legacy_method,
                legacy_outcome,
                as_sql_i64(receipt.completed_at_ms)?,
                receipt.capture_status.map(CaptureStatus::as_str),
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    fn insert_delivery_attempt(
        conn: &Connection,
        history_id: i64,
        run_receipt_id: i64,
        delivery: &DeliveryReceipt,
    ) -> Result<i64> {
        conn.execute(
            "INSERT INTO delivery_attempts (
                history_id, run_receipt_id, delivery_method, delivery_outcome, dispatched_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                history_id,
                run_receipt_id,
                serde_json::to_string(&delivery.method)?,
                serde_json::to_string(&delivery.outcome)?,
                as_sql_i64(delivery.dispatched_at_ms)?,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub async fn get_run_receipts(&self, history_id: i64) -> Result<Vec<HistoryRunReceipt>> {
        let conn = self.get_connection()?;
        let mut statement = conn.prepare(
            "SELECT
                r.id,
                r.history_id,
                r.run_id,
                r.retry_of_run_id,
                r.started_at_ms,
                r.completed_at_ms,
                r.mode_receipt_json,
                r.context_receipt_json,
                h.duration_ms,
                h.word_count,
                h.source_kind,
                h.has_audio,
                r.capture_status
             FROM transcription_runs AS r
             JOIN transcription_history AS h ON h.id = r.history_id
             WHERE r.history_id = ?1
             ORDER BY r.id ASC",
        )?;
        let rows = statement.query_map(params![history_id], map_run_receipt)?;
        let mut receipts = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);
        for receipt in &mut receipts {
            receipt.delivery_attempts =
                Self::get_delivery_attempts_with_connection(&conn, receipt.id)?;
        }
        Ok(receipts)
    }

    fn get_delivery_attempts_with_connection(
        conn: &Connection,
        run_receipt_id: i64,
    ) -> Result<Vec<HistoryDeliveryAttempt>> {
        let mut statement = conn.prepare(
            "SELECT id, history_id, run_receipt_id, delivery_method, delivery_outcome, dispatched_at_ms
             FROM delivery_attempts
             WHERE run_receipt_id = ?1
             ORDER BY id ASC",
        )?;
        let rows = statement.query_map(params![run_receipt_id], map_delivery_attempt)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn cleanup_old_entries(&self) -> Result<()> {
        let retention_period = crate::settings::get_recording_retention_period(&self.app_handle);

        match retention_period {
            crate::settings::RecordingRetentionPeriod::Never => {
                // Don't delete anything
                Ok(())
            }
            crate::settings::RecordingRetentionPeriod::PreserveLimit => {
                // Use the old count-based logic with history_limit
                let limit = crate::settings::get_history_limit(&self.app_handle);
                self.cleanup_by_count(limit)
            }
            _ => {
                // Use time-based logic
                self.cleanup_by_time(retention_period)
            }
        }
    }

    fn remove_recording_file(recordings_dir: &Path, file_name: &str) -> Result<()> {
        // A stored name that is not a bare file name references nothing this
        // app owns, so there is no file to delete and nothing outside the
        // recordings directory may be touched. The history row still goes.
        let Some(path) = recording_path(recordings_dir, file_name) else {
            error!("Refusing to delete recording outside the recordings directory: {file_name}");
            return Ok(());
        };
        match fs::remove_file(path) {
            Ok(()) => {
                debug!("Deleted WAV file: {}", file_name);
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(anyhow!(
                "Failed to delete WAV file {}: {}",
                file_name,
                error
            )),
        }
    }

    fn has_other_recording_reference(
        conn: &Connection,
        history_id: i64,
        file_name: &str,
    ) -> Result<bool> {
        conn.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM transcription_history
                WHERE file_name = ?1 AND id != ?2
            )",
            params![file_name, history_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
    }

    fn delete_entries_and_files_with_connection(
        conn: &Connection,
        recordings_dir: &Path,
        entries: &[(i64, String)],
    ) -> Result<usize> {
        if entries.is_empty() {
            return Ok(0);
        }

        let mut deleted_count = 0;

        for (id, file_name) in entries {
            if !Self::has_other_recording_reference(conn, *id, file_name)? {
                if let Err(error) = Self::remove_recording_file(recordings_dir, file_name) {
                    error!(
                        "Failed to delete WAV file {} for history entry {}; retaining it for retry: {}",
                        file_name, id, error
                    );
                    continue;
                }
            }

            deleted_count += conn.execute(
                "DELETE FROM transcription_history WHERE id = ?1",
                params![id],
            )?;
        }

        Ok(deleted_count)
    }

    fn delete_entries_and_files(&self, entries: &[(i64, String)]) -> Result<usize> {
        let conn = self.get_connection()?;
        Self::delete_entries_and_files_with_connection(&conn, &self.recordings_dir, entries)
    }

    fn cleanup_by_count(&self, limit: usize) -> Result<()> {
        let conn = self.get_connection()?;

        // Get all entries that are not saved, ordered by timestamp desc
        let mut stmt = conn.prepare(
            "SELECT id, file_name FROM transcription_history WHERE saved = 0 ORDER BY timestamp DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>("id")?, row.get::<_, String>("file_name")?))
        })?;

        let mut entries: Vec<(i64, String)> = Vec::new();
        for row in rows {
            entries.push(row?);
        }

        if entries.len() > limit {
            let entries_to_delete = &entries[limit..];
            let deleted_count = self.delete_entries_and_files(entries_to_delete)?;

            if deleted_count > 0 {
                debug!("Cleaned up {} old history entries by count", deleted_count);
            }
        }

        Ok(())
    }

    fn cleanup_by_time(
        &self,
        retention_period: crate::settings::RecordingRetentionPeriod,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        // Calculate cutoff timestamp (current time minus retention period)
        let now = Utc::now().timestamp();
        let cutoff_timestamp = match retention_period {
            crate::settings::RecordingRetentionPeriod::Days3 => now - (3 * 24 * 60 * 60), // 3 days in seconds
            crate::settings::RecordingRetentionPeriod::Weeks2 => now - (2 * 7 * 24 * 60 * 60), // 2 weeks in seconds
            crate::settings::RecordingRetentionPeriod::Months3 => now - (3 * 30 * 24 * 60 * 60), // 3 months in seconds (approximate)
            _ => unreachable!("Should not reach here"),
        };

        // Get all unsaved entries older than the cutoff timestamp
        let mut stmt = conn.prepare(
            "SELECT id, file_name FROM transcription_history WHERE saved = 0 AND timestamp < ?1",
        )?;

        let rows = stmt.query_map(params![cutoff_timestamp], |row| {
            Ok((row.get::<_, i64>("id")?, row.get::<_, String>("file_name")?))
        })?;

        let mut entries_to_delete: Vec<(i64, String)> = Vec::new();
        for row in rows {
            entries_to_delete.push(row?);
        }

        let deleted_count = self.delete_entries_and_files(&entries_to_delete)?;

        if deleted_count > 0 {
            debug!(
                "Cleaned up {} old history entries based on retention period",
                deleted_count
            );
        }

        Ok(())
    }

    /// Read all-time aggregates from the retained history rows. The one grouped
    /// query keeps totals and source subtotals on the same snapshot.
    pub async fn get_history_stats(&self) -> Result<HistoryStats> {
        let conn = self.get_connection()?;
        Self::get_history_stats_with_connection(&conn)
    }

    fn get_history_stats_with_connection(conn: &Connection) -> Result<HistoryStats> {
        let mut statement = conn.prepare(
            "SELECT
                source_kind,
                COUNT(*) AS entries,
                COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
                COALESCE(SUM(word_count), 0) AS total_words
             FROM transcription_history
             GROUP BY source_kind
             ORDER BY CASE source_kind
                 WHEN 'microphone' THEN 0
                 WHEN 'file' THEN 1
                 ELSE 2
             END",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, Option<String>>("source_kind")?,
                row.get::<_, i64>("entries")?,
                row.get::<_, i64>("total_duration_ms")?,
                row.get::<_, i64>("total_words")?,
            ))
        })?;

        let mut stats = HistoryStats {
            entries: 0,
            total_duration_ms: 0,
            total_words: 0,
            by_source: Vec::new(),
        };
        for row in rows {
            let (stored_source_kind, entries, duration_ms, words) = row?;
            let entries = u64::try_from(entries)
                .map_err(|_| anyhow!("history statistics contain a negative entry count"))?;
            let duration_ms = u64::try_from(duration_ms)
                .map_err(|_| anyhow!("history statistics contain a negative duration"))?;
            let words = u64::try_from(words)
                .map_err(|_| anyhow!("history statistics contain a negative word count"))?;
            stats.entries = stats.entries.saturating_add(entries);
            stats.total_duration_ms = stats.total_duration_ms.saturating_add(duration_ms);
            stats.total_words = stats.total_words.saturating_add(words);
            stats.by_source.push(HistoryStatsBySource {
                source_kind: HistorySourceKind::from_stored(stored_source_kind),
                entries,
                total_duration_ms: duration_ms,
                total_words: words,
            });
        }
        Ok(stats)
    }

    /// Return a dense, bounded local-calendar trend plus an independent
    /// all-time summary. The SQL statement is the sole database read for this
    /// projection; dense zero days and streaks are derived after its short read
    /// transaction has closed.
    pub async fn get_history_trend(
        &self,
        request: DashboardTrendRequest,
    ) -> Result<HistoryTrendProjection> {
        let mut connection = self.get_connection()?;
        Self::get_history_trend_with_connection_at(&mut connection, request, Local::now())
    }

    fn get_history_trend_with_connection_at(
        connection: &mut Connection,
        request: DashboardTrendRequest,
        now: DateTime<Local>,
    ) -> Result<HistoryTrendProjection> {
        let calendar = LocalCalendarRange::at(now, request.range)?;
        let rows = {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
            let mut statement = transaction.prepare(
                "WITH normalized_sources AS (
                    SELECT
                        timestamp,
                        CASE
                            WHEN source_kind IS NULL THEN NULL
                            WHEN source_kind = 'microphone' THEN 'microphone'
                            WHEN source_kind = 'file' THEN 'file'
                            ELSE NULL
                        END AS source_kind,
                        duration_ms,
                        word_count
                     FROM transcription_history
                 ),
                 range_days AS (
                    SELECT
                        date(timestamp, 'unixepoch', 'localtime') AS local_date,
                        source_kind,
                        COUNT(*) AS recordings,
                        COALESCE(SUM(duration_ms), 0) AS duration_ms,
                        COALESCE(SUM(word_count), 0) AS words
                     FROM normalized_sources
                     WHERE timestamp >= ?1 AND timestamp < ?2
                     GROUP BY local_date, source_kind
                 ),
                 all_time_sources AS (
                    SELECT
                        source_kind,
                        COUNT(*) AS recordings,
                        COALESCE(SUM(duration_ms), 0) AS duration_ms,
                        COALESCE(SUM(word_count), 0) AS words
                     FROM normalized_sources
                     GROUP BY source_kind
                 )
                 SELECT
                    'range_day' AS projection,
                    local_date,
                    source_kind,
                    recordings,
                    duration_ms,
                    words
                 FROM range_days
                 UNION ALL
                 SELECT
                    'all_time' AS projection,
                    NULL AS local_date,
                    source_kind,
                    recordings,
                    duration_ms,
                    words
                 FROM all_time_sources",
            )?;
            let rows = statement.query_map(
                params![
                    calendar.start_utc_seconds(),
                    calendar.end_exclusive_utc_seconds()
                ],
                |row| {
                    Ok((
                        row.get::<_, String>("projection")?,
                        row.get::<_, Option<String>>("local_date")?,
                        row.get::<_, Option<String>>("source_kind")?,
                        row.get::<_, i64>("recordings")?,
                        row.get::<_, i64>("duration_ms")?,
                        row.get::<_, i64>("words")?,
                    ))
                },
            )?;
            let collected = rows.collect::<std::result::Result<Vec<_>, _>>()?;
            drop(statement);
            transaction.commit()?;
            collected
        };

        let mut daily_values = HashMap::<String, [HistoryTrendValues; 3]>::new();
        let mut all_time_values = [HistoryTrendValues::default(); 3];
        for row in rows {
            let (projection, local_date, source_kind, recordings, duration_ms, words) = row;
            let values = HistoryTrendValues {
                recordings: history_trend_value(recordings, "recording count")?,
                duration_ms: history_trend_value(duration_ms, "duration")?,
                words: history_trend_value(words, "word count")?,
            };
            let slot = history_trend_source_slot(source_kind.as_deref())?;
            match projection.as_str() {
                "range_day" => {
                    let local_date = local_date
                        .ok_or_else(|| anyhow!("history trend range row has no local date"))?;
                    daily_values.entry(local_date).or_default()[slot].add(values)?;
                }
                "all_time" => all_time_values[slot].add(values)?,
                _ => {
                    return Err(anyhow!(
                        "history trend query returned an unknown projection"
                    ))
                }
            }
        }

        let mut range_values = [HistoryTrendValues::default(); 3];
        let mut active_days = 0_u16;
        let mut points = Vec::with_capacity(request.range.days());
        for date in calendar.local_dates()? {
            let values = daily_values
                .remove(&date.format("%F").to_string())
                .unwrap_or([HistoryTrendValues::default(); 3]);
            for (slot, value) in values.iter().copied().enumerate() {
                range_values[slot].add(value)?;
            }
            let totals = history_trend_totals(values)?;
            if totals.recordings > 0 {
                active_days = active_days
                    .checked_add(1)
                    .ok_or_else(|| anyhow!("history trend active-day count overflowed"))?;
            }
            points.push(HistoryTrendPoint {
                local_date: date.format("%F").to_string(),
                recordings: totals.recordings,
                duration_ms: totals.duration_ms,
                words: totals.words,
                by_source: totals.by_source,
            });
        }
        if !daily_values.is_empty() {
            return Err(anyhow!(
                "history trend query returned a day outside the requested local range"
            ));
        }
        let current_streak_days = u16::try_from(
            points
                .iter()
                .rev()
                .take_while(|point| point.recordings > 0)
                .count(),
        )
        .map_err(|_| anyhow!("history trend streak exceeds the supported range"))?;

        Ok(HistoryTrendProjection {
            range: request.range,
            range_start_local_date: calendar.start_local_date(),
            range_end_local_date: calendar.end_local_date(),
            all_time: history_trend_totals(all_time_values)?,
            range_total: history_trend_totals(range_values)?,
            active_days,
            current_streak_days,
            points,
        })
    }

    pub async fn get_history_entries(
        &self,
        cursor: Option<i64>,
        limit: Option<usize>,
    ) -> Result<PaginatedHistory> {
        let conn = self.get_connection()?;
        let limit = limit.map(|l| l.min(MAX_HISTORY_PAGE_SIZE));

        let mut entries: Vec<HistoryEntry> = match (cursor, limit) {
            (Some(cursor_id), Some(lim)) => {
                let fetch_count = i64::try_from(lim + 1)?;
                let mut stmt = conn.prepare(
                    "SELECT id, file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_requested
                     FROM transcription_history
                     WHERE id < ?1
                     ORDER BY id DESC
                     LIMIT ?2",
                )?;
                let result = stmt
                    .query_map(params![cursor_id, fetch_count], Self::map_history_entry)?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                result
            }
            (None, Some(lim)) => {
                let fetch_count = i64::try_from(lim + 1)?;
                let mut stmt = conn.prepare(
                    "SELECT id, file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_requested
                     FROM transcription_history
                     ORDER BY id DESC
                     LIMIT ?1",
                )?;
                let result = stmt
                    .query_map(params![fetch_count], Self::map_history_entry)?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                result
            }
            (_, None) => {
                let mut stmt = conn.prepare(
                    "SELECT id, file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_requested
                     FROM transcription_history
                     ORDER BY id DESC",
                )?;
                let result = stmt
                    .query_map([], Self::map_history_entry)?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                result
            }
        };

        let has_more = limit.is_some_and(|lim| entries.len() > lim);
        if has_more {
            entries.pop();
        }

        Ok(PaginatedHistory { entries, has_more })
    }

    /// Search transcription history by raw or post-processed text.
    ///
    /// The caller passes raw user text. `fts_match_query` turns it into a
    /// quoted FTS5 expression, so search input is always data and never query
    /// syntax. Search pages are bounded even when the caller omits a limit. The
    /// cursor is the last returned history entry id and preserves the existing
    /// newest-first pagination convention.
    pub async fn search_history_entries(
        &self,
        query: &str,
        cursor: Option<i64>,
        limit: Option<usize>,
    ) -> Result<PaginatedHistory> {
        let conn = self.get_connection()?;
        Self::search_history_entries_with_connection(&conn, query, cursor, limit)
    }

    fn search_history_entries_with_connection(
        conn: &Connection,
        query: &str,
        cursor: Option<i64>,
        limit: Option<usize>,
    ) -> Result<PaginatedHistory> {
        let Some(match_query) = fts_match_query(query) else {
            return Ok(PaginatedHistory {
                entries: Vec::new(),
                has_more: false,
            });
        };

        let limit = limit
            .unwrap_or(DEFAULT_HISTORY_SEARCH_PAGE_SIZE)
            .clamp(1, MAX_HISTORY_PAGE_SIZE);
        let fetch_count = i64::try_from(limit + 1)?;
        let mut entries: Vec<HistoryEntry> = match cursor {
            Some(cursor_id) => {
                let mut stmt = conn.prepare(
                    "SELECT
                        h.id,
                        h.file_name,
                        h.timestamp,
                        h.saved,
                        h.title,
                        h.transcription_text,
                        h.post_processed_text,
                        h.post_process_requested
                     FROM transcription_history_fts
                     JOIN transcription_history AS h
                       ON h.id = transcription_history_fts.rowid
                     WHERE transcription_history_fts MATCH ?1
                       AND h.id < ?2
                     ORDER BY h.id DESC
                     LIMIT ?3",
                )?;
                let rows = stmt.query_map(
                    params![match_query, cursor_id, fetch_count],
                    Self::map_history_entry,
                )?;
                rows.collect::<std::result::Result<Vec<_>, _>>()?
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT
                        h.id,
                        h.file_name,
                        h.timestamp,
                        h.saved,
                        h.title,
                        h.transcription_text,
                        h.post_processed_text,
                        h.post_process_requested
                     FROM transcription_history_fts
                     JOIN transcription_history AS h
                       ON h.id = transcription_history_fts.rowid
                     WHERE transcription_history_fts MATCH ?1
                     ORDER BY h.id DESC
                     LIMIT ?2",
                )?;
                let rows =
                    stmt.query_map(params![match_query, fetch_count], Self::map_history_entry)?;
                rows.collect::<std::result::Result<Vec<_>, _>>()?
            }
        };

        let has_more = entries.len() > limit;
        if has_more {
            entries.pop();
        }

        Ok(PaginatedHistory { entries, has_more })
    }

    #[cfg(test)]
    fn get_latest_entry_with_conn(conn: &Connection) -> Result<Option<HistoryEntry>> {
        let mut stmt = conn.prepare(
            "SELECT
                id,
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_requested
             FROM transcription_history
             ORDER BY timestamp DESC
             LIMIT 1",
        )?;

        let entry = stmt.query_row([], Self::map_history_entry).optional()?;
        Ok(entry)
    }

    /// Get the latest entry with non-empty transcription text.
    pub fn get_latest_completed_entry(&self) -> Result<Option<HistoryEntry>> {
        let conn = self.get_connection()?;
        Self::get_latest_completed_entry_with_conn(&conn)
    }

    fn get_latest_completed_entry_with_conn(conn: &Connection) -> Result<Option<HistoryEntry>> {
        let mut stmt = conn.prepare(
            "SELECT
                id,
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_requested
             FROM transcription_history
             WHERE transcription_text != ''
             ORDER BY timestamp DESC
             LIMIT 1",
        )?;

        let entry = stmt.query_row([], Self::map_history_entry).optional()?;
        Ok(entry)
    }

    pub async fn toggle_saved_status(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;

        // Get current saved status
        let current_saved: bool = conn.query_row(
            "SELECT saved FROM transcription_history WHERE id = ?1",
            params![id],
            |row| row.get("saved"),
        )?;

        let new_saved = !current_saved;

        conn.execute(
            "UPDATE transcription_history SET saved = ?1 WHERE id = ?2",
            params![new_saved, id],
        )?;

        debug!("Toggled saved status for entry {}: {}", id, new_saved);

        // Emit history updated event
        if let Err(e) = (HistoryUpdatePayload::Toggled { id }).emit(&self.app_handle) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    /// Resolve one recording inside this app's recordings directory. `None`
    /// means the caller supplied something other than a bare file name, which
    /// no history row can contain.
    pub fn get_audio_file_path(&self, file_name: &str) -> Option<PathBuf> {
        recording_path(&self.recordings_dir, file_name)
    }

    pub async fn get_entry_by_id(&self, id: i64) -> Result<Option<HistoryEntry>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT
                id,
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_requested
             FROM transcription_history
             WHERE id = ?1",
        )?;

        let entry = stmt.query_row([id], Self::map_history_entry).optional()?;

        Ok(entry)
    }

    pub async fn delete_entry(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;

        // Keep the database record when deleting its final WAV reference fails
        // so cleanup can retry it later. Retry rows share the original WAV and
        // therefore must not delete it while another row still references it.
        if let Some(entry) = self.get_entry_by_id(id).await? {
            if !Self::has_other_recording_reference(&conn, id, &entry.file_name)? {
                Self::remove_recording_file(&self.recordings_dir, &entry.file_name)?;
            }
        }

        conn.execute(
            "DELETE FROM transcription_history WHERE id = ?1",
            params![id],
        )?;

        debug!("Deleted history entry with id: {}", id);

        // Emit history updated event
        if let Err(e) = (HistoryUpdatePayload::Deleted { id }).emit(&self.app_handle) {
            error!("Failed to emit history-updated event: {}", e);
        }

        Ok(())
    }

    fn format_timestamp_title(&self, timestamp: i64) -> String {
        if let Some(utc_datetime) = DateTime::from_timestamp(timestamp, 0) {
            // Convert UTC to local timezone
            let local_datetime = utc_datetime.with_timezone(&Local);
            local_datetime.format("%B %e, %Y - %l:%M%p").to_string()
        } else {
            format!("Recording {}", timestamp)
        }
    }
}

/// Build one FTS5 `MATCH` expression from raw user text.
///
/// Every token is wrapped in double quotes with embedded quotes doubled, so
/// the whole search box is data and never FTS5 syntax: `note:` matches the
/// literal word instead of failing with `no such column: note`, an unbalanced
/// `"` or a trailing `AND` cannot produce `fts5: syntax error`, and `NEAR`,
/// `OR`, `*`, `^`, `(`, `)` become ordinary terms. Tokens are joined by spaces,
/// which FTS5 reads as implicit AND, so every word must appear.
///
/// A token with no alphanumeric character (`--`, `🎉`, a lone quote) is dropped:
/// the tokenizer produces no term for it, and an empty quoted phrase is itself
/// a syntax error. Each phrase carries a trailing `*` so the word the user is
/// still typing matches by prefix.
///
/// `None` means the text held nothing searchable; the caller returns an empty
/// page without touching `MATCH`.
fn fts_match_query(user_text: &str) -> Option<String> {
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

/// The single owner of the recordings-directory join.
///
/// `Path::join` silently replaces the base for an absolute argument and walks
/// out of it for a `..` component, so a name that is not exactly one file-name
/// component is refused rather than resolved. Every recording this app writes,
/// and every `file_name` a history row can hold, is a bare name.
fn recording_path(recordings_dir: &Path, file_name: &str) -> Option<PathBuf> {
    (Path::new(file_name).file_name() == Some(file_name.as_ref()))
        .then(|| recordings_dir.join(file_name))
}
fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn as_sql_i64(value: u64) -> Result<i64> {
    i64::try_from(value).map_err(|_| anyhow!("receipt timestamp or run id exceeds SQLite INTEGER"))
}

fn as_u64(value: i64, column: usize) -> rusqlite::Result<u64> {
    u64::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })
}

fn decode_receipt_json<T: serde::de::DeserializeOwned>(
    raw: String,
    column: usize,
) -> rusqlite::Result<T> {
    serde_json::from_str(&raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn map_run_receipt(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryRunReceipt> {
    Ok(HistoryRunReceipt {
        id: row.get(0)?,
        history_id: row.get(1)?,
        run_id: as_u64(row.get(2)?, 2)?,
        retry_of_run_id: row
            .get::<_, Option<i64>>(3)?
            .map(|value| as_u64(value, 3))
            .transpose()?,
        started_at_ms: as_u64(row.get(4)?, 4)?,
        completed_at_ms: as_u64(row.get(5)?, 5)?,
        mode: decode_receipt_json(row.get::<_, String>(6)?, 6)?,
        context: decode_receipt_json(row.get::<_, String>(7)?, 7)?,
        duration_ms: row
            .get::<_, Option<i64>>(8)?
            .map(|value| as_u64(value, 8))
            .transpose()?,
        word_count: row
            .get::<_, Option<i64>>(9)?
            .map(|value| as_u64(value, 9))
            .transpose()?,
        source_kind: HistorySourceKind::from_stored(row.get(10)?),
        has_audio: row.get(11)?,
        capture_status: CaptureStatus::from_stored(row.get(12)?),
        delivery_attempts: Vec::new(),
    })
}

fn map_delivery_attempt(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryDeliveryAttempt> {
    Ok(HistoryDeliveryAttempt {
        id: row.get(0)?,
        history_id: row.get(1)?,
        run_receipt_id: row.get(2)?,
        delivery: DeliveryReceipt {
            method: decode_receipt_json(row.get::<_, String>(3)?, 3)?,
            outcome: decode_receipt_json(row.get::<_, String>(4)?, 4)?,
            dispatched_at_ms: as_u64(row.get(5)?, 5)?,
        },
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};

    #[test]
    fn file_source_kind_round_trips() {
        assert_eq!(HistorySourceKind::File.as_str(), "file");
        assert_eq!(
            HistorySourceKind::from_stored(Some("file".to_string())),
            Some(HistorySourceKind::File)
        );
    }

    fn setup_conn() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        Migrations::new(MIGRATIONS.to_vec())
            .to_latest(&mut conn)
            .expect("apply history migrations");
        conn
    }

    fn insert_entry(
        conn: &Connection,
        timestamp: i64,
        text: &str,
        post_processed: Option<&str>,
    ) -> i64 {
        conn.execute(
            "INSERT INTO transcription_history (
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_requested
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                format!("sona-{}.wav", timestamp),
                timestamp,
                false,
                format!("Recording {}", timestamp),
                text,
                post_processed,
                false,
            ],
        )
        .expect("insert history entry");

        conn.last_insert_rowid()
    }

    fn insert_trend_entry(
        conn: &Connection,
        timestamp: i64,
        text: &str,
        source_kind: Option<&str>,
        duration_ms: i64,
        words: i64,
    ) -> i64 {
        let id = insert_entry(conn, timestamp, text, None);
        conn.execute(
            "UPDATE transcription_history
             SET source_kind = ?1, duration_ms = ?2, word_count = ?3
             WHERE id = ?4",
            params![source_kind, duration_ms, words, id],
        )
        .expect("seed trend entry");
        id
    }

    fn local_noon_timestamp(date: chrono::NaiveDate) -> i64 {
        date.and_hms_opt(12, 0, 0)
            .expect("local noon")
            .and_local_timezone(Local)
            .earliest()
            .expect("representable local noon")
            .timestamp()
    }

    fn new_run_receipt(run_id: u64) -> NewRunReceipt {
        NewRunReceipt {
            run: ModeReceipt {
                run_id,
                settings_revision: 1,
                mode_selection_source: crate::modes::ModeSelectionSource::ActiveMode,
                mode_id: "message".to_string(),
                tone: crate::modes::Tone::Balanced,
                requested_context_policy: crate::context::ContextPolicy::None,
                context_policy_ceiling: crate::context::ContextPolicy::None,
                context_policy: crate::context::ContextPolicy::None,
                prompt_preset: crate::modes::PromptPreset::MinimalistCleanup,
                post_process_requested: true,
                provider_id: Some("local".to_string()),
                model_id: Some("model".to_string()),
                engine_requested: crate::modes::RequestedEngine::Local,
                engine_used: Some(crate::modes::RequestedEngine::Local),
                cloud_fallback: false,
                cloud_status: crate::modes::CloudReceiptStatus::NotRequested,
                local_fallback_model_id: None,
            },
            context: ContextReceipt {
                requested_policy: crate::context::ContextPolicy::None,
                policy: crate::context::ContextPolicy::None,
                accessibility: crate::context::AccessibilityAccess::Unsupported,
                sources: crate::context::ContextSources::default(),
                captured_at_ms: 10,
            },
            started_at_ms: 10,
            completed_at_ms: 20,
            duration_ms: Some(1_000),
            word_count: Some(2),
            source_kind: HistorySourceKind::Microphone,
            has_audio: true,
            capture_status: Some(CaptureStatus::Complete),
        }
    }

    #[test]
    fn history_stats_aggregate_retained_rows_independently_of_fts_search() {
        let empty = setup_conn();
        let empty_stats =
            HistoryManager::get_history_stats_with_connection(&empty).expect("empty history stats");
        assert_eq!(empty_stats.entries, 0);
        assert_eq!(empty_stats.total_duration_ms, 0);
        assert_eq!(empty_stats.total_words, 0);
        assert!(empty_stats.by_source.is_empty());

        let conn = setup_conn();
        let microphone = insert_entry(&conn, 100, "microphone transcript", None);
        let file = insert_entry(&conn, 200, "file transcript", None);
        let legacy = insert_entry(&conn, 300, "legacy transcript", None);
        conn.execute(
            "UPDATE transcription_history
             SET duration_ms = ?1, word_count = ?2, source_kind = ?3
             WHERE id = ?4",
            params![1_200_i64, 3_i64, "microphone", microphone],
        )
        .expect("seed microphone receipt columns");
        conn.execute(
            "UPDATE transcription_history
             SET duration_ms = ?1, word_count = ?2, source_kind = ?3
             WHERE id = ?4",
            params![800_i64, 2_i64, "file", file],
        )
        .expect("seed file receipt columns");
        assert!(legacy > 0);

        let before =
            HistoryManager::get_history_stats_with_connection(&conn).expect("history stats");
        assert_eq!(before.entries, 3);
        assert_eq!(before.total_duration_ms, 2_000);
        assert_eq!(before.total_words, 5);
        assert_eq!(before.by_source.len(), 3);
        assert_eq!(
            before.by_source[0].source_kind,
            Some(HistorySourceKind::Microphone)
        );
        assert_eq!(before.by_source[0].entries, 1);
        assert_eq!(
            before.by_source[1].source_kind,
            Some(HistorySourceKind::File)
        );
        assert_eq!(before.by_source[1].total_duration_ms, 800);
        assert_eq!(before.by_source[2].source_kind, None);
        assert_eq!(before.by_source[2].total_words, 0);

        let page = HistoryManager::search_history_entries_with_connection(
            &conn,
            "microphone",
            None,
            Some(10),
        )
        .expect("FTS search");
        assert_eq!(page.entries.len(), 1);
        let after =
            HistoryManager::get_history_stats_with_connection(&conn).expect("history stats");
        assert_eq!(after.entries, before.entries);
        assert_eq!(after.total_duration_ms, before.total_duration_ms);
        assert_eq!(after.total_words, before.total_words);
    }

    #[test]
    fn history_trend_zero_fills_an_empty_requested_range() {
        let mut conn = setup_conn();
        let now = Local::now();
        for range in [
            DashboardTrendRange::Days7,
            DashboardTrendRange::Days30,
            DashboardTrendRange::Days180,
        ] {
            let request = DashboardTrendRequest { range };
            let trend = HistoryManager::get_history_trend_with_connection_at(
                &mut conn,
                request,
                now.clone(),
            )
            .expect("empty trend");

            assert_eq!(trend.points.len(), range.days());
            assert_eq!(trend.range_total.recordings, 0);
            assert_eq!(trend.range_total.duration_ms, 0);
            assert_eq!(trend.range_total.words, 0);
            assert_eq!(trend.all_time.recordings, 0);
            assert_eq!(trend.active_days, 0);
            assert_eq!(trend.current_streak_days, 0);
            assert!(trend.points.iter().all(|point| {
                point.recordings == 0
                    && point.duration_ms == 0
                    && point.words == 0
                    && point.by_source.len() == 3
                    && point.by_source.iter().all(|source| {
                        source.recordings == 0 && source.duration_ms == 0 && source.words == 0
                    })
            }));
        }
    }

    #[test]
    fn history_trend_groups_unrecognized_stored_source_kinds_as_unknown() {
        let mut conn = setup_conn();
        let now = Local::now();
        let request = DashboardTrendRequest {
            range: DashboardTrendRange::Days7,
        };
        let calendar =
            LocalCalendarRange::at(now.clone(), request.range).expect("local calendar range");
        let date = calendar.local_dates().expect("local dates")[0];
        insert_trend_entry(
            &conn,
            local_noon_timestamp(date),
            "unknown-source recording",
            Some("unsupported"),
            1,
            1,
        );

        let trend = HistoryManager::get_history_trend_with_connection_at(&mut conn, request, now)
            .expect("history trend");
        assert_eq!(trend.range_total.recordings, 1);
        assert_eq!(trend.range_total.by_source[2].source_kind, None);
        assert_eq!(trend.range_total.by_source[2].recordings, 1);
        assert_eq!(trend.range_total.by_source[2].duration_ms, 1);
        assert_eq!(trend.range_total.by_source[2].words, 1);
        assert_eq!(trend.all_time, trend.range_total);
        assert_eq!(trend.points[0].by_source[2].recordings, 1);
    }

    #[test]
    fn history_trend_has_dense_days_and_separate_range_source_totals() {
        let mut conn = setup_conn();
        let now = Local::now();
        let request = DashboardTrendRequest {
            range: DashboardTrendRange::Days7,
        };
        let calendar =
            LocalCalendarRange::at(now.clone(), request.range).expect("local calendar range");
        let dates = calendar.local_dates().expect("requested local dates");

        insert_trend_entry(
            &conn,
            local_noon_timestamp(dates[0]),
            "microphone recording",
            Some("microphone"),
            1_200,
            3,
        );
        insert_trend_entry(
            &conn,
            local_noon_timestamp(dates[2]),
            "file recording",
            Some("file"),
            800,
            2,
        );
        insert_trend_entry(
            &conn,
            local_noon_timestamp(dates[4]),
            "legacy recording",
            None,
            400,
            1,
        );
        insert_trend_entry(
            &conn,
            local_noon_timestamp(dates[6]),
            "latest microphone recording",
            Some("microphone"),
            200,
            1,
        );
        insert_trend_entry(
            &conn,
            calendar.end_exclusive_utc_seconds(),
            "outside the selected range",
            Some("file"),
            5_000,
            7,
        );

        let trend = HistoryManager::get_history_trend_with_connection_at(&mut conn, request, now)
            .expect("history trend");

        assert_eq!(trend.points.len(), 7);
        assert_eq!(
            trend.points[1].local_date,
            dates[1].format("%F").to_string()
        );
        assert_eq!(trend.points[1].recordings, 0);
        assert_eq!(trend.points[1].by_source.len(), 3);
        assert_eq!(
            trend.points[1].by_source[0].source_kind,
            Some(HistorySourceKind::Microphone)
        );
        assert_eq!(
            trend.points[1].by_source[1].source_kind,
            Some(HistorySourceKind::File)
        );
        assert_eq!(trend.points[1].by_source[2].source_kind, None);
        assert!(trend.points[1]
            .by_source
            .iter()
            .all(|source| source.recordings == 0));
        assert_eq!(trend.range_total.recordings, 4);
        assert_eq!(trend.range_total.duration_ms, 2_600);
        assert_eq!(trend.range_total.words, 7);
        assert_eq!(trend.range_total.by_source[0].recordings, 2);
        assert_eq!(trend.range_total.by_source[0].duration_ms, 1_400);
        assert_eq!(trend.range_total.by_source[1].recordings, 1);
        assert_eq!(trend.range_total.by_source[1].duration_ms, 800);
        assert_eq!(trend.range_total.by_source[2].recordings, 1);
        assert_eq!(trend.range_total.by_source[2].duration_ms, 400);
        assert_eq!(trend.all_time.recordings, 5);
        assert_eq!(trend.all_time.duration_ms, 7_600);
        assert_eq!(trend.all_time.words, 14);
        assert_eq!(trend.active_days, 4);
        assert_eq!(trend.current_streak_days, 1);
    }

    #[test]
    fn history_trend_uses_local_calendar_boundaries() {
        let mut conn = setup_conn();
        let now = Local::now();
        let request = DashboardTrendRequest {
            range: DashboardTrendRange::Days7,
        };
        let calendar =
            LocalCalendarRange::at(now.clone(), request.range).expect("local calendar range");

        insert_trend_entry(
            &conn,
            calendar.start_utc_seconds() - 1,
            "before local range",
            Some("microphone"),
            1,
            1,
        );
        insert_trend_entry(
            &conn,
            calendar.start_utc_seconds(),
            "first local day",
            Some("microphone"),
            1,
            1,
        );
        insert_trend_entry(
            &conn,
            calendar.end_exclusive_utc_seconds() - 1,
            "last local day",
            Some("file"),
            1,
            1,
        );
        insert_trend_entry(
            &conn,
            calendar.end_exclusive_utc_seconds(),
            "after local range",
            Some("file"),
            1,
            1,
        );

        let trend = HistoryManager::get_history_trend_with_connection_at(&mut conn, request, now)
            .expect("boundary trend");

        assert_eq!(trend.range_total.recordings, 2);
        assert_eq!(trend.all_time.recordings, 4);
        assert_eq!(trend.points.first().map(|point| point.recordings), Some(1));
        assert_eq!(trend.points.last().map(|point| point.recordings), Some(1));
        assert_eq!(trend.current_streak_days, 1);
    }

    #[test]
    fn history_trend_ignores_history_search_filters() {
        let mut conn = setup_conn();
        let now = Local::now();
        let request = DashboardTrendRequest {
            range: DashboardTrendRange::Days7,
        };
        let calendar =
            LocalCalendarRange::at(now.clone(), request.range).expect("local calendar range");
        let dates = calendar.local_dates().expect("requested local dates");
        insert_trend_entry(
            &conn,
            local_noon_timestamp(dates[1]),
            "visible to this search",
            Some("microphone"),
            100,
            1,
        );
        insert_trend_entry(
            &conn,
            local_noon_timestamp(dates[3]),
            "not in the query",
            Some("file"),
            200,
            2,
        );

        let search = HistoryManager::search_history_entries_with_connection(
            &conn,
            "visible",
            None,
            Some(10),
        )
        .expect("filtered history search");
        assert_eq!(search.entries.len(), 1);

        let trend = HistoryManager::get_history_trend_with_connection_at(&mut conn, request, now)
            .expect("unfiltered trend");
        assert_eq!(trend.range_total.recordings, 2);
        assert_eq!(trend.range_total.duration_ms, 300);
        assert_eq!(trend.range_total.words, 3);
    }

    #[test]
    fn truncated_capture_persists_audio_receipt_without_transcript_or_delivery() {
        let conn = setup_conn();
        let history_id = insert_entry(&conn, 100, "", None);
        let mut receipt = new_run_receipt(73);
        receipt.word_count = Some(0);
        receipt.capture_status = Some(CaptureStatus::Truncated);

        let run_receipt_id = HistoryManager::insert_run_receipt(&conn, history_id, None, &receipt)
            .expect("persist truncated capture receipt");
        HistoryManager::insert_delivery_attempt(
            &conn,
            history_id,
            run_receipt_id,
            &DeliveryReceipt::not_dispatched(),
        )
        .expect("persist no-delivery receipt");

        let (text, has_audio, status, method, outcome): (
            String,
            bool,
            Option<String>,
            String,
            String,
        ) = conn
            .query_row(
                "SELECT h.transcription_text, h.has_audio, r.capture_status,
                        d.delivery_method, d.delivery_outcome
                 FROM transcription_history AS h
                 JOIN transcription_runs AS r ON r.history_id = h.id
                 JOIN delivery_attempts AS d ON d.run_receipt_id = r.id
                 WHERE h.id = ?1",
                params![history_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("load truncated capture");

        assert_eq!(text, "");
        assert!(has_audio);
        assert_eq!(status.as_deref(), Some("truncated"));
        assert_eq!(
            serde_json::from_str::<DeliveryMethod>(&method).expect("delivery method"),
            DeliveryMethod::None
        );
        assert_eq!(
            serde_json::from_str::<DeliveryOutcome>(&outcome).expect("delivery outcome"),
            DeliveryOutcome::DefinitelyNotDispatched
        );
    }

    #[test]
    fn cloud_receipt_divergence_round_trips_without_collapsing_requested_and_used_engines() {
        let conn = setup_conn();
        let history_id = insert_entry(&conn, 100, "provider preview", None);

        let mut fallback = new_run_receipt(41);
        fallback.run.engine_requested = crate::modes::RequestedEngine::DeepgramNova3;
        fallback.run.engine_used = Some(crate::modes::RequestedEngine::Local);
        fallback.run.cloud_fallback = true;
        fallback.run.cloud_status = crate::modes::CloudReceiptStatus::Fallback;
        fallback.run.local_fallback_model_id = Some("frozen-fallback".to_string());
        HistoryManager::insert_run_receipt(&conn, history_id, None, &fallback)
            .expect("persist fallback receipt");

        let mut held = new_run_receipt(42);
        held.run.engine_requested = crate::modes::RequestedEngine::DeepgramNova3;
        held.run.engine_used = None;
        held.run.cloud_fallback = false;
        held.run.cloud_status = crate::modes::CloudReceiptStatus::HeldCloudUnavailable;
        HistoryManager::insert_run_receipt(&conn, history_id, Some(41), &held)
            .expect("persist held receipt");

        let mut statement = conn
            .prepare("SELECT mode_receipt_json FROM transcription_runs ORDER BY id ASC")
            .expect("receipt query");
        let receipts = statement
            .query_map([], |row| {
                let receipt: ModeReceipt = serde_json::from_str(&row.get::<_, String>(0)?)
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            0,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                Ok(receipt)
            })
            .expect("map receipts")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("read receipts");

        assert_eq!(receipts.len(), 2);
        assert_eq!(
            receipts[0].engine_requested,
            crate::modes::RequestedEngine::DeepgramNova3
        );
        assert_eq!(
            receipts[0].engine_used,
            Some(crate::modes::RequestedEngine::Local)
        );
        assert!(receipts[0].cloud_fallback);
        assert_eq!(
            receipts[0].cloud_status,
            crate::modes::CloudReceiptStatus::Fallback
        );
        assert_eq!(
            receipts[0].local_fallback_model_id.as_deref(),
            Some("frozen-fallback")
        );
        assert_eq!(
            receipts[1].engine_requested,
            crate::modes::RequestedEngine::DeepgramNova3
        );
        assert_eq!(receipts[1].engine_used, None);
        assert!(!receipts[1].cloud_fallback);
        assert_eq!(
            receipts[1].cloud_status,
            crate::modes::CloudReceiptStatus::HeldCloudUnavailable
        );
    }

    fn history_columns(conn: &Connection) -> Vec<String> {
        let mut statement = conn
            .prepare("SELECT name FROM pragma_table_info('transcription_history')")
            .expect("prepare table info");
        let columns = statement
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query table info")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("read table info");
        columns
    }

    #[test]
    fn legacy_prompt_column_is_dropped_without_touching_text_or_receipt_columns() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        Migrations::new(MIGRATIONS[..6].to_vec())
            .to_latest(&mut conn)
            .expect("apply migrations before receipt hardening");
        let entry_id = insert_entry(&conn, 100, "keep raw text", Some("keep processed text"));
        conn.execute(
            "UPDATE transcription_history SET post_process_prompt = ?1 WHERE id = ?2",
            params!["private system prompt", entry_id],
        )
        .expect("seed legacy prompt body");

        Migrations::new(MIGRATIONS.to_vec())
            .to_latest(&mut conn)
            .expect("apply receipt hardening and column removal migrations");

        assert!(!history_columns(&conn).contains(&"post_process_prompt".to_string()));
        let row = conn
            .query_row(
                "SELECT transcription_text, post_processed_text,
                        duration_ms, word_count, source_kind, has_audio
                 FROM transcription_history WHERE id = ?1",
                params![entry_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, bool>(5)?,
                    ))
                },
            )
            .expect("read migrated history row");
        assert_eq!(row.0, "keep raw text");
        assert_eq!(row.1.as_deref(), Some("keep processed text"));
        assert_eq!((row.2, row.3, row.4), (None, None, None));
        assert!(row.5);

        let page =
            HistoryManager::search_history_entries_with_connection(&conn, "raw", None, Some(5))
                .expect("search after column removal");
        assert_eq!(
            page.entries
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            vec![entry_id]
        );
    }

    /// Insert using only the columns the first migration creates, so one helper
    /// works against every historical schema version.
    fn insert_base_entry(conn: &Connection, timestamp: i64, text: &str) -> i64 {
        conn.execute(
            "INSERT INTO transcription_history (
                file_name,
                timestamp,
                saved,
                title,
                transcription_text
            ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                format!("sona-{}.wav", timestamp),
                timestamp,
                false,
                format!("Recording {}", timestamp),
                text,
            ],
        )
        .expect("insert base history entry");

        conn.last_insert_rowid()
    }

    #[test]
    fn every_prior_schema_version_migrates_to_the_current_head() {
        for applied in 0..=MIGRATIONS.len() {
            let mut conn = Connection::open_in_memory().expect("open in-memory db");
            // `applied == 0` is a database this app has never touched; there is
            // no prefix to apply and no row to carry.
            if applied > 0 {
                Migrations::new(MIGRATIONS[..applied].to_vec())
                    .to_latest(&mut conn)
                    .unwrap_or_else(|error| panic!("apply first {applied} migrations: {error}"));
                insert_base_entry(&conn, 100, "carried across migrations");
            }

            Migrations::new(MIGRATIONS.to_vec())
                .to_latest(&mut conn)
                .unwrap_or_else(|error| panic!("migrate from version {applied}: {error}"));

            let version: i32 = conn
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .expect("read user_version");
            assert_eq!(version as usize, MIGRATIONS.len());
            assert!(!history_columns(&conn).contains(&"post_process_prompt".to_string()));

            let carried = HistoryManager::get_latest_completed_entry_with_conn(&conn)
                .expect("read carried entry");
            if applied > 0 {
                let carried = carried.expect("entry survives migration");
                assert_eq!(carried.transcription_text, "carried across migrations");
                let page = HistoryManager::search_history_entries_with_connection(
                    &conn,
                    "carried",
                    None,
                    Some(5),
                )
                .expect("search carried entry");
                assert_eq!(page.entries.len(), 1);
            } else {
                assert!(carried.is_none());
            }
        }
    }

    #[test]
    fn retries_append_immutable_run_and_delivery_records() {
        let mut conn = setup_conn();
        let history_id = insert_entry(&conn, 100, "original raw text", Some("original output"));
        let first = new_run_receipt(1);
        let second = new_run_receipt(2);
        let transaction = conn.transaction().expect("begin receipt transaction");
        let first_id = HistoryManager::insert_run_receipt(&transaction, history_id, None, &first)
            .expect("insert initial run");
        let second_id =
            HistoryManager::insert_run_receipt(&transaction, history_id, Some(1), &second)
                .expect("append retry run");
        HistoryManager::insert_delivery_attempt(
            &transaction,
            history_id,
            second_id,
            &DeliveryReceipt {
                method: DeliveryMethod::ClipboardPaste,
                outcome: DeliveryOutcome::DispatchedButUnconfirmed,
                dispatched_at_ms: 30,
            },
        )
        .expect("append delivery observation");
        transaction.commit().expect("commit receipt transaction");

        assert_ne!(first_id, second_id);
        assert_eq!(
            conn.query_row(
                "SELECT transcription_text FROM transcription_history WHERE id = ?1",
                params![history_id],
                |row| row.get::<_, String>(0),
            )
            .expect("read immutable original text"),
            "original raw text"
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM transcription_runs WHERE history_id = ?1",
                params![history_id],
                |row| row.get::<_, i64>(0),
            )
            .expect("count appended runs"),
            2
        );
        let attempts = HistoryManager::get_delivery_attempts_with_connection(&conn, second_id)
            .expect("read delivery attempts");
        assert_eq!(attempts.len(), 1);
        assert_eq!(
            attempts[0].delivery.outcome,
            DeliveryOutcome::DispatchedButUnconfirmed
        );

        let receipts = conn
            .query_row(
                "SELECT mode_receipt_json, context_receipt_json
                 FROM transcription_runs WHERE id = ?1",
                params![second_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .expect("read content-free receipts");
        assert!(!receipts.0.contains("private system prompt"));
        assert!(!receipts.1.contains("original raw text"));
        assert!(!receipts.1.contains("original output"));
    }

    #[test]
    fn get_latest_entry_returns_none_when_empty() {
        let conn = setup_conn();
        let entry = HistoryManager::get_latest_entry_with_conn(&conn).expect("fetch latest entry");
        assert!(entry.is_none());
    }

    #[test]
    fn get_latest_entry_returns_newest_entry() {
        let conn = setup_conn();
        insert_entry(&conn, 100, "first", None);
        insert_entry(&conn, 200, "second", Some("processed"));

        let entry = HistoryManager::get_latest_entry_with_conn(&conn)
            .expect("fetch latest entry")
            .expect("entry exists");

        assert_eq!(entry.timestamp, 200);
        assert_eq!(entry.transcription_text, "second");
        assert_eq!(entry.post_processed_text.as_deref(), Some("processed"));
    }

    #[test]
    fn get_latest_completed_entry_skips_empty_entries() {
        let conn = setup_conn();
        insert_entry(&conn, 100, "completed", None);
        insert_entry(&conn, 200, "", None);

        let entry = HistoryManager::get_latest_completed_entry_with_conn(&conn)
            .expect("fetch latest completed entry")
            .expect("completed entry exists");

        assert_eq!(entry.timestamp, 100);
        assert_eq!(entry.transcription_text, "completed");
    }

    #[test]
    fn search_history_entries_matches_raw_and_post_processed_text_with_pagination() {
        let conn = setup_conn();
        let raw_id = insert_entry(&conn, 100, "project lantern notes", None);
        let post_processed_id = insert_entry(
            &conn,
            200,
            "unrelated draft",
            Some("polished lantern summary"),
        );
        let latest_raw_id = insert_entry(&conn, 300, "lantern action items", None);

        let first_page =
            HistoryManager::search_history_entries_with_connection(&conn, "lantern", None, Some(2))
                .expect("search first page");

        assert_eq!(
            first_page
                .entries
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            vec![latest_raw_id, post_processed_id]
        );
        assert!(first_page.has_more);

        let second_page = HistoryManager::search_history_entries_with_connection(
            &conn,
            "lantern",
            first_page.entries.last().map(|entry| entry.id),
            Some(2),
        )
        .expect("search second page");

        assert_eq!(
            second_page
                .entries
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            vec![raw_id]
        );
        assert!(!second_page.has_more);

        let post_processed_only = HistoryManager::search_history_entries_with_connection(
            &conn,
            "polished",
            None,
            Some(2),
        )
        .expect("search post-processed text");
        assert_eq!(post_processed_only.entries[0].id, post_processed_id);
    }

    #[test]
    fn fts_match_query_quotes_tokens_and_drops_untokenizable_ones() {
        assert_eq!(fts_match_query("note:").as_deref(), Some("\"note:\"*"));
        assert_eq!(
            fts_match_query("  lantern   notes ").as_deref(),
            Some("\"lantern\"* \"notes\"*")
        );
        assert_eq!(
            fts_match_query("lantern AND").as_deref(),
            Some("\"lantern\"* \"AND\"*")
        );
        assert_eq!(
            fts_match_query("say \"hi").as_deref(),
            Some("\"say\"* \"\"\"hi\"*")
        );
        assert_eq!(
            fts_match_query("say \"hi\"").as_deref(),
            Some("\"say\"* \"\"\"hi\"\"\"*")
        );
        assert_eq!(fts_match_query(""), None);
        assert_eq!(fts_match_query("   \t\n "), None);
        assert_eq!(fts_match_query("🎉 🙃"), None);
        assert_eq!(fts_match_query("-- ,"), None);
        assert_eq!(
            fts_match_query("🎉 lantern").as_deref(),
            Some("\"lantern\"*")
        );
    }

    #[test]
    fn search_treats_fts_operators_and_quotes_as_literal_text() {
        let conn = setup_conn();
        let colon_id = insert_entry(&conn, 100, "note: remember the lantern", None);
        let operator_id = insert_entry(&conn, 200, "lantern AND torch inventory", None);
        let quoted_id = insert_entry(&conn, 300, "she said \"hi\" twice", None);
        insert_entry(&conn, 400, "unrelated draft", None);

        // Each of these was an error dialog before the query was quoted:
        // `no such column: note`, `fts5: syntax error near "AND"`, and an
        // unterminated string.
        for (query, expected) in [
            ("note:", vec![colon_id]),
            ("note: remember", vec![colon_id]),
            ("lantern AND", vec![operator_id]),
            ("NEAR(lantern torch", vec![]),
            ("said \"hi", vec![quoted_id]),
            ("\"hi\"", vec![quoted_id]),
            ("^lantern*", vec![operator_id, colon_id]),
            ("(inventory)", vec![operator_id]),
            ("\" OR transcription_text MATCH \"lantern", vec![]),
            ("lantern' OR 1=1 --", vec![]),
        ] {
            let page =
                HistoryManager::search_history_entries_with_connection(&conn, query, None, Some(5))
                    .unwrap_or_else(|error| panic!("search {query:?} must not fail: {error}"));
            assert_eq!(
                page.entries
                    .iter()
                    .map(|entry| entry.id)
                    .collect::<Vec<_>>(),
                expected,
                "unexpected rows for {query:?}"
            );
        }
    }

    #[test]
    fn search_matches_word_prefixes_and_requires_every_token() {
        let conn = setup_conn();
        let entry_id = insert_entry(&conn, 100, "project lantern notes", None);

        for query in ["lant", "lantern not", "notes lant"] {
            let page =
                HistoryManager::search_history_entries_with_connection(&conn, query, None, Some(5))
                    .unwrap_or_else(|error| panic!("search {query:?}: {error}"));
            assert_eq!(
                page.entries
                    .iter()
                    .map(|entry| entry.id)
                    .collect::<Vec<_>>(),
                vec![entry_id],
                "unexpected rows for {query:?}"
            );
        }

        let missing_token = HistoryManager::search_history_entries_with_connection(
            &conn,
            "lantern zebra",
            None,
            Some(5),
        )
        .expect("search with one absent token");
        assert!(missing_token.entries.is_empty());
    }

    #[test]
    fn search_without_a_searchable_token_never_reaches_match() {
        let conn = setup_conn();
        insert_entry(&conn, 100, "project lantern notes", None);
        // Removing the index makes any MATCH fail, so an empty page here proves
        // the untokenizable query was answered without touching FTS at all.
        conn.execute("DROP TABLE transcription_history_fts", [])
            .expect("drop search index");

        for query in ["", "   ", "🎉", "--"] {
            let page =
                HistoryManager::search_history_entries_with_connection(&conn, query, None, Some(5))
                    .unwrap_or_else(|error| panic!("search {query:?} must not query FTS: {error}"));
            assert!(page.entries.is_empty());
            assert!(!page.has_more);
        }

        assert!(
            HistoryManager::search_history_entries_with_connection(&conn, "lantern", None, Some(5))
                .is_err(),
            "a real token must still reach the (now missing) index"
        );
    }

    #[test]
    fn recording_path_accepts_only_bare_file_names() {
        let recordings_dir = Path::new("/sona/recordings");

        assert_eq!(
            recording_path(recordings_dir, "sona-100.wav"),
            Some(recordings_dir.join("sona-100.wav"))
        );
        assert_eq!(
            recording_path(recordings_dir, "meeting notes.mp3"),
            Some(recordings_dir.join("meeting notes.mp3"))
        );
        for escape in [
            "",
            ".",
            "..",
            "../sona-100.wav",
            "../../etc/passwd",
            "nested/sona-100.wav",
            "/etc/passwd",
            "/sona/recordings/sona-100.wav",
        ] {
            assert_eq!(
                recording_path(recordings_dir, escape),
                None,
                "{escape:?} must not resolve"
            );
        }
    }

    #[test]
    fn search_history_entries_caps_page_size() {
        let conn = setup_conn();
        for timestamp in std::iter::successors(Some(0_i64), |timestamp| timestamp.checked_add(1))
            .take(MAX_HISTORY_PAGE_SIZE + 1)
        {
            insert_entry(&conn, timestamp, "bounded search", None);
        }

        let page = HistoryManager::search_history_entries_with_connection(
            &conn,
            "bounded",
            None,
            Some(MAX_HISTORY_PAGE_SIZE + 1),
        )
        .expect("search bounded page");

        assert_eq!(page.entries.len(), MAX_HISTORY_PAGE_SIZE);
        assert!(page.has_more);
    }

    #[test]
    fn fts_migration_indexes_existing_history_entries() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        Migrations::new(MIGRATIONS[..4].to_vec())
            .to_latest(&mut conn)
            .expect("apply pre-search migrations");
        let entry_id = insert_entry(&conn, 100, "legacy indexed text", None);

        Migrations::new(MIGRATIONS.to_vec())
            .to_latest(&mut conn)
            .expect("apply search migration");

        let page =
            HistoryManager::search_history_entries_with_connection(&conn, "legacy", None, Some(1))
                .expect("search migrated entry");

        assert_eq!(page.entries[0].id, entry_id);
    }

    #[test]
    fn search_index_tracks_transcription_updates() {
        let conn = setup_conn();
        let entry_id = insert_entry(&conn, 100, "original recording", None);
        conn.execute(
            "UPDATE transcription_history
             SET transcription_text = ?1, post_processed_text = ?2
             WHERE id = ?3",
            params!["updated recording", "revised summary", entry_id],
        )
        .expect("update history entry");

        let page =
            HistoryManager::search_history_entries_with_connection(&conn, "revised", None, Some(1))
                .expect("search updated post-processed text");
        assert_eq!(page.entries[0].id, entry_id);

        let stale = HistoryManager::search_history_entries_with_connection(
            &conn,
            "original",
            None,
            Some(1),
        )
        .expect("search stale transcription text");
        assert!(stale.entries.is_empty());
    }

    #[test]
    fn failed_wav_deletion_keeps_history_entry_for_retry() {
        let conn = setup_conn();
        let entry_id = insert_entry(&conn, 100, "keep this entry", None);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("current time")
            .as_nanos();
        let recordings_dir = std::env::temp_dir().join(format!(
            "sona-history-delete-test-{}-{}",
            std::process::id(),
            timestamp
        ));
        std::fs::create_dir_all(&recordings_dir).expect("create recordings directory");

        let file_name = "sona-100.wav".to_string();
        std::fs::create_dir(recordings_dir.join(&file_name))
            .expect("create undeletable WAV substitute");
        let entries = vec![(entry_id, file_name.clone())];

        let deleted = HistoryManager::delete_entries_and_files_with_connection(
            &conn,
            &recordings_dir,
            &entries,
        )
        .expect("attempt cleanup");
        assert_eq!(deleted, 0);
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM transcription_history WHERE id = ?1",
                params![entry_id],
                |row| row.get::<_, i64>(0),
            )
            .expect("count retained history entry"),
            1
        );

        std::fs::remove_dir(recordings_dir.join(&file_name)).expect("remove WAV substitute");
        let deleted = HistoryManager::delete_entries_and_files_with_connection(
            &conn,
            &recordings_dir,
            &entries,
        )
        .expect("retry cleanup");
        assert_eq!(deleted, 1);
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM transcription_history WHERE id = ?1",
                params![entry_id],
                |row| row.get::<_, i64>(0),
            )
            .expect("count deleted history entry"),
            0
        );

        std::fs::remove_dir_all(recordings_dir).expect("remove recordings directory");
    }
    #[test]
    fn shared_retry_audio_is_deleted_only_after_the_last_history_row() {
        let conn = setup_conn();
        let original_id = insert_entry(&conn, 100, "original", None);
        let retry_id = insert_entry(&conn, 200, "retry", None);
        let file_name = "sona-shared.wav";
        conn.execute(
            "UPDATE transcription_history SET file_name = ?1 WHERE id IN (?2, ?3)",
            params![file_name, original_id, retry_id],
        )
        .expect("make retry rows share one recording");

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("current time")
            .as_nanos();
        let recordings_dir = std::env::temp_dir().join(format!(
            "sona-history-shared-audio-test-{}-{}",
            std::process::id(),
            timestamp
        ));
        std::fs::create_dir_all(&recordings_dir).expect("create recordings directory");
        let wav_path = recordings_dir.join(file_name);
        std::fs::write(&wav_path, b"wav").expect("create shared recording");

        let deleted = HistoryManager::delete_entries_and_files_with_connection(
            &conn,
            &recordings_dir,
            &[(original_id, file_name.to_string())],
        )
        .expect("delete original history row");
        assert_eq!(deleted, 1);
        assert!(wav_path.exists());

        let deleted = HistoryManager::delete_entries_and_files_with_connection(
            &conn,
            &recordings_dir,
            &[(retry_id, file_name.to_string())],
        )
        .expect("delete final retry row");
        assert_eq!(deleted, 1);
        assert!(!wav_path.exists());

        std::fs::remove_dir_all(recordings_dir).expect("remove recordings directory");
    }
}
