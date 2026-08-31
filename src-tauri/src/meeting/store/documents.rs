use super::{MeetingStore, StoreError};
use crate::meeting::document_types::{
    Document, DocumentId, DocumentListResult, DocumentMutationResult, DocumentSummary,
};
use crate::meeting::people_types::PersonId;
use crate::meeting::types::MeetingOperationId;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use uuid::Uuid;

const SCHEMA_VERSION: u32 = 1;

impl MeetingStore {
    pub(crate) fn documents_list(
        &self,
        person_id: Option<PersonId>,
    ) -> Result<DocumentListResult, StoreError> {
        let connection = self.connection()?;
        let revision = document_revision_in(&connection)?;
        let sql = if person_id.is_some() {
            "SELECT d.id, d.title, d.source_name, d.media_type, d.content,
                    d.created_at_utc_ms
               FROM documents d
               JOIN document_person_links l ON l.document_id = d.id
              WHERE l.person_id = ?1
              ORDER BY d.created_at_utc_ms DESC, d.id DESC"
        } else {
            "SELECT d.id, d.title, d.source_name, d.media_type, d.content,
                    d.created_at_utc_ms
               FROM documents d
              ORDER BY d.created_at_utc_ms DESC, d.id DESC"
        };
        let mut statement = connection.prepare(sql)?;
        let rows = if let Some(person_id) = person_id {
            statement.query_map([person_id.uuid().to_string()], document_from_row)?
        } else {
            statement.query_map([], document_from_row)?
        };
        let entries = rows.collect::<Result<Vec<_>, _>>()?;
        Ok(DocumentListResult {
            schema_version: SCHEMA_VERSION,
            revision,
            entries,
        })
    }

    pub(crate) fn ingest_document(
        &self,
        operation_id: MeetingOperationId,
        title: String,
        source_name: String,
        media_type: String,
        content: String,
        now_utc_ms: i64,
    ) -> Result<DocumentMutationResult, StoreError> {
        let title = title.trim().to_string();
        let source_name = source_name.trim().to_string();
        if title.is_empty()
            || source_name.is_empty()
            || !matches!(media_type.as_str(), "text/plain" | "text/markdown")
        {
            return Err(StoreError::Invalid);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let operation_id = operation_id.uuid().to_string();
        let existing: Option<String> = transaction
            .query_row(
                "SELECT result_json FROM document_ingest_operations WHERE operation_id = ?1",
                [&operation_id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(existing) = existing {
            let result = serde_json::from_str(&existing).map_err(|_| StoreError::Corrupt)?;
            transaction.commit()?;
            return Ok(result);
        }

        let document_id = DocumentId::new();
        transaction.execute(
            "INSERT INTO documents (
                id, title, source_name, media_type, content,
                created_at_utc_ms, updated_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![
                document_id.uuid().to_string(),
                title,
                source_name,
                media_type,
                content,
                now_utc_ms
            ],
        )?;
        let revision = bump_document_revision_in(&transaction)?;
        let document = document_by_id_in(&transaction, document_id)?;
        let result = DocumentMutationResult {
            schema_version: SCHEMA_VERSION,
            revision,
            document: Some(document),
            removed: false,
        };
        let result_json = serde_json::to_string(&result).map_err(|_| StoreError::Corrupt)?;
        transaction.execute(
            "INSERT INTO document_ingest_operations (
                operation_id, result_json, created_at_utc_ms
             ) VALUES (?1, ?2, ?3)",
            params![operation_id, result_json, now_utc_ms],
        )?;
        transaction.commit()?;
        Ok(result)
    }

    pub(crate) fn delete_document(
        &self,
        document_id: DocumentId,
        expected_revision: u64,
    ) -> Result<DocumentMutationResult, StoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_document_revision_in(&transaction, expected_revision)?;
        let removed = transaction.execute(
            "DELETE FROM documents WHERE id = ?1",
            [document_id.uuid().to_string()],
        )? != 0;
        if !removed {
            return Err(StoreError::NotFound);
        }
        let revision = bump_document_revision_in(&transaction)?;
        transaction.commit()?;
        Ok(DocumentMutationResult {
            schema_version: SCHEMA_VERSION,
            revision,
            document: None,
            removed: true,
        })
    }
}

pub(super) fn document_by_id_in(
    connection: &Connection,
    document_id: DocumentId,
) -> Result<Document, StoreError> {
    connection
        .query_row(
            "SELECT id, title, source_name, media_type, content, created_at_utc_ms
               FROM documents WHERE id = ?1",
            [document_id.uuid().to_string()],
            document_from_row,
        )
        .optional()?
        .ok_or(StoreError::NotFound)
}

pub(super) fn bump_document_revision_in(connection: &Connection) -> Result<u64, StoreError> {
    connection.execute(
        "UPDATE document_state SET revision = revision + 1 WHERE singleton = 1",
        [],
    )?;
    document_revision_in(connection)
}

fn document_revision_in(connection: &Connection) -> Result<u64, StoreError> {
    let revision: i64 = connection.query_row(
        "SELECT revision FROM document_state WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    u64::try_from(revision).map_err(|_| StoreError::Corrupt)
}

fn require_document_revision_in(
    connection: &Connection,
    expected_revision: u64,
) -> Result<(), StoreError> {
    if document_revision_in(connection)? != expected_revision {
        return Err(StoreError::Conflict);
    }
    Ok(())
}

fn document_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Document> {
    let id: String = row.get(0)?;
    let id = Uuid::parse_str(&id).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(Document {
        summary: DocumentSummary {
            id: DocumentId(id),
            title: row.get(1)?,
            source_name: row.get(2)?,
            media_type: row.get(3)?,
            created_at_utc_ms: row.get(5)?,
        },
        content: row.get(4)?,
    })
}
