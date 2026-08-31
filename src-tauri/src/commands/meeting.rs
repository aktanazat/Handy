use crate::analytics::DashboardTrendRequest;
use crate::meeting::analytics::{
    KeywordTracker, MeetingActionItemState, MeetingAnalyticsSnapshot, MeetingCatchUp,
    MeetingUserNotes,
};
use crate::meeting::clock::host_monotonic_now_ns;
use crate::meeting::detection::DetectionRuntime;
use crate::meeting::session::{
    MeetingActionItemDoneRequest, MeetingConsentPanelSessionState, MeetingConsentPanelStartRequest,
    MeetingMutationRequest, MeetingMutationResult, MeetingNoteCreateRequest,
    MeetingNoteDeleteRequest, MeetingNoteUpdateRequest, MeetingPreflightCreateRequest,
    MeetingPreflightRefreshRequest, MeetingQuestionRequest, MeetingQuestionResult,
    MeetingReenhanceRequest, MeetingRemovalResult, MeetingSegmentEditRequest,
    MeetingSessionManager, MeetingSpeakerMergeRequest, MeetingSpeakerRenameRequest,
    MeetingStartRequest, MeetingTitleSetRequest, MeetingUserNotesSaveRequest,
};
use crate::meeting::suggestions::MeetingSuggestion;
use crate::meeting::types::*;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub fn meeting_suggestions_list(
    manager: State<'_, Arc<MeetingSessionManager>>,
) -> Vec<MeetingSuggestion> {
    manager.suggestions_list(host_monotonic_now_ns())
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_preflight_create(
    manager: State<'_, Arc<MeetingSessionManager>>,
    detection: State<'_, Arc<DetectionRuntime>>,
    request: MeetingPreflightCreateRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    let calendar_event = request
        .calendar_event_key
        .as_deref()
        .map(|event_key| {
            detection
                .calendar_event_for_start(event_key)
                .ok_or(MeetingCommandError::InvalidRequest)
        })
        .transpose()?;
    manager
        .create_preflight_with_calendar(request, calendar_event)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_preflight_refresh(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingPreflightRefreshRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.refresh_preflight(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_preflight_cancel(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingMutationRequest,
) -> Result<OperationReceipt, MeetingCommandError> {
    manager.cancel_preflight(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_start(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingStartRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.start(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_consent_panel_start(
    manager: State<'_, Arc<MeetingSessionManager>>,
    detection: State<'_, Arc<DetectionRuntime>>,
    request: MeetingConsentPanelStartRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    let context = detection
        .take_for_panel_start(&request.prompt_id)
        .ok_or(MeetingCommandError::ConsentStale)?;
    let series_consent = request
        .always_record_series
        .then(|| request.consent.clone());
    let result = manager.start_from_consent_panel(&context, request).await;
    if let Ok(started) = &result {
        if started.snapshot.phase == MeetingPhase::CapturingRecording {
            if let Some(consent) = series_consent {
                if let Err(error) = manager.grant_panel_series_consent(&context, &consent).await {
                    log::warn!(
                        "Meeting started, but standing-series consent was not saved: {error:?}"
                    );
                }
            }
            detection.track_started(&context, &started.snapshot);
            manager
                .record_prompt_recorded(context.prompt_id, started.snapshot.session_id)
                .await;
        }
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_consent_panel_active_state(
    manager: State<'_, Arc<MeetingSessionManager>>,
) -> Result<Option<MeetingConsentPanelSessionState>, MeetingCommandError> {
    manager.consent_panel_active_state().await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_consent_panel_forget_series(
    manager: State<'_, Arc<MeetingSessionManager>>,
    session_id: MeetingSessionId,
) -> Result<bool, MeetingCommandError> {
    manager.forget_active_series(session_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_pause(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingMutationRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.pause(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_resume(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingMutationRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.resume(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_stop(
    manager: State<'_, Arc<MeetingSessionManager>>,
    detection: State<'_, Arc<DetectionRuntime>>,
    request: MeetingMutationRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    let session_id = request.session_id;
    let result = manager.stop(request).await;
    if result.is_ok() {
        detection.track_ended(session_id);
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_discard(
    manager: State<'_, Arc<MeetingSessionManager>>,
    detection: State<'_, Arc<DetectionRuntime>>,
    request: MeetingMutationRequest,
) -> Result<MeetingRemovalResult, MeetingCommandError> {
    let session_id = request.session_id;
    let result = manager.discard(request).await;
    if result.as_ref().is_ok_and(|removed| removed.removed) {
        detection.track_ended(session_id);
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_recovery_list(
    manager: State<'_, Arc<MeetingSessionManager>>,
) -> Result<Vec<MeetingHistorySummary>, MeetingCommandError> {
    manager.recovery_list().await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_recovery_finalize(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingMutationRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.recovery_finalize(request).await
}

/// One page of retained meetings. `filter` is optional and every field inside
/// it defaults to "no constraint", so a caller that sends nothing still gets
/// the whole list newest-first.
#[tauri::command]
#[specta::specta]
pub async fn meeting_list(
    manager: State<'_, Arc<MeetingSessionManager>>,
    cursor_utc_ms: Option<i64>,
    limit: Option<usize>,
    filter: Option<MeetingListFilter>,
) -> Result<PaginatedMeetings, MeetingCommandError> {
    manager
        .list(
            cursor_utc_ms,
            limit.unwrap_or(50),
            filter.unwrap_or_default(),
        )
        .await
}

/// Return a tagged meeting trend. An unavailable result is a normal storage
/// state and must not be presented as a zero-valued range.
#[tauri::command]
#[specta::specta]
pub async fn meeting_trend(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: DashboardTrendRequest,
) -> Result<MeetingTrendProjection, ()> {
    Ok(manager.trend_projection(request).await)
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_get(
    manager: State<'_, Arc<MeetingSessionManager>>,
    session_id: MeetingSessionId,
) -> Result<MeetingReviewSnapshot, MeetingCommandError> {
    manager.get(session_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_search(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingSearchRequest,
) -> Result<MeetingSearchResult, MeetingCommandError> {
    manager.search(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_title_set(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingTitleSetRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.title_set(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_speaker_rename(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingSpeakerRenameRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.speaker_rename(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_speaker_merge(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingSpeakerMergeRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.speaker_merge(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_segment_edit(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingSegmentEditRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.segment_edit(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_note_create(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingNoteCreateRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.note_create(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_note_update(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingNoteUpdateRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.note_update(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_note_delete(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingNoteDeleteRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.note_delete(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_artifacts_regenerate(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingMutationRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.artifacts_regenerate(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_question_ask(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingQuestionRequest,
) -> Result<MeetingQuestionResult, MeetingCommandError> {
    manager.question_ask(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_question_forget(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingMutationRequest,
    question_id: MeetingQuestionId,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.question_forget(request, question_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_export(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingExportRequest,
) -> Result<MeetingExportResult, MeetingCommandError> {
    manager.export(request).await
}

/// Write the meeting's where-did-we-land ledger to a single self-contained
/// HTML file and answer with the path it was written to.
#[tauri::command]
#[specta::specta]
pub async fn produce_ledger_html(
    manager: State<'_, Arc<MeetingSessionManager>>,
    session_id: MeetingSessionId,
) -> Result<String, MeetingCommandError> {
    manager.produce_ledger_html(session_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_delete(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingMutationRequest,
) -> Result<MeetingRemovalResult, MeetingCommandError> {
    manager.delete(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_retention_get(
    manager: State<'_, Arc<MeetingSessionManager>>,
) -> Result<MeetingRetentionSnapshot, MeetingCommandError> {
    manager.retention_get().await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_retention_set(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingRetentionSetRequest,
) -> Result<MeetingRetentionMutationResult, MeetingCommandError> {
    manager.retention_set(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn meeting_remote_cancel(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingMutationRequest,
) -> Result<(), MeetingCommandError> {
    manager.remote_cancel(request).await
}

/// Conversation metrics, tracker hits, action-item ticks and the user's notes
/// for one meeting. Metrics are derived from the transcript on every call, so
/// the answer always matches the transcript the caller can see.
#[tauri::command]
#[specta::specta]
pub async fn get_meeting_analytics(
    manager: State<'_, Arc<MeetingSessionManager>>,
    session_id: MeetingSessionId,
) -> Result<MeetingAnalyticsSnapshot, MeetingCommandError> {
    manager.analytics_get(session_id).await
}

#[tauri::command]
#[specta::specta]
pub fn list_keyword_trackers(app: tauri::AppHandle) -> Vec<KeywordTracker> {
    crate::settings::get_settings(&app).trackers_list
}

/// Replace the tracker list. Blank names and blank patterns are dropped here
/// rather than stored, so the scan never has to defend against them.
#[tauri::command]
#[specta::specta]
pub fn save_keyword_trackers(
    app: tauri::AppHandle,
    trackers: Vec<KeywordTracker>,
) -> Vec<KeywordTracker> {
    let cleaned: Vec<KeywordTracker> = trackers
        .into_iter()
        .filter_map(|tracker| {
            let name = tracker.name.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let patterns: Vec<String> = tracker
                .patterns
                .into_iter()
                .map(|pattern| pattern.trim().to_string())
                .filter(|pattern| !pattern.is_empty())
                .collect();
            Some(KeywordTracker { name, patterns })
        })
        .collect();
    crate::settings::update_settings(&app, |settings| {
        settings.trackers_list = cleaned.clone();
    });
    cleaned
}

#[tauri::command]
#[specta::specta]
pub async fn set_action_item_done(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingActionItemDoneRequest,
) -> Result<Vec<MeetingActionItemState>, MeetingCommandError> {
    manager.action_item_done_set(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_meeting_user_notes(
    manager: State<'_, Arc<MeetingSessionManager>>,
    session_id: MeetingSessionId,
) -> Result<MeetingUserNotes, MeetingCommandError> {
    manager.user_notes_get(session_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn save_meeting_user_notes(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingUserNotesSaveRequest,
) -> Result<MeetingUserNotes, MeetingCommandError> {
    manager.user_notes_save(request).await
}

/// Save the notes layer and rebuild the generated notes from it.
#[tauri::command]
#[specta::specta]
pub async fn reenhance_meeting_with_notes(
    manager: State<'_, Arc<MeetingSessionManager>>,
    request: MeetingReenhanceRequest,
) -> Result<MeetingMutationResult, MeetingCommandError> {
    manager.artifacts_reenhance(request).await
}

/// Recap the transcript captured so far in at most six bullets.
#[tauri::command]
#[specta::specta]
pub async fn meeting_catch_up(
    manager: State<'_, Arc<MeetingSessionManager>>,
    session_id: MeetingSessionId,
) -> Result<MeetingCatchUp, MeetingCommandError> {
    manager.catch_up(session_id).await
}
