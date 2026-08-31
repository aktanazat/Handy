use crate::meeting::follow_up::MeetingFollowUpDraft;
use crate::meeting::session::MeetingSessionManager;
use crate::meeting::types::{MeetingCommandError, MeetingOperationId, MeetingSessionId};
use std::sync::Arc;
use tauri::State;

/// D26. Draft a follow-up message for one meeting.
///
/// Takes an operation id because the draft is recorded: pressing twice with
/// the same id returns the first receipt rather than logging a second event.
#[tauri::command]
#[specta::specta]
pub async fn meeting_follow_up_draft(
    manager: State<'_, Arc<MeetingSessionManager>>,
    operation_id: MeetingOperationId,
    session_id: MeetingSessionId,
) -> Result<MeetingFollowUpDraft, MeetingCommandError> {
    manager.follow_up_draft(operation_id, session_id).await
}
