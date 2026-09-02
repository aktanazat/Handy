use crate::meeting::follow_up::{
    MeetingFollowUpDraft, MeetingFollowUpMail, MeetingFollowUpMailRequest,
};
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

/// D26. Build the `mailto:` URL that opens this meeting's follow-up in Mail.
///
/// Takes the draft and the over-bound note because both are words a person
/// reads, and those come from the i18next catalog rather than from Rust. Returns
/// the URL for the caller to open: the addressing, the subject, the encoding and
/// the length bound are this side's, opening a URL is the shell's.
#[tauri::command]
#[specta::specta]
pub async fn meeting_follow_up_mail(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingFollowUpMailRequest,
) -> Result<MeetingFollowUpMail, MeetingCommandError> {
    manager.follow_up_mail(request).await
}
