use crate::meeting::automation_settings::MeetingSeriesAutomationEnableResult;
use crate::meeting::automation_types::{
    MeetingAutomationRoster, MeetingAutomationRunReceipt, MeetingSeriesAutomationSetRequest,
    MeetingSeriesAutomationsSnapshot,
};
use crate::meeting::session::MeetingSessionManager;
use crate::meeting::types::{MeetingCommandError, MeetingSessionId};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn meeting_series_automations_get(
    manager: State<'_, Arc<MeetingSessionManager>>,
    series_key: String,
) -> Result<MeetingSeriesAutomationsSnapshot, MeetingCommandError> {
    manager.series_automations(series_key).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_series_automations_for_session(
    manager: State<'_, Arc<MeetingSessionManager>>,
    session_id: MeetingSessionId,
) -> Result<MeetingSeriesAutomationsSnapshot, MeetingCommandError> {
    manager.series_automations_for_session(session_id).await
}

/// Turn one automation on or off for one series.
///
/// Returns the reminders grant alongside the mutation: switching the reminders
/// kind on is the one press that may raise a macOS permission dialog, and the
/// answer belongs to the same round trip so the row can show a hint rather than
/// the page showing a banner.
#[tauri::command]
#[specta::specta]
pub async fn meeting_series_automation_set(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingSeriesAutomationSetRequest,
) -> Result<MeetingSeriesAutomationEnableResult, MeetingCommandError> {
    manager.set_series_automation(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_automation_roster(
    manager: State<'_, Arc<MeetingSessionManager>>,
) -> Result<MeetingAutomationRoster, MeetingCommandError> {
    manager.automation_roster().await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_automation_runs(
    manager: State<'_, Arc<MeetingSessionManager>>,
    session_id: MeetingSessionId,
) -> Result<Vec<MeetingAutomationRunReceipt>, MeetingCommandError> {
    manager.automation_runs(session_id).await
}
