use crate::meeting::document_types::{
    DocumentDeleteRequest, DocumentIngestRequest, DocumentListResult, DocumentMutationResult,
};
use crate::meeting::people_types::PersonId;
use crate::meeting::session::MeetingSessionManager;
use crate::meeting::types::MeetingCommandError;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn doc_ingest(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: DocumentIngestRequest,
) -> Result<DocumentMutationResult, MeetingCommandError> {
    manager.doc_ingest(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_list(
    manager: State<'_, Arc<MeetingSessionManager>>,
    person_id: Option<PersonId>,
) -> Result<DocumentListResult, MeetingCommandError> {
    manager.doc_list(person_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_delete(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: DocumentDeleteRequest,
) -> Result<DocumentMutationResult, MeetingCommandError> {
    manager.doc_delete(request).await
}
