use crate::meeting::types::MeetingSessionId;
use serde::{Deserialize, Serialize};
use specta::Type;

pub const CLOUD_SYNC_EVENT_SCHEMA_VERSION: u32 = 1;
pub const BROWSER_SHARE_TRUST_DISCLOSURE: &str = "Browser view trusts the deployed first-party viewer and Cloudflare account. A deployment-account attacker can replace viewer JavaScript and read the fragment key.";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CloudObjectState {
    Local,
    Queued,
    Uploading,
    Committed,
    Conflict,
    PendingDeletion,
    Deleted,
    Paused,
    AuthRequired,
    Quota,
    IntegrityFailure,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CloudSyncErrorKind {
    PortableUnavailable,
    SecretUnavailable,
    SetupRequired,
    AuthRequired,
    Quota,
    IntegrityFailure,
    Conflict,
    UnsupportedProtocol,
    Transient,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudMeetingStatus {
    pub session_id: MeetingSessionId,
    pub state: CloudObjectState,
    pub remote_revision_id: Option<String>,
    pub retry_at_utc_ms: Option<i64>,
    pub share_count: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudSyncOverview {
    pub enabled: bool,
    pub portable_mode: bool,
    pub paused: bool,
    pub queued_objects: u32,
    pub pending_deletions: u32,
    pub terminal_error: Option<CloudSyncErrorKind>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudSyncChangedPayload {
    pub event_schema_version: u32,
    pub session_id: Option<MeetingSessionId>,
    pub state: Option<CloudObjectState>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(transparent)]
pub struct CloudSyncChangedEvent(pub CloudSyncChangedPayload);

impl tauri_specta::Event for CloudSyncChangedEvent {
    const NAME: &'static str = "cloud-sync:changed";
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudSyncBootstrapRequest {
    pub endpoint: String,
    pub bootstrap_secret: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudSyncBootstrapResult {
    pub overview: CloudSyncOverview,
    pub recovery_code: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudSyncRecoveryRequest {
    pub endpoint: String,
    pub recovery_code: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudPairingOfferRequest {
    pub endpoint: String,
    pub vault_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudPairingOffer {
    pub protocol_version: u32,
    pub vault_id: String,
    pub device_id: String,
    pub signing_public_key: String,
    pub pairing_public_key: String,
    pub candidate_proof: String,
    pub pairing_nonce: String,
    pub expires_at_utc_ms: i64,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudPairingApproveRequest {
    pub offer: CloudPairingOffer,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudPairingAcceptRequest {
    pub endpoint: String,
    pub offer: CloudPairingOffer,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CloudConflictChoice {
    KeepLocal,
    UseRemote,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudConflictResolveRequest {
    pub session_id: MeetingSessionId,
    pub choice: CloudConflictChoice,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudShareCreateRequest {
    pub session_id: MeetingSessionId,
    pub expires_at_utc_ms: i64,
    pub destination_path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudShareResult {
    pub share_id: String,
    pub expires_at_utc_ms: i64,
    pub file_path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudBrowserShareCreateRequest {
    pub session_id: MeetingSessionId,
    pub expires_at_utc_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudBrowserShareResult {
    pub share_id: String,
    pub expires_at_utc_ms: i64,
    pub share_url: String,
    pub trust_disclosure: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudShareRevokeRequest {
    pub share_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudShareImportRequest {
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct CloudShareImportResult {
    pub session_id: MeetingSessionId,
}
