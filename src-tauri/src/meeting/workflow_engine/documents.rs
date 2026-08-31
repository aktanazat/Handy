use super::{map_store_error, now_utc_ms};
use crate::meeting::document_types::{
    DocumentDeleteRequest, DocumentIngestRequest, DocumentListResult, DocumentMutationResult,
};
use crate::meeting::people_types::PersonId;
use crate::meeting::session::MeetingSessionManager;
use crate::meeting::types::MeetingCommandError;
use crate::meeting::workflow_types::{NewWorkflowEvent, WorkflowEventKind};
use std::path::Path;

impl MeetingSessionManager {
    pub async fn doc_ingest(
        &self,
        request: DocumentIngestRequest,
    ) -> Result<DocumentMutationResult, MeetingCommandError> {
        let path = Path::new(&request.path);
        let (media_type, title, source_name) = document_metadata(path)?;
        let content =
            std::fs::read_to_string(path).map_err(|_| MeetingCommandError::InvalidRequest)?;
        let store = self.store().await?;
        let result = store
            .ingest_document(
                request.operation_id,
                title,
                source_name,
                media_type,
                content,
                now_utc_ms(),
            )
            .map_err(map_store_error)?;
        let document_id = result
            .document
            .as_ref()
            .map(|document| document.summary.id)
            .ok_or(MeetingCommandError::StorageUnavailable)?;
        self.dispatch_contained(
            store,
            NewWorkflowEvent {
                kind: WorkflowEventKind::DocumentIngested,
                payload: serde_json::json!({"document_id": document_id.uuid().to_string()}),
                occurred_at_utc_ms: now_utc_ms(),
                source: "document_import",
                dedupe_key: format!("doc-ingested:{}", document_id.uuid()),
            },
            None,
        );
        self.emit_artifact_changed(None, result.revision);
        Ok(result)
    }

    pub async fn doc_list(
        &self,
        person_id: Option<PersonId>,
    ) -> Result<DocumentListResult, MeetingCommandError> {
        self.store()
            .await?
            .documents_list(person_id)
            .map_err(map_store_error)
    }

    pub async fn doc_delete(
        &self,
        request: DocumentDeleteRequest,
    ) -> Result<DocumentMutationResult, MeetingCommandError> {
        let result = self
            .store()
            .await?
            .delete_document(request.document_id, request.expected_revision)
            .map_err(map_store_error)?;
        self.emit_artifact_changed(None, result.revision);
        Ok(result)
    }
}

fn document_metadata(path: &Path) -> Result<(String, String, String), MeetingCommandError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or(MeetingCommandError::InvalidRequest)?;
    let media_type = match extension.as_str() {
        "txt" => "text/plain",
        "md" | "markdown" => "text/markdown",
        _ => return Err(MeetingCommandError::InvalidRequest),
    };
    let source_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or(MeetingCommandError::InvalidRequest)?;
    let title = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or(MeetingCommandError::InvalidRequest)?;
    Ok((
        media_type.to_string(),
        title.to_string(),
        source_name.to_string(),
    ))
}
