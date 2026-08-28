use crate::cloud_sync::types::{
    CloudBrowserShareCreateRequest, CloudBrowserShareResult, CloudConflictResolveRequest,
    CloudMeetingStatus, CloudPairingAcceptRequest, CloudPairingApproveRequest, CloudPairingOffer,
    CloudPairingOfferRequest, CloudShareCreateRequest, CloudShareImportRequest,
    CloudShareImportResult, CloudShareResult, CloudShareRevokeRequest, CloudSyncBootstrapRequest,
    CloudSyncBootstrapResult, CloudSyncOverview, CloudSyncRecoveryRequest,
};
use crate::cloud_sync::{CloudSyncErrorKind, CloudSyncRuntime};
use crate::meeting::types::MeetingSessionId;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_overview_get(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
) -> Result<CloudSyncOverview, CloudSyncErrorKind> {
    runtime.overview().await.map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_meeting_status_get(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    session_id: MeetingSessionId,
) -> Result<CloudMeetingStatus, CloudSyncErrorKind> {
    runtime
        .meeting_status(session_id)
        .await
        .map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_meeting_status_list(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
) -> Result<Vec<CloudMeetingStatus>, CloudSyncErrorKind> {
    runtime
        .meeting_status_list()
        .await
        .map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_bootstrap(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    request: CloudSyncBootstrapRequest,
) -> Result<CloudSyncBootstrapResult, CloudSyncErrorKind> {
    runtime
        .bootstrap(request)
        .await
        .map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_recover(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    request: CloudSyncRecoveryRequest,
) -> Result<CloudSyncOverview, CloudSyncErrorKind> {
    runtime.recover(request).await.map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_pairing_offer(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    request: CloudPairingOfferRequest,
) -> Result<CloudPairingOffer, CloudSyncErrorKind> {
    runtime
        .pairing_offer(request)
        .await
        .map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_pairing_approve(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    request: CloudPairingApproveRequest,
) -> Result<CloudSyncOverview, CloudSyncErrorKind> {
    runtime
        .pairing_approve(request)
        .await
        .map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_pairing_accept(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    request: CloudPairingAcceptRequest,
) -> Result<CloudSyncOverview, CloudSyncErrorKind> {
    runtime
        .pairing_accept(request)
        .await
        .map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_pause(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
) -> Result<CloudSyncOverview, CloudSyncErrorKind> {
    runtime.pause().await.map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_resume(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
) -> Result<CloudSyncOverview, CloudSyncErrorKind> {
    runtime.resume().await.map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_retry(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    session_id: MeetingSessionId,
) -> Result<CloudMeetingStatus, CloudSyncErrorKind> {
    runtime
        .retry(session_id)
        .await
        .map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_sync_conflict_resolve(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    request: CloudConflictResolveRequest,
) -> Result<CloudMeetingStatus, CloudSyncErrorKind> {
    runtime
        .conflict_resolve(request)
        .await
        .map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_share_create(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    request: CloudShareCreateRequest,
) -> Result<CloudShareResult, CloudSyncErrorKind> {
    runtime
        .share_create(request)
        .await
        .map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_browser_share_create(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    request: CloudBrowserShareCreateRequest,
) -> Result<CloudBrowserShareResult, CloudSyncErrorKind> {
    runtime
        .browser_share_create(request)
        .await
        .map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_share_revoke(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    request: CloudShareRevokeRequest,
) -> Result<CloudSyncOverview, CloudSyncErrorKind> {
    runtime
        .share_revoke(request)
        .await
        .map_err(|error| error.kind())
}

#[tauri::command]
#[specta::specta]
pub async fn cloud_share_import_file(
    runtime: State<'_, Arc<CloudSyncRuntime>>,
    request: CloudShareImportRequest,
) -> Result<CloudShareImportResult, CloudSyncErrorKind> {
    runtime
        .share_import(request)
        .await
        .map_err(|error| error.kind())
}
