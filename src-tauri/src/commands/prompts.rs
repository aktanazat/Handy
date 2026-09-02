use crate::meeting::prompt_types::{
    PromptRun, PromptTargetRef, SavedPromptDeleteRequest, SavedPromptList,
    SavedPromptMutationResult, SavedPromptRunRequest, SavedPromptSaveRequest,
};
use crate::meeting::session::MeetingSessionManager;
use crate::meeting::types::MeetingCommandError;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn saved_prompt_list(
    manager: State<'_, Arc<MeetingSessionManager>>,
) -> Result<SavedPromptList, MeetingCommandError> {
    manager.saved_prompts().await
}

#[tauri::command]
#[specta::specta]
pub async fn saved_prompt_save(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: SavedPromptSaveRequest,
) -> Result<SavedPromptMutationResult, MeetingCommandError> {
    manager.save_saved_prompt(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn saved_prompt_delete(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: SavedPromptDeleteRequest,
) -> Result<SavedPromptMutationResult, MeetingCommandError> {
    manager.delete_saved_prompt(request).await
}

/// Ask one saved prompt about one noun, and keep the answer.
///
/// Answers with the run it wrote, including the runs that produced nothing: a
/// prompt whose engine was unreachable is a receipt the surface shows, not an
/// error it apologises for. `not_found` is the narrow case where there was
/// nothing to ask about — a deleted prompt, or a person this Mac has never
/// recorded a meeting with.
#[tauri::command]
#[specta::specta]
pub async fn saved_prompt_run(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: SavedPromptRunRequest,
) -> Result<PromptRun, MeetingCommandError> {
    manager.run_saved_prompt(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn saved_prompt_runs(
    manager: State<'_, Arc<MeetingSessionManager>>,
    target: PromptTargetRef,
) -> Result<Vec<PromptRun>, MeetingCommandError> {
    manager.prompt_runs(target).await
}
