use crate::recorder::{
    RecorderCommandError, RecorderPreflight, RecorderSnapshot, RecorderStartRequest,
    ScreenRecorderManager,
};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub fn recorder_preflight(manager: State<'_, Arc<ScreenRecorderManager>>) -> RecorderPreflight {
    manager.preflight()
}
#[tauri::command]
#[specta::specta]
pub async fn recorder_preview_start(
    manager: State<'_, Arc<ScreenRecorderManager>>,
    request: RecorderStartRequest,
) -> Result<RecorderSnapshot, RecorderCommandError> {
    let manager = Arc::clone(&*manager);
    tauri::async_runtime::spawn_blocking(move || manager.preview_start(request))
        .await
        .map_err(|_| RecorderCommandError::InvalidState)?
}

#[tauri::command]
#[specta::specta]
pub async fn recorder_preview_stop(
    manager: State<'_, Arc<ScreenRecorderManager>>,
) -> Result<RecorderSnapshot, RecorderCommandError> {
    let manager = Arc::clone(&*manager);
    tauri::async_runtime::spawn_blocking(move || manager.preview_stop())
        .await
        .map_err(|_| RecorderCommandError::InvalidState)?
}

#[tauri::command]
#[specta::specta]
pub async fn recorder_start(
    manager: State<'_, Arc<ScreenRecorderManager>>,
) -> Result<RecorderSnapshot, RecorderCommandError> {
    let manager = Arc::clone(&*manager);
    tauri::async_runtime::spawn_blocking(move || manager.start())
        .await
        .map_err(|_| RecorderCommandError::InvalidState)?
}

#[tauri::command]
#[specta::specta]
pub async fn recorder_pause(
    manager: State<'_, Arc<ScreenRecorderManager>>,
) -> Result<RecorderSnapshot, RecorderCommandError> {
    let manager = Arc::clone(&*manager);
    tauri::async_runtime::spawn_blocking(move || manager.pause())
        .await
        .map_err(|_| RecorderCommandError::InvalidState)?
}

#[tauri::command]
#[specta::specta]
pub async fn recorder_resume(
    manager: State<'_, Arc<ScreenRecorderManager>>,
) -> Result<RecorderSnapshot, RecorderCommandError> {
    let manager = Arc::clone(&*manager);
    tauri::async_runtime::spawn_blocking(move || manager.resume())
        .await
        .map_err(|_| RecorderCommandError::InvalidState)?
}

#[tauri::command]
#[specta::specta]
pub async fn recorder_stop(
    manager: State<'_, Arc<ScreenRecorderManager>>,
) -> Result<RecorderSnapshot, RecorderCommandError> {
    let manager = Arc::clone(&*manager);
    tauri::async_runtime::spawn_blocking(move || manager.stop())
        .await
        .map_err(|_| RecorderCommandError::InvalidState)?
}

#[tauri::command]
#[specta::specta]
pub async fn recorder_cancel(
    manager: State<'_, Arc<ScreenRecorderManager>>,
) -> Result<RecorderSnapshot, RecorderCommandError> {
    let manager = Arc::clone(&*manager);
    tauri::async_runtime::spawn_blocking(move || manager.cancel())
        .await
        .map_err(|_| RecorderCommandError::InvalidState)?
}
