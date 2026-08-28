use std::{
    collections::HashMap,
    fmt,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Listener};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::{
    meeting::{
        cloud_bundle::CloudMeetingBundleV1,
        session::MeetingSessionManager,
        store::{
            CloudCapabilitiesCache, CloudConflict, CloudHead, CloudOutboxChunk, CloudOutboxInput,
            CloudOutboxKind, CloudOutboxRecord, CloudOutboxState, CloudOutboxUpdate,
            CloudShareContentKind, CloudShareInput, CloudShareRecord, CloudShareState,
            CloudShareUpdate, MeetingStore, StoreError,
        },
        types::{
            MeetingNavigationDestination, MeetingPhase, MeetingReviewSnapshot, MeetingSessionId,
        },
    },
    portable,
    secrets::{CloudSyncKeys, SecretManager},
    settings::{self, CloudSyncSettings, CLOUD_SYNC_CONSENT_VERSION},
};

use super::{
    client::{
        BootstrapDeviceRequest, CloudCapabilities, CloudClient, CloudClientError, CloudCredentials,
        CloudErrorCode, IdempotencyKey, ObjectManifestResponse, ObjectUploadPlan,
        PairDeviceRequest, ShareUploadPlan, TombstoneReason, TombstoneRequest, UploadChunkPlan,
    },
    crypto::{
        base64_url_decode, base64_url_encode, decode_recovery_code, ed25519_public_key,
        encode_recovery_code, open_object_revision_payload, open_pairing_envelope,
        open_share_payload, seal_object_revision_payload, seal_pairing_envelope,
        seal_share_payload, sha256_base64url, sha256_digest, sign_canonical_bootstrap,
        sign_canonical_pair_approval, sign_canonical_pair_candidate, sign_canonical_tombstone,
        sign_canonical_upload_envelope, verify_ed25519, CanonicalBootstrapInput,
        CanonicalPairApprovalInput, CanonicalPairCandidateInput, CanonicalTombstoneInput,
        CanonicalUploadEnvelopeInput, ObjectContentKind, ObjectRevisionCryptoContext,
        PairingEnvelopeSealInput, SharePayloadContext, SharePayloadDomain, UploadChunk, UploadKind,
    },
    share_file::{parse_worker_share_transport, read_share_file, write_share_file},
    types::{
        CloudBrowserShareCreateRequest, CloudBrowserShareResult, CloudConflictChoice,
        CloudConflictResolveRequest, CloudMeetingStatus, CloudObjectState,
        CloudPairingAcceptRequest, CloudPairingApproveRequest, CloudPairingOffer,
        CloudPairingOfferRequest, CloudShareCreateRequest, CloudShareImportRequest,
        CloudShareImportResult, CloudShareResult, CloudShareRevokeRequest,
        CloudSyncBootstrapRequest, CloudSyncBootstrapResult, CloudSyncChangedEvent,
        CloudSyncChangedPayload, CloudSyncErrorKind, CloudSyncOverview, CloudSyncRecoveryRequest,
        BROWSER_SHARE_TRUST_DISCLOSURE, CLOUD_SYNC_EVENT_SCHEMA_VERSION,
    },
};

const PROTOCOL_AUDIENCE: &str = "sona-companion";
const PROTOCOL_VERSION: u32 = 1;
const CRYPTO_VERSION: u32 = 1;
const OBJECT_SOURCE_FORMAT: &str = "sona-meeting-bundle-json-v1";
const CAPABILITY_SHARE_KIND: &str = "meeting_bundle";
const BROWSER_SHARE_KIND: &str = "markdown";
const BROWSER_SOURCE_FORMAT: &str = "markdown-utf8";
const OBJECT_MANIFEST_FILE: &str = "manifest.bin";
const MAX_ENCRYPTED_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const MAX_PLAINTEXT_CHUNK_BYTES: usize = MAX_ENCRYPTED_CHUNK_BYTES - 28;
const MAX_BUNDLE_BYTES: usize = 8 * 1024 * 1024;
const MAX_SHARE_PLAINTEXT_BYTES: usize = 256 * 1024 * 1024;
const CAPABILITIES_CACHE_MS: i64 = 5 * 60 * 1000;
const BACKGROUND_SCAN_INTERVAL: Duration = Duration::from_secs(5);
const MAX_RETRY_DELAY_MS: i64 = 5 * 60 * 1000;
const MAX_SHARE_EXPIRY_MS: i64 = 30 * 24 * 60 * 60 * 1000;

pub(crate) struct CloudSyncRuntime {
    app: AppHandle,
    meetings: Arc<MeetingSessionManager>,
    secrets: Arc<SecretManager>,
    stopped: AtomicBool,
    started: AtomicBool,
    client: Mutex<Option<EndpointClient>>,
}

struct EndpointClient {
    endpoint: String,
    client: CloudClient,
}

struct CloudAccess {
    store: Arc<MeetingStore>,
    state: crate::meeting::store::CloudState,
    client: CloudClient,
    keys: CloudSyncKeys,
}

struct StagedChunk {
    index: u32,
    size: u64,
    sha256: String,
    bytes: Vec<u8>,
}

struct StagedPayload {
    manifest: Vec<u8>,
    manifest_sha256: String,
    chunks: Vec<StagedChunk>,
    total_bytes: u64,
}

struct ConflictCacheInput<'a> {
    object_id: &'a str,
    revision_id: &'a str,
    sequence: u64,
    source_session_id: Option<MeetingSessionId>,
    source_revision: Option<u64>,
    bundle: &'a CloudMeetingBundleV1,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ObjectPayloadManifest {
    version: u32,
    kind: String,
    source_format: String,
    chunk_count: u32,
    plaintext_bytes: u64,
    plaintext_sha256: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilityShareManifest {
    version: u32,
    kind: String,
    source_format: String,
    chunk_count: u32,
    plaintext_bytes: u64,
    plaintext_sha256: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BrowserShareManifest {
    version: u32,
    kind: String,
    source_format: String,
    title: String,
    chunk_count: u32,
    plaintext_bytes: u64,
}

#[derive(Serialize)]
struct WorkerShareTransport<'a> {
    format: &'static str,
    version: u32,
    share: WorkerShareTransportMetadata<'a>,
    manifest: String,
    chunks: Vec<WorkerShareTransportChunk>,
}

#[derive(Serialize)]
struct WorkerShareTransportMetadata<'a> {
    share_id: &'a str,
    crypto_version: u32,
    manifest_sha256: &'a str,
    chunk_count: u32,
    total_bytes: u64,
    writer_signature: &'a str,
}

#[derive(Serialize)]
struct WorkerShareTransportChunk {
    index: u32,
    size: u32,
    sha256: String,
}

pub(crate) enum CloudRuntimeError {
    PortableUnavailable,
    SecretUnavailable,
    SetupRequired,
    IntegrityFailure,
    Conflict,
    UnsupportedProtocol,
    Deferred,
    Client(CloudClientError),
    Storage,
    File,
    Randomness,
}

impl CloudRuntimeError {
    pub(crate) fn kind(&self) -> CloudSyncErrorKind {
        match self {
            Self::PortableUnavailable => CloudSyncErrorKind::PortableUnavailable,
            Self::SecretUnavailable => CloudSyncErrorKind::SecretUnavailable,
            Self::SetupRequired => CloudSyncErrorKind::SetupRequired,
            Self::IntegrityFailure | Self::Storage | Self::File => {
                CloudSyncErrorKind::IntegrityFailure
            }
            Self::Conflict => CloudSyncErrorKind::Conflict,
            Self::UnsupportedProtocol => CloudSyncErrorKind::UnsupportedProtocol,
            Self::Deferred | Self::Randomness => CloudSyncErrorKind::Transient,
            Self::Client(error) => match error.api_error().map(|api| api.code) {
                Some(CloudErrorCode::Unauthorized | CloudErrorCode::RevokedDevice) => {
                    CloudSyncErrorKind::AuthRequired
                }
                Some(CloudErrorCode::QuotaExceeded) => CloudSyncErrorKind::Quota,
                Some(
                    CloudErrorCode::IntegrityFailed
                    | CloudErrorCode::ChunkConflict
                    | CloudErrorCode::IdempotencyConflict,
                ) => CloudSyncErrorKind::IntegrityFailure,
                Some(CloudErrorCode::StaleRevision) => CloudSyncErrorKind::Conflict,
                Some(CloudErrorCode::UnsupportedVersion) => CloudSyncErrorKind::UnsupportedProtocol,
                _ => CloudSyncErrorKind::Transient,
            },
        }
    }
}

impl fmt::Display for CloudRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self.kind() {
            CloudSyncErrorKind::PortableUnavailable => "cloud sync is unavailable in portable mode",
            CloudSyncErrorKind::SecretUnavailable => "cloud sync keys are unavailable",
            CloudSyncErrorKind::SetupRequired => "cloud sync needs setup",
            CloudSyncErrorKind::AuthRequired => "cloud sync authentication is required",
            CloudSyncErrorKind::Quota => "cloud sync quota is exhausted",
            CloudSyncErrorKind::IntegrityFailure => "cloud sync integrity validation failed",
            CloudSyncErrorKind::Conflict => "cloud sync has a conflict",
            CloudSyncErrorKind::UnsupportedProtocol => "cloud sync protocol is unsupported",
            CloudSyncErrorKind::Transient => "cloud sync is temporarily unavailable",
        };
        formatter.write_str(message)
    }
}

impl fmt::Debug for CloudRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("CloudRuntimeError")
            .field(&self.kind())
            .finish()
    }
}

impl std::error::Error for CloudRuntimeError {}

impl CloudSyncRuntime {
    pub(crate) fn new(
        app: AppHandle,
        meetings: Arc<MeetingSessionManager>,
        secrets: Arc<SecretManager>,
    ) -> Self {
        Self {
            app,
            meetings,
            secrets,
            stopped: AtomicBool::new(false),
            started: AtomicBool::new(false),
            client: Mutex::new(None),
        }
    }

    pub(crate) fn start(self: &Arc<Self>) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }

        let event_runtime = Arc::clone(self);
        self.app.listen("meeting:session-changed", move |event| {
            let Ok(payload) =
                serde_json::from_str::<crate::meeting::types::MeetingEventPayload>(event.payload())
            else {
                return;
            };
            let Some(session_id) = payload.session_id else {
                return;
            };
            let runtime = Arc::clone(&event_runtime);
            tauri::async_runtime::spawn(async move {
                let _ = runtime.queue_current_session(session_id).await;
            });
        });

        let runtime = Arc::clone(self);
        thread::spawn(move || {
            if let Ok(store) = tauri::async_runtime::block_on(runtime.meetings.cloud_store()) {
                let _ = store.recover_claimed_cloud_outbox(utc_now_ms());
            }
            while !runtime.stopped.load(Ordering::Acquire) {
                let _ = tauri::async_runtime::block_on(runtime.sync_once());
                thread::sleep(BACKGROUND_SCAN_INTERVAL);
            }
        });
    }

    pub(crate) fn shutdown(&self) {
        self.stopped.store(true, Ordering::Release);
    }

    pub(crate) async fn overview(&self) -> Result<CloudSyncOverview, CloudRuntimeError> {
        let settings = settings::get_settings(&self.app).cloud_sync;
        let portable_mode = portable::is_portable();
        let Some(store) = self.meetings.cloud_store().await.ok() else {
            return Ok(CloudSyncOverview {
                enabled: settings.enabled && settings.has_current_consent(),
                portable_mode,
                paused: settings.paused,
                queued_objects: 0,
                pending_deletions: 0,
                terminal_error: None,
            });
        };
        let counts = store.cloud_status_counts().map_err(map_store_error)?;
        let terminal_error = store
            .cloud_latest_terminal_error()
            .map_err(map_store_error)?
            .as_deref()
            .and_then(terminal_error_kind);
        let state_paused = store
            .cloud_state()
            .map_err(map_store_error)?
            .is_some_and(|state| state.paused);
        Ok(CloudSyncOverview {
            enabled: settings.enabled && settings.has_current_consent(),
            portable_mode,
            paused: settings.paused || state_paused,
            queued_objects: counts.queued_outbox.saturating_add(counts.claimed_outbox),
            pending_deletions: counts.pending_tombstones,
            terminal_error,
        })
    }

    pub(crate) async fn meeting_status(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<CloudMeetingStatus, CloudRuntimeError> {
        let store = self
            .meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        self.meeting_status_from_store(&store, session_id)
    }

    pub(crate) async fn meeting_status_list(
        &self,
    ) -> Result<Vec<CloudMeetingStatus>, CloudRuntimeError> {
        let store = self
            .meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        let page = self
            .meetings
            .list(None, 100)
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        page.entries
            .into_iter()
            .map(|entry| self.meeting_status_from_store(&store, entry.session_id))
            .collect()
    }

    pub(crate) async fn bootstrap(
        &self,
        request: CloudSyncBootstrapRequest,
    ) -> Result<CloudSyncBootstrapResult, CloudRuntimeError> {
        self.reject_portable()?;
        let endpoint = canonical_endpoint(&request.endpoint)?;
        if request.bootstrap_secret.trim().is_empty() {
            return Err(CloudRuntimeError::SetupRequired);
        }
        let store = self
            .meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        let keys = self
            .secrets
            .cloud_sync_keys()
            .await
            .map_err(|_| CloudRuntimeError::SecretUnavailable)?;
        let existing = store.cloud_state().map_err(map_store_error)?;
        let (vault_id, device_id) = match existing {
            Some(state) if state.endpoint == endpoint && state.paused => {
                (state.vault_id, state.device_id)
            }
            Some(_) => return Err(CloudRuntimeError::Conflict),
            None => (random_opaque_id()?, random_opaque_id()?),
        };
        let signing_public_key = ed25519_public_key(&*keys.signing_seed)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let pairing_public_key = super::crypto::x25519_public_key(&*keys.pairing_secret)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let bootstrap_input = CanonicalBootstrapInput {
            audience: PROTOCOL_AUDIENCE,
            vault_id: &vault_id,
            device_id: &device_id,
            signing_public_key: &signing_public_key,
            pairing_public_key: &pairing_public_key,
        };
        let bootstrap_signature = sign_canonical_bootstrap(&bootstrap_input, &*keys.signing_seed)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let mut state = crate::meeting::store::CloudState {
            vault_id: vault_id.clone(),
            device_id: device_id.clone(),
            endpoint: endpoint.clone(),
            cursor: None,
            snapshot_high_water: None,
            clock_offset_ms: 0,
            paused: true,
        };
        store.upsert_cloud_state(&state).map_err(map_store_error)?;
        let client = self.client_for(&endpoint)?;
        let idempotency = idempotency_key(&["bootstrap", &vault_id, &device_id])?;
        let response = client
            .bootstrap_device(
                request.bootstrap_secret.trim(),
                &idempotency,
                &BootstrapDeviceRequest {
                    version: PROTOCOL_VERSION,
                    vault_id: vault_id.clone(),
                    device_id: device_id.clone(),
                    signing_public_key: base64_url_encode(&signing_public_key),
                    pairing_public_key: base64_url_encode(&pairing_public_key),
                    self_signature: base64_url_encode(&bootstrap_signature),
                },
            )
            .await
            .map_err(CloudRuntimeError::Client);
        self.persist_clock(&store, &client);
        let response = response?;
        if response.vault_id != vault_id
            || response.device_id != device_id
            || response.status != "active"
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        validate_capabilities(&response.capabilities)?;
        self.persist_capabilities(&store, &endpoint, &response.capabilities)?;
        state.clock_offset_ms = client.clock_offset_ms();
        state.paused = false;
        store.upsert_cloud_state(&state).map_err(map_store_error)?;
        settings::update_settings(&self.app, |settings| {
            settings.cloud_sync.enabled = true;
            settings.cloud_sync.paused = false;
            settings.cloud_sync.consent_version = Some(CLOUD_SYNC_CONSENT_VERSION);
            settings.cloud_sync.endpoint = Some(endpoint);
        });
        let recovery_code = encode_recovery_code(&vault_id, &*keys.vault_root)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let overview = self.overview().await?;
        self.emit_changed(None, None);
        Ok(CloudSyncBootstrapResult {
            overview,
            recovery_code,
        })
    }

    pub(crate) async fn recover(
        &self,
        request: CloudSyncRecoveryRequest,
    ) -> Result<CloudSyncOverview, CloudRuntimeError> {
        self.reject_portable()?;
        let endpoint = canonical_endpoint(&request.endpoint)?;
        let recovery = decode_recovery_code(request.recovery_code.trim())
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        self.secrets
            .replace_cloud_vault_root(recovery.vault_root)
            .await
            .map_err(|_| CloudRuntimeError::SecretUnavailable)?;
        let store = self
            .meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        let existing = store.cloud_state().map_err(map_store_error)?;
        let state = match existing {
            Some(mut state) if state.vault_id == recovery.vault_id => {
                state.endpoint = endpoint;
                state
            }
            Some(_) | None => crate::meeting::store::CloudState {
                vault_id: recovery.vault_id,
                device_id: random_opaque_id()?,
                endpoint,
                cursor: None,
                snapshot_high_water: None,
                clock_offset_ms: 0,
                paused: true,
            },
        };
        store.upsert_cloud_state(&state).map_err(map_store_error)?;
        self.emit_changed(None, None);
        self.overview().await
    }

    pub(crate) async fn pairing_offer(
        &self,
        request: CloudPairingOfferRequest,
    ) -> Result<CloudPairingOffer, CloudRuntimeError> {
        self.reject_portable()?;
        let endpoint = canonical_endpoint(&request.endpoint)?;
        let keys = self
            .secrets
            .cloud_sync_keys()
            .await
            .map_err(|_| CloudRuntimeError::SecretUnavailable)?;
        let store = self
            .meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        let existing = store.cloud_state().map_err(map_store_error)?;
        let device_id = match existing {
            Some(state)
                if state.vault_id == request.vault_id
                    && state.endpoint == endpoint
                    && state.paused =>
            {
                state.device_id
            }
            Some(_) => return Err(CloudRuntimeError::Conflict),
            None => random_opaque_id()?,
        };
        let signing_public_key = ed25519_public_key(&*keys.signing_seed)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let pairing_public_key = super::crypto::x25519_public_key(&*keys.pairing_secret)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let pairing_nonce = random_array::<16>()?;
        let expires_at_utc_ms = adjusted_now_ms(0)
            .checked_add(15 * 60 * 1000)
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        let expires_at =
            u64::try_from(expires_at_utc_ms).map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let candidate_input = CanonicalPairCandidateInput {
            audience: PROTOCOL_AUDIENCE,
            vault_id: &request.vault_id,
            candidate_device_id: &device_id,
            candidate_signing_public_key: &signing_public_key,
            candidate_pairing_public_key: &pairing_public_key,
            pairing_nonce: &pairing_nonce,
            expires_at,
        };
        let candidate_proof = sign_canonical_pair_candidate(&candidate_input, &*keys.signing_seed)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let candidate_record = super::crypto::canonical_pair_candidate_bytes(&candidate_input)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let fingerprint = base64_url_encode(&sha256_digest(&candidate_record));
        let fingerprint = fingerprint
            .get(..12)
            .ok_or(CloudRuntimeError::IntegrityFailure)?
            .to_owned();
        let state = crate::meeting::store::CloudState {
            vault_id: request.vault_id.clone(),
            device_id: device_id.clone(),
            endpoint,
            cursor: None,
            snapshot_high_water: None,
            clock_offset_ms: 0,
            paused: true,
        };
        store.upsert_cloud_state(&state).map_err(map_store_error)?;
        Ok(CloudPairingOffer {
            protocol_version: PROTOCOL_VERSION,
            vault_id: request.vault_id,
            device_id,
            signing_public_key: base64_url_encode(&signing_public_key),
            pairing_public_key: base64_url_encode(&pairing_public_key),
            candidate_proof: base64_url_encode(&candidate_proof),
            pairing_nonce: base64_url_encode(&pairing_nonce),
            expires_at_utc_ms,
            fingerprint,
        })
    }

    pub(crate) async fn pairing_approve(
        &self,
        request: CloudPairingApproveRequest,
    ) -> Result<CloudSyncOverview, CloudRuntimeError> {
        let access = self.configured_access().await?;
        let offer = request.offer;
        if offer.protocol_version != PROTOCOL_VERSION || offer.vault_id != access.state.vault_id {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let now = adjusted_now_ms(access.state.clock_offset_ms);
        let max_expiry = now
            .checked_add(15 * 60 * 1000)
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        if offer.expires_at_utc_ms <= now || offer.expires_at_utc_ms > max_expiry {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let signing_public_key = fixed_array_32(
            base64_url_decode(&offer.signing_public_key)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
        )?;
        let pairing_public_key = fixed_array_32(
            base64_url_decode(&offer.pairing_public_key)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
        )?;
        let pairing_nonce = fixed_array_16(
            base64_url_decode(&offer.pairing_nonce)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
        )?;
        let candidate_proof = fixed_array_64(
            base64_url_decode(&offer.candidate_proof)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
        )?;
        let candidate_input = CanonicalPairCandidateInput {
            audience: PROTOCOL_AUDIENCE,
            vault_id: &offer.vault_id,
            candidate_device_id: &offer.device_id,
            candidate_signing_public_key: &signing_public_key,
            candidate_pairing_public_key: &pairing_public_key,
            pairing_nonce: &pairing_nonce,
            expires_at: u64::try_from(offer.expires_at_utc_ms)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
        };
        let candidate_record = super::crypto::canonical_pair_candidate_bytes(&candidate_input)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        if !verify_ed25519(&signing_public_key, &candidate_proof, &candidate_record) {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let (mut ephemeral_secret_key, envelope_nonce) =
            pairing_envelope_material(&access.keys.pairing_secret, &candidate_record);
        let envelope = seal_pairing_envelope(&PairingEnvelopeSealInput {
            recipient_public_key: &pairing_public_key,
            ephemeral_secret_key: &ephemeral_secret_key,
            nonce: &envelope_nonce,
            vault_root: &*access.keys.vault_root,
        });
        ephemeral_secret_key.zeroize();
        let envelope = envelope.map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let approval_input = CanonicalPairApprovalInput {
            vault_id: &access.state.vault_id,
            candidate_record: &candidate_record,
            candidate_proof: &candidate_proof,
            envelope: &envelope,
        };
        let approval_signature =
            sign_canonical_pair_approval(&approval_input, &*access.keys.signing_seed)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        self.require_request_permission(&access.state).await?;
        let credentials = credentials(&access)?;
        let key = idempotency_key(&[
            "pair",
            &access.state.vault_id,
            &offer.device_id,
            &offer.pairing_nonce,
        ])?;
        let result = access
            .client
            .pair_device(
                &credentials,
                &key,
                &PairDeviceRequest {
                    version: PROTOCOL_VERSION,
                    candidate_device_id: offer.device_id.clone(),
                    candidate_signing_public_key: offer.signing_public_key,
                    candidate_pairing_public_key: offer.pairing_public_key,
                    candidate_proof: offer.candidate_proof,
                    pairing_nonce: offer.pairing_nonce,
                    expires_at: u64::try_from(offer.expires_at_utc_ms)
                        .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
                    envelope: base64_url_encode(&envelope),
                    approval_signature: base64_url_encode(&approval_signature),
                },
            )
            .await
            .map_err(CloudRuntimeError::Client);
        self.persist_clock(&access.store, &access.client);
        let response = result?;
        if response.device_id != offer.device_id || response.status != "active" {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        self.emit_changed(None, None);
        self.overview().await
    }

    pub(crate) async fn pairing_accept(
        &self,
        request: CloudPairingAcceptRequest,
    ) -> Result<CloudSyncOverview, CloudRuntimeError> {
        self.reject_portable()?;
        let endpoint = canonical_endpoint(&request.endpoint)?;
        let store = self
            .meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        let state = store
            .cloud_state()
            .map_err(map_store_error)?
            .ok_or(CloudRuntimeError::SetupRequired)?;
        let offer = request.offer;
        if !state.paused
            || state.endpoint != endpoint
            || state.vault_id != offer.vault_id
            || state.device_id != offer.device_id
            || offer.protocol_version != PROTOCOL_VERSION
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let keys = self
            .secrets
            .cloud_sync_keys()
            .await
            .map_err(|_| CloudRuntimeError::SecretUnavailable)?;
        let expected_signing = ed25519_public_key(&*keys.signing_seed)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let expected_pairing = super::crypto::x25519_public_key(&*keys.pairing_secret)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        if base64_url_encode(&expected_signing) != offer.signing_public_key
            || base64_url_encode(&expected_pairing) != offer.pairing_public_key
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let client = self.client_for(&endpoint)?;
        client.set_clock_offset_ms(state.clock_offset_ms);
        let credentials =
            CloudCredentials::new(&state.vault_id, &state.device_id, &keys.signing_seed)
                .map_err(CloudRuntimeError::Client)?;
        let response = client
            .self_device(&credentials)
            .await
            .map_err(CloudRuntimeError::Client);
        self.persist_clock(&store, &client);
        let response = response?;
        if response.device_id != state.device_id
            || response.status != "active"
            || response.protocol_version != Some(PROTOCOL_VERSION)
            || response.signing_public_key != offer.signing_public_key
            || response.pairing_public_key != offer.pairing_public_key
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let envelope = response
            .envelope
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        let envelope =
            base64_url_decode(&envelope).map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let vault_root = open_pairing_envelope(&*keys.pairing_secret, &envelope)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        self.secrets
            .replace_cloud_vault_root(vault_root)
            .await
            .map_err(|_| CloudRuntimeError::SecretUnavailable)?;
        let mut active_state = state;
        active_state.paused = false;
        active_state.clock_offset_ms = client.clock_offset_ms();
        store
            .upsert_cloud_state(&active_state)
            .map_err(map_store_error)?;
        settings::update_settings(&self.app, |settings| {
            settings.cloud_sync.enabled = true;
            settings.cloud_sync.paused = false;
            settings.cloud_sync.consent_version = Some(CLOUD_SYNC_CONSENT_VERSION);
            settings.cloud_sync.endpoint = Some(endpoint);
        });
        self.emit_changed(None, None);
        self.overview().await
    }

    pub(crate) async fn pause(&self) -> Result<CloudSyncOverview, CloudRuntimeError> {
        let store = self
            .meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        store.set_cloud_paused(true).map_err(map_store_error)?;
        settings::update_settings(&self.app, |settings| settings.cloud_sync.paused = true);
        self.emit_changed(None, None);
        self.overview().await
    }

    pub(crate) async fn resume(&self) -> Result<CloudSyncOverview, CloudRuntimeError> {
        self.reject_portable()?;
        let store = self
            .meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        if store.cloud_state().map_err(map_store_error)?.is_none() {
            return Err(CloudRuntimeError::SetupRequired);
        }
        store.set_cloud_paused(false).map_err(map_store_error)?;
        settings::update_settings(&self.app, |settings| settings.cloud_sync.paused = false);
        self.emit_changed(None, None);
        self.overview().await
    }

    pub(crate) async fn retry(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<CloudMeetingStatus, CloudRuntimeError> {
        let store = self
            .meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        let outboxes = store
            .cloud_outboxes_for_session(session_id)
            .map_err(map_store_error)?;
        let now = utc_now_ms();
        let mut retried = false;
        for outbox in outboxes
            .iter()
            .filter(|outbox| outbox.state == CloudOutboxState::Terminal)
        {
            store
                .retry_terminal_cloud_outbox(&outbox.outbox_id, now)
                .map_err(map_store_error)?;
            retried = true;
        }
        if !retried && outboxes.is_empty() {
            return Err(CloudRuntimeError::SetupRequired);
        }
        let status = self.meeting_status_from_store(&store, session_id)?;
        self.emit_changed(Some(session_id), Some(status.state));
        Ok(status)
    }

    pub(crate) async fn conflict_resolve(
        &self,
        request: CloudConflictResolveRequest,
    ) -> Result<CloudMeetingStatus, CloudRuntimeError> {
        let store = self
            .meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        let head = store
            .cloud_head_for_session(request.session_id)
            .map_err(map_store_error)?
            .ok_or(CloudRuntimeError::Conflict)?;
        match request.choice {
            CloudConflictChoice::KeepLocal => {
                store
                    .resolve_cloud_conflict_keep_local(
                        &head.object_id,
                        stable_idempotency_value(&["keep-local", &head.object_id]),
                        utc_now_ms(),
                    )
                    .map_err(map_store_error)?;
            }
            CloudConflictChoice::UseRemote => {
                let path = store
                    .cloud_conflict_bundle_path(&head.object_id)
                    .map_err(map_store_error)?;
                let bytes = fs::read(path).map_err(|_| CloudRuntimeError::File)?;
                let bundle = CloudMeetingBundleV1::from_json_bytes(&bytes)
                    .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
                let snapshot = self
                    .meetings
                    .import_cloud_bundle(bundle)
                    .await
                    .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
                store
                    .resolve_cloud_conflict_use_remote(&head.object_id, snapshot.session_id)
                    .map_err(map_store_error)?;
            }
        }
        let status = self.meeting_status_from_store(&store, request.session_id)?;
        self.emit_changed(Some(request.session_id), Some(status.state));
        Ok(status)
    }

    pub(crate) async fn share_create(
        &self,
        request: CloudShareCreateRequest,
    ) -> Result<CloudShareResult, CloudRuntimeError> {
        self.reject_portable()?;
        let store = self.queueable_store().await?;
        let destination = PathBuf::from(&request.destination_path);
        if !destination
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("sona"))
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let share = self
            .create_share_intent(
                &store,
                request.session_id,
                request.expires_at_utc_ms,
                CloudShareContentKind::CapabilityBundle,
            )
            .await?;
        let (root, payload) = self.stage_share(&store, &share.outbox, &share.record)?;
        let writer_signature =
            self.share_writer_signature(&share.access, &share.record, &payload)?;
        let transport = worker_share_transport(&share.record, &payload, &writer_signature)?;
        let validated = parse_worker_share_transport(transport)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        write_share_file(
            &destination,
            &root,
            &validated.header,
            &validated.ciphertext_frames,
        )
        .map_err(|_| CloudRuntimeError::File)?;
        self.emit_changed(Some(request.session_id), Some(CloudObjectState::Queued));
        Ok(CloudShareResult {
            share_id: share.record.share_id,
            expires_at_utc_ms: share.record.expires_at_utc_ms,
            file_path: request.destination_path,
        })
    }

    pub(crate) async fn browser_share_create(
        &self,
        request: CloudBrowserShareCreateRequest,
    ) -> Result<CloudBrowserShareResult, CloudRuntimeError> {
        self.reject_portable()?;
        let store = self.queueable_store().await?;
        let share = self
            .create_share_intent(
                &store,
                request.session_id,
                request.expires_at_utc_ms,
                CloudShareContentKind::BrowserMarkdown,
            )
            .await?;
        let (root, _) = self.stage_share(&store, &share.outbox, &share.record)?;
        let endpoint = share.access.state.endpoint.trim_end_matches('/');
        let share_url = format!(
            "{endpoint}/s/{}#{}",
            share.record.share_id,
            base64_url_encode(&root)
        );
        self.emit_changed(Some(request.session_id), Some(CloudObjectState::Queued));
        Ok(CloudBrowserShareResult {
            share_id: share.record.share_id,
            expires_at_utc_ms: share.record.expires_at_utc_ms,
            share_url,
            trust_disclosure: BROWSER_SHARE_TRUST_DISCLOSURE.to_owned(),
        })
    }

    pub(crate) async fn share_revoke(
        &self,
        request: CloudShareRevokeRequest,
    ) -> Result<CloudSyncOverview, CloudRuntimeError> {
        let store = self
            .meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)?;
        let current = store
            .cloud_share(&request.share_id)
            .map_err(map_store_error)?
            .ok_or(CloudRuntimeError::SetupRequired)?;
        if current.state == CloudShareState::Revoked {
            return self.overview().await;
        }
        if let Some(outbox_id) = &current.outbox_id {
            let _ = store.cancel_cloud_outbox(outbox_id);
        }
        let revoked_at_utc_ms = utc_now_ms();
        let revoked = store
            .revoke_cloud_share(&request.share_id, revoked_at_utc_ms)
            .map_err(map_store_error)?;
        let outbox = store
            .enqueue_cloud_outbox(CloudOutboxInput {
                kind: CloudOutboxKind::Share,
                object_id: revoked.share_id.clone(),
                source_session_id: None,
                source_revision: None,
                base_remote_revision_id: None,
                share_content_kind: Some(revoked.content_kind),
                remote_revision_id: None,
                idempotency_key: stable_idempotency_value(&[
                    "share-revoke",
                    &revoked.share_id,
                    &revoked_at_utc_ms.to_string(),
                ]),
                next_attempt_utc_ms: revoked_at_utc_ms,
            })
            .map_err(map_store_error)?;
        store
            .update_cloud_share(
                &revoked.share_id,
                CloudShareUpdate {
                    expires_at_utc_ms: revoked.expires_at_utc_ms,
                    state: CloudShareState::Revoked,
                    outbox_id: Some(outbox.outbox_id),
                    revoked_at_utc_ms: revoked.revoked_at_utc_ms,
                },
            )
            .map_err(map_store_error)?;
        self.emit_changed(
            revoked.source_session_id,
            Some(CloudObjectState::PendingDeletion),
        );
        self.overview().await
    }

    pub(crate) async fn share_import(
        &self,
        request: CloudShareImportRequest,
    ) -> Result<CloudShareImportResult, CloudRuntimeError> {
        let path = Path::new(&request.path);
        if !path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("sona"))
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let file = read_share_file(path).map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let bundle = decrypt_capability_bundle(&file)?;
        let snapshot = self
            .meetings
            .import_cloud_bundle(bundle)
            .await
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        crate::show_meeting_destination(
            &self.app,
            MeetingNavigationDestination::Session,
            Some(&snapshot),
        );
        self.emit_changed(Some(snapshot.session_id), Some(CloudObjectState::Committed));
        Ok(CloudShareImportResult {
            session_id: snapshot.session_id,
        })
    }

    pub(crate) async fn opened_share_file(&self, path: PathBuf) -> Result<(), CloudRuntimeError> {
        self.share_import(CloudShareImportRequest {
            path: path.to_string_lossy().into_owned(),
        })
        .await
        .map(|_| ())
    }

    async fn sync_once(&self) -> Result<(), CloudRuntimeError> {
        let Some(access) = self.active_access().await? else {
            return Ok(());
        };
        if !self.ensure_capabilities(&access).await? {
            return Ok(());
        }
        self.drain_outbox(&access).await?;
        if self.request_permitted(&access.state).await {
            self.pull_changes(&access).await?;
        }
        Ok(())
    }

    async fn active_access(&self) -> Result<Option<CloudAccess>, CloudRuntimeError> {
        if self.stopped.load(Ordering::Acquire) || portable::is_portable() {
            return Ok(None);
        }
        let cloud_settings = settings::get_settings(&self.app).cloud_sync;
        if !cloud_settings.enabled
            || !cloud_settings.has_current_consent()
            || cloud_settings.paused
            || self.meetings.is_capture_active()
        {
            return Ok(None);
        }
        let endpoint = match cloud_settings.endpoint() {
            Ok(Some(endpoint)) => endpoint,
            Ok(None) | Err(_) => return Ok(None),
        };
        let store = match self.meetings.cloud_store().await {
            Ok(store) => store,
            Err(_) => return Ok(None),
        };
        let state = match store.cloud_state().map_err(map_store_error)? {
            Some(state) if !state.paused && state.endpoint == endpoint => state,
            _ => return Ok(None),
        };
        let keys = match self.secrets.cloud_sync_keys().await {
            Ok(keys) => keys,
            Err(_) => return Ok(None),
        };
        let client = self.client_for(&endpoint)?;
        client.set_clock_offset_ms(state.clock_offset_ms);
        Ok(Some(CloudAccess {
            store,
            state,
            client,
            keys,
        }))
    }

    async fn configured_access(&self) -> Result<CloudAccess, CloudRuntimeError> {
        self.reject_portable()?;
        self.active_access()
            .await?
            .ok_or(CloudRuntimeError::SetupRequired)
    }

    async fn queueable_store(&self) -> Result<Arc<MeetingStore>, CloudRuntimeError> {
        self.reject_portable()?;
        let cloud_settings = settings::get_settings(&self.app).cloud_sync;
        if !cloud_settings.enabled || !cloud_settings.has_current_consent() || cloud_settings.paused
        {
            return Err(CloudRuntimeError::SetupRequired);
        }
        self.meetings
            .cloud_store()
            .await
            .map_err(|_| CloudRuntimeError::SetupRequired)
    }

    fn reject_portable(&self) -> Result<(), CloudRuntimeError> {
        if portable::is_portable() {
            return Err(CloudRuntimeError::PortableUnavailable);
        }
        Ok(())
    }

    fn client_for(&self, endpoint: &str) -> Result<CloudClient, CloudRuntimeError> {
        let mut slot = self
            .client
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(existing) = slot
            .as_ref()
            .filter(|existing| existing.endpoint == endpoint)
        {
            return Ok(existing.client.clone());
        }
        let client = CloudClient::new(endpoint).map_err(CloudRuntimeError::Client)?;
        *slot = Some(EndpointClient {
            endpoint: endpoint.to_owned(),
            client: client.clone(),
        });
        Ok(client)
    }

    async fn request_permitted(&self, state: &crate::meeting::store::CloudState) -> bool {
        if self.stopped.load(Ordering::Acquire)
            || portable::is_portable()
            || self.meetings.is_capture_active()
            || state.paused
        {
            return false;
        }
        let cloud_settings = settings::get_settings(&self.app).cloud_sync;
        if !cloud_settings.enabled || !cloud_settings.has_current_consent() || cloud_settings.paused
        {
            return false;
        }
        let Ok(Some(endpoint)) = cloud_settings.endpoint() else {
            return false;
        };
        if endpoint != state.endpoint {
            return false;
        }
        self.secrets.cloud_sync_keys().await.is_ok()
    }

    async fn require_request_permission(
        &self,
        state: &crate::meeting::store::CloudState,
    ) -> Result<(), CloudRuntimeError> {
        if self.request_permitted(state).await {
            Ok(())
        } else if portable::is_portable() {
            Err(CloudRuntimeError::PortableUnavailable)
        } else {
            Err(CloudRuntimeError::Deferred)
        }
    }

    fn persist_clock(&self, store: &MeetingStore, client: &CloudClient) {
        if let Some(observation) = client.latest_server_date() {
            let _ = store.set_cloud_clock_offset(observation.clock_offset_ms);
        }
    }

    fn persist_capabilities(
        &self,
        store: &MeetingStore,
        endpoint: &str,
        capabilities: &CloudCapabilities,
    ) -> Result<(), CloudRuntimeError> {
        let capabilities_json =
            serde_json::to_string(capabilities).map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        store
            .upsert_cloud_capabilities(&CloudCapabilitiesCache {
                endpoint: endpoint.to_owned(),
                capabilities_json,
                fetched_at_utc_ms: utc_now_ms(),
            })
            .map_err(map_store_error)
    }

    async fn ensure_capabilities(&self, access: &CloudAccess) -> Result<bool, CloudRuntimeError> {
        if let Some(cache) = access
            .store
            .cloud_capabilities(&access.state.endpoint)
            .map_err(map_store_error)?
            .filter(|cache| {
                utc_now_ms().saturating_sub(cache.fetched_at_utc_ms) <= CAPABILITIES_CACHE_MS
            })
        {
            let capabilities: CloudCapabilities = serde_json::from_str(&cache.capabilities_json)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
            validate_capabilities(&capabilities)?;
            return Ok(true);
        }
        if !self.request_permitted(&access.state).await {
            return Ok(false);
        }
        let credentials = credentials(access)?;
        let result = access
            .client
            .capabilities(&credentials)
            .await
            .map_err(CloudRuntimeError::Client);
        self.persist_clock(&access.store, &access.client);
        let capabilities = result?;
        validate_capabilities(&capabilities)?;
        self.persist_capabilities(&access.store, &access.state.endpoint, &capabilities)?;
        Ok(true)
    }

    async fn queue_current_session(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<(), CloudRuntimeError> {
        let Some(access) = self.active_access().await? else {
            return Ok(());
        };
        let snapshot = match access.store.session_snapshot(session_id) {
            Ok(snapshot) => snapshot,
            Err(StoreError::NotFound) => return Ok(()),
            Err(error) => return Err(map_store_error(error)),
        };
        if !matches!(
            snapshot.phase,
            MeetingPhase::ReviewReady | MeetingPhase::RecoveryRequired
        ) {
            return Ok(());
        }
        let existing_head = access
            .store
            .cloud_head_for_session(session_id)
            .map_err(map_store_error)?;
        let object_id = match existing_head.as_ref() {
            Some(head) if head.tombstone => return Ok(()),
            Some(head) => head.object_id.clone(),
            None => {
                let object_id = random_opaque_id()?;
                access
                    .store
                    .upsert_cloud_head(&CloudHead {
                        object_id: object_id.clone(),
                        source_session_id: Some(session_id),
                        remote_revision_id: None,
                        tombstone: false,
                        acknowledged_revision_id: None,
                        change_sequence: 0,
                    })
                    .map_err(map_store_error)?;
                object_id
            }
        };
        let mut base_remote_revision_id = existing_head
            .as_ref()
            .and_then(|head| head.remote_revision_id.clone());
        let outboxes = access
            .store
            .cloud_outboxes_for_session(session_id)
            .map_err(map_store_error)?;
        if let Some(previous) = outboxes.iter().rev().find(|outbox| {
            outbox.kind == CloudOutboxKind::Object
                && outbox.object_id == object_id
                && matches!(
                    outbox.state,
                    CloudOutboxState::Pending | CloudOutboxState::Claimed
                )
                && outbox.remote_revision_id.is_some()
        }) {
            base_remote_revision_id = previous.remote_revision_id.clone();
        }
        let revision = random_opaque_id()?;
        let idempotency_key =
            stable_idempotency_value(&["object", &object_id, &snapshot.revision.to_string()]);
        access
            .store
            .enqueue_cloud_outbox(CloudOutboxInput {
                kind: CloudOutboxKind::Object,
                object_id,
                source_session_id: Some(session_id),
                source_revision: Some(snapshot.revision),
                base_remote_revision_id,
                share_content_kind: None,
                remote_revision_id: Some(revision),
                idempotency_key,
                next_attempt_utc_ms: utc_now_ms(),
            })
            .map_err(map_store_error)?;
        self.emit_changed(Some(session_id), Some(CloudObjectState::Queued));
        Ok(())
    }

    async fn drain_outbox(&self, access: &CloudAccess) -> Result<(), CloudRuntimeError> {
        let due = access
            .store
            .due_cloud_outbox(utc_now_ms(), 16)
            .map_err(map_store_error)?;
        for due_record in due {
            if !self.request_permitted(&access.state).await {
                return Ok(());
            }
            let claim_token = random_opaque_id()?;
            let Some(record) = access
                .store
                .claim_cloud_outbox(&due_record.outbox_id, &claim_token, utc_now_ms())
                .map_err(map_store_error)?
            else {
                continue;
            };
            if !self.request_permitted(&access.state).await {
                let _ = access.store.release_cloud_outbox_claim(
                    &record.outbox_id,
                    &claim_token,
                    utc_now_ms(),
                );
                return Ok(());
            }
            let result = match record.kind {
                CloudOutboxKind::Object => self.process_object(access, &record, &claim_token).await,
                CloudOutboxKind::Tombstone => {
                    self.process_tombstone(access, &record, &claim_token).await
                }
                CloudOutboxKind::Share => self.process_share(access, &record, &claim_token).await,
            };
            if let Err(error) = result {
                self.handle_outbox_failure(access, &record, &claim_token, error)
                    .await?;
            }
        }
        Ok(())
    }

    async fn process_object(
        &self,
        access: &CloudAccess,
        original: &CloudOutboxRecord,
        claim_token: &str,
    ) -> Result<(), CloudRuntimeError> {
        let mut record = original.clone();
        let revision_id = record
            .remote_revision_id
            .clone()
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        self.stage_object(&access.store, &access.state, &access.keys, &record)?;
        if !self.request_permitted(&access.state).await {
            return Err(CloudRuntimeError::Deferred);
        }
        if record.upload_id.is_none() {
            let upload_id = random_opaque_id()?;
            record = access
                .store
                .set_cloud_outbox_upload_id(&record.outbox_id, claim_token, upload_id)
                .map_err(map_store_error)?;
        }
        let payload = load_staged_payload(&access.store, &record)?;
        let upload_id = record
            .upload_id
            .clone()
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        let plan = self.object_upload_plan(access, &record, &payload, &upload_id)?;
        let credentials = credentials(access)?;
        let accepted;
        if original.upload_id.is_some() {
            self.require_request_permission(&access.state).await?;
            let status = access.client.upload_status(&credentials, &upload_id).await;
            self.persist_clock(&access.store, &access.client);
            match status {
                Ok(status) if status.upload_id == upload_id && status.state == "committed" => {
                    self.complete_object(
                        access,
                        &record,
                        claim_token,
                        status.committed_sequence.unwrap_or(0),
                    )?;
                    return Ok(());
                }
                Ok(status) if status.upload_id == upload_id && status.state == "active" => {
                    accepted = status.accepted_indexes;
                }
                Ok(_) => return Err(CloudRuntimeError::IntegrityFailure),
                Err(CloudClientError::Api(error)) if error.code == CloudErrorCode::NotFound => {
                    self.require_request_permission(&access.state).await?;
                    let created = access
                        .client
                        .create_object_upload(
                            &credentials,
                            &operation_key(&record, "create")?,
                            &plan,
                        )
                        .await
                        .map_err(CloudRuntimeError::Client);
                    self.persist_clock(&access.store, &access.client);
                    accepted = created?.accepted_indexes;
                }
                Err(error) => return Err(CloudRuntimeError::Client(error)),
            }
        } else {
            self.require_request_permission(&access.state).await?;
            let created = access
                .client
                .create_object_upload(&credentials, &operation_key(&record, "create")?, &plan)
                .await
                .map_err(CloudRuntimeError::Client);
            self.persist_clock(&access.store, &access.client);
            accepted = created?.accepted_indexes;
        }
        self.record_accepted_indexes(&access.store, &record, claim_token, &payload, &accepted)?;
        for chunk in access
            .store
            .missing_cloud_outbox_chunks(&record.outbox_id)
            .map_err(map_store_error)?
        {
            self.require_request_permission(&access.state).await?;
            let staged = payload
                .chunks
                .iter()
                .find(|staged| staged.index == chunk.chunk_index)
                .ok_or(CloudRuntimeError::IntegrityFailure)?;
            let response = access
                .client
                .upload_chunk(
                    &credentials,
                    &operation_key(&record, &format!("chunk-{}", chunk.chunk_index))?,
                    &upload_id,
                    chunk.chunk_index,
                    staged.bytes.clone(),
                )
                .await
                .map_err(CloudRuntimeError::Client);
            self.persist_clock(&access.store, &access.client);
            let response = response?;
            if response.upload_id != upload_id
                || response.index != chunk.chunk_index
                || !response.accepted
            {
                return Err(CloudRuntimeError::IntegrityFailure);
            }
            access
                .store
                .mark_cloud_outbox_chunk_accepted(
                    &record.outbox_id,
                    chunk.chunk_index,
                    claim_token,
                    utc_now_ms(),
                )
                .map_err(map_store_error)?;
        }
        self.require_request_permission(&access.state).await?;
        let committed = access
            .client
            .commit_upload(&credentials, &operation_key(&record, "commit")?, &upload_id)
            .await
            .map_err(CloudRuntimeError::Client);
        self.persist_clock(&access.store, &access.client);
        let committed = committed?;
        if committed.upload_id != upload_id
            || committed.state != "committed"
            || committed.revision_id.as_deref() != Some(revision_id.as_str())
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        self.complete_object(
            access,
            &record,
            claim_token,
            committed
                .change_sequence
                .ok_or(CloudRuntimeError::IntegrityFailure)?,
        )
    }

    fn complete_object(
        &self,
        access: &CloudAccess,
        record: &CloudOutboxRecord,
        claim_token: &str,
        sequence: u64,
    ) -> Result<(), CloudRuntimeError> {
        let revision_id = record
            .remote_revision_id
            .clone()
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        access
            .store
            .upsert_cloud_head(&CloudHead {
                object_id: record.object_id.clone(),
                source_session_id: record.source_session_id,
                remote_revision_id: Some(revision_id.clone()),
                tombstone: false,
                acknowledged_revision_id: Some(revision_id.clone()),
                change_sequence: sequence,
            })
            .map_err(map_store_error)?;
        access
            .store
            .update_cloud_outbox(
                &record.outbox_id,
                claim_token,
                CloudOutboxUpdate {
                    state: CloudOutboxState::Completed,
                    remote_revision_id: Some(revision_id),
                    upload_id: record.upload_id.clone(),
                    terminal_error: None,
                },
            )
            .map_err(map_store_error)?;
        self.emit_changed(record.source_session_id, Some(CloudObjectState::Committed));
        Ok(())
    }

    async fn process_tombstone(
        &self,
        access: &CloudAccess,
        record: &CloudOutboxRecord,
        claim_token: &str,
    ) -> Result<(), CloudRuntimeError> {
        let Some(base_revision_id) = record.base_remote_revision_id.as_deref() else {
            access
                .store
                .update_cloud_outbox(
                    &record.outbox_id,
                    claim_token,
                    CloudOutboxUpdate {
                        state: CloudOutboxState::Completed,
                        remote_revision_id: record.remote_revision_id.clone(),
                        upload_id: None,
                        terminal_error: None,
                    },
                )
                .map_err(map_store_error)?;
            return Ok(());
        };
        let tombstone_revision_id = record
            .remote_revision_id
            .as_deref()
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        let tombstone_input = CanonicalTombstoneInput {
            vault_id: &access.state.vault_id,
            object_id: &record.object_id,
            tombstone_revision_id,
            base_revision_id,
            reason: "user_request",
            format_version: u64::from(PROTOCOL_VERSION),
        };
        let signature = sign_canonical_tombstone(&tombstone_input, &*access.keys.signing_seed)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        self.require_request_permission(&access.state).await?;
        let credentials = credentials(access)?;
        let response = access
            .client
            .tombstone_object(
                &credentials,
                &operation_key(record, "tombstone")?,
                &record.object_id,
                &TombstoneRequest {
                    tombstone_revision_id: tombstone_revision_id.to_owned(),
                    base_revision_id: base_revision_id.to_owned(),
                    format_version: PROTOCOL_VERSION,
                    reason: TombstoneReason::UserRequest,
                    writer_signature: base64_url_encode(&signature),
                },
            )
            .await
            .map_err(CloudRuntimeError::Client);
        self.persist_clock(&access.store, &access.client);
        let response = response?;
        if response.object_id != record.object_id
            || response.revision_id != tombstone_revision_id
            || !response.tombstone
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        access
            .store
            .upsert_cloud_head(&CloudHead {
                object_id: record.object_id.clone(),
                source_session_id: record.source_session_id,
                remote_revision_id: Some(response.revision_id.clone()),
                tombstone: true,
                acknowledged_revision_id: Some(response.revision_id.clone()),
                change_sequence: response.change_sequence,
            })
            .map_err(map_store_error)?;
        access
            .store
            .update_cloud_outbox(
                &record.outbox_id,
                claim_token,
                CloudOutboxUpdate {
                    state: CloudOutboxState::Completed,
                    remote_revision_id: Some(response.revision_id),
                    upload_id: None,
                    terminal_error: None,
                },
            )
            .map_err(map_store_error)?;
        self.emit_changed(record.source_session_id, Some(CloudObjectState::Deleted));
        Ok(())
    }

    async fn process_share(
        &self,
        access: &CloudAccess,
        original: &CloudOutboxRecord,
        claim_token: &str,
    ) -> Result<(), CloudRuntimeError> {
        let share = access
            .store
            .cloud_share_for_outbox(&original.outbox_id)
            .map_err(map_store_error)?
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        if share.state == CloudShareState::Revoked {
            self.require_request_permission(&access.state).await?;
            let credentials = credentials(access)?;
            let response = access
                .client
                .revoke_share(
                    &credentials,
                    &operation_key(original, "revoke")?,
                    &share.share_id,
                )
                .await
                .map_err(CloudRuntimeError::Client);
            self.persist_clock(&access.store, &access.client);
            let response = response?;
            if response.share_id != share.share_id || response.state != "revoked" {
                return Err(CloudRuntimeError::IntegrityFailure);
            }
            access
                .store
                .update_cloud_outbox(
                    &original.outbox_id,
                    claim_token,
                    CloudOutboxUpdate {
                        state: CloudOutboxState::Completed,
                        remote_revision_id: None,
                        upload_id: original.upload_id.clone(),
                        terminal_error: None,
                    },
                )
                .map_err(map_store_error)?;
            self.emit_changed(share.source_session_id, Some(CloudObjectState::Deleted));
            return Ok(());
        }
        if share.state != CloudShareState::Pending || original.object_id != share.share_id {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let mut record = original.clone();
        self.stage_share(&access.store, &record, &share)?;
        if !self.request_permitted(&access.state).await {
            return Err(CloudRuntimeError::Deferred);
        }
        if record.upload_id.is_none() {
            record = access
                .store
                .set_cloud_outbox_upload_id(&record.outbox_id, claim_token, random_opaque_id()?)
                .map_err(map_store_error)?;
        }
        let payload = load_staged_payload(&access.store, &record)?;
        let upload_id = record
            .upload_id
            .clone()
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        let plan = self.share_upload_plan(access, &share, &payload, &upload_id)?;
        let credentials = credentials(access)?;
        let accepted;
        if original.upload_id.is_some() {
            self.require_request_permission(&access.state).await?;
            let status = access.client.upload_status(&credentials, &upload_id).await;
            self.persist_clock(&access.store, &access.client);
            match status {
                Ok(status) if status.upload_id == upload_id && status.state == "committed" => {
                    self.complete_share(access, &record, &share, claim_token)?;
                    return Ok(());
                }
                Ok(status) if status.upload_id == upload_id && status.state == "active" => {
                    accepted = status.accepted_indexes;
                }
                Ok(_) => return Err(CloudRuntimeError::IntegrityFailure),
                Err(CloudClientError::Api(error)) if error.code == CloudErrorCode::NotFound => {
                    self.require_request_permission(&access.state).await?;
                    let created = access
                        .client
                        .create_share_upload(
                            &credentials,
                            &operation_key(&record, "create")?,
                            &plan,
                        )
                        .await
                        .map_err(CloudRuntimeError::Client);
                    self.persist_clock(&access.store, &access.client);
                    accepted = created?.accepted_indexes;
                }
                Err(error) => return Err(CloudRuntimeError::Client(error)),
            }
        } else {
            self.require_request_permission(&access.state).await?;
            let created = access
                .client
                .create_share_upload(&credentials, &operation_key(&record, "create")?, &plan)
                .await
                .map_err(CloudRuntimeError::Client);
            self.persist_clock(&access.store, &access.client);
            let created = created?;
            if created.share_id.as_deref() != Some(share.share_id.as_str()) {
                return Err(CloudRuntimeError::IntegrityFailure);
            }
            accepted = created.accepted_indexes;
        }
        self.record_accepted_indexes(&access.store, &record, claim_token, &payload, &accepted)?;
        for chunk in access
            .store
            .missing_cloud_outbox_chunks(&record.outbox_id)
            .map_err(map_store_error)?
        {
            self.require_request_permission(&access.state).await?;
            let staged = payload
                .chunks
                .iter()
                .find(|staged| staged.index == chunk.chunk_index)
                .ok_or(CloudRuntimeError::IntegrityFailure)?;
            let response = access
                .client
                .upload_chunk(
                    &credentials,
                    &operation_key(&record, &format!("chunk-{}", chunk.chunk_index))?,
                    &upload_id,
                    chunk.chunk_index,
                    staged.bytes.clone(),
                )
                .await
                .map_err(CloudRuntimeError::Client);
            self.persist_clock(&access.store, &access.client);
            let response = response?;
            if response.upload_id != upload_id
                || response.index != chunk.chunk_index
                || !response.accepted
            {
                return Err(CloudRuntimeError::IntegrityFailure);
            }
            access
                .store
                .mark_cloud_outbox_chunk_accepted(
                    &record.outbox_id,
                    chunk.chunk_index,
                    claim_token,
                    utc_now_ms(),
                )
                .map_err(map_store_error)?;
        }
        self.require_request_permission(&access.state).await?;
        let committed = access
            .client
            .commit_upload(&credentials, &operation_key(&record, "commit")?, &upload_id)
            .await
            .map_err(CloudRuntimeError::Client);
        self.persist_clock(&access.store, &access.client);
        let committed = committed?;
        if committed.upload_id != upload_id
            || committed.state != "active"
            || committed.share_id.as_deref() != Some(share.share_id.as_str())
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        self.complete_share(access, &record, &share, claim_token)
    }

    fn complete_share(
        &self,
        access: &CloudAccess,
        record: &CloudOutboxRecord,
        share: &CloudShareRecord,
        claim_token: &str,
    ) -> Result<(), CloudRuntimeError> {
        access
            .store
            .update_cloud_share(
                &share.share_id,
                CloudShareUpdate {
                    expires_at_utc_ms: share.expires_at_utc_ms,
                    state: CloudShareState::Active,
                    outbox_id: Some(record.outbox_id.clone()),
                    revoked_at_utc_ms: None,
                },
            )
            .map_err(map_store_error)?;
        access
            .store
            .update_cloud_outbox(
                &record.outbox_id,
                claim_token,
                CloudOutboxUpdate {
                    state: CloudOutboxState::Completed,
                    remote_revision_id: None,
                    upload_id: record.upload_id.clone(),
                    terminal_error: None,
                },
            )
            .map_err(map_store_error)?;
        self.emit_changed(share.source_session_id, Some(CloudObjectState::Committed));
        Ok(())
    }

    fn record_accepted_indexes(
        &self,
        store: &MeetingStore,
        record: &CloudOutboxRecord,
        claim_token: &str,
        payload: &StagedPayload,
        accepted: &[u32],
    ) -> Result<(), CloudRuntimeError> {
        for index in accepted {
            if !payload.chunks.iter().any(|chunk| chunk.index == *index) {
                return Err(CloudRuntimeError::IntegrityFailure);
            }
            store
                .mark_cloud_outbox_chunk_accepted(
                    &record.outbox_id,
                    *index,
                    claim_token,
                    utc_now_ms(),
                )
                .map_err(map_store_error)?;
        }
        Ok(())
    }

    async fn handle_outbox_failure(
        &self,
        access: &CloudAccess,
        record: &CloudOutboxRecord,
        claim_token: &str,
        error: CloudRuntimeError,
    ) -> Result<(), CloudRuntimeError> {
        if matches!(error, CloudRuntimeError::Deferred) {
            let _ = access.store.release_cloud_outbox_claim(
                &record.outbox_id,
                claim_token,
                utc_now_ms(),
            );
            return Ok(());
        }
        if let Some((retry_after, terminal)) = retry_directive(&error, record.attempt_count) {
            if let Some(next_attempt_utc_ms) = retry_after {
                access
                    .store
                    .retry_cloud_outbox(
                        &record.outbox_id,
                        claim_token,
                        "retry",
                        next_attempt_utc_ms,
                    )
                    .map_err(map_store_error)?;
                self.emit_changed(record.source_session_id, Some(CloudObjectState::Queued));
                return Ok(());
            }
            let terminal_error = terminal.unwrap_or("integrity_failure").to_owned();
            access
                .store
                .update_cloud_outbox(
                    &record.outbox_id,
                    claim_token,
                    CloudOutboxUpdate {
                        state: CloudOutboxState::Terminal,
                        remote_revision_id: record.remote_revision_id.clone(),
                        upload_id: record.upload_id.clone(),
                        terminal_error: Some(terminal_error.clone()),
                    },
                )
                .map_err(map_store_error)?;
            let state = terminal_object_state(&terminal_error);
            self.emit_changed(record.source_session_id, Some(state));
            return Ok(());
        }
        Err(CloudRuntimeError::IntegrityFailure)
    }

    fn stage_object(
        &self,
        store: &MeetingStore,
        state: &crate::meeting::store::CloudState,
        keys: &CloudSyncKeys,
        record: &CloudOutboxRecord,
    ) -> Result<(), CloudRuntimeError> {
        if !store
            .cloud_outbox_chunks(&record.outbox_id)
            .map_err(map_store_error)?
            .is_empty()
        {
            load_staged_payload(store, record)?;
            return Ok(());
        }
        let session_id = record
            .source_session_id
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        let revision_id = record
            .remote_revision_id
            .as_deref()
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        let bundle =
            CloudMeetingBundleV1::export_from_store(store, session_id).map_err(map_store_error)?;
        let mut plaintext = bundle.to_json_bytes().map_err(map_store_error)?;
        let result = (|| {
            if plaintext.is_empty() || plaintext.len() > MAX_BUNDLE_BYTES {
                return Err(CloudRuntimeError::IntegrityFailure);
            }
            let chunk_count = u32::try_from(plaintext.chunks(MAX_PLAINTEXT_CHUNK_BYTES).len())
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
            let manifest_plaintext = serde_json::to_vec(&ObjectPayloadManifest {
                version: PROTOCOL_VERSION,
                kind: CAPABILITY_SHARE_KIND.to_owned(),
                source_format: OBJECT_SOURCE_FORMAT.to_owned(),
                chunk_count,
                plaintext_bytes: u64::try_from(plaintext.len())
                    .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
                plaintext_sha256: sha256_base64url(&plaintext),
            })
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
            let manifest_context = ObjectRevisionCryptoContext {
                vault_id: &state.vault_id,
                object_id: &record.object_id,
                revision_id,
                index: 0,
                total: u64::from(chunk_count),
                content_kind: ObjectContentKind::Manifest,
                source_format: OBJECT_SOURCE_FORMAT,
            };
            let manifest = seal_object_revision_payload(
                &*keys.vault_root,
                &manifest_context,
                &random_array::<12>()?,
                &manifest_plaintext,
            )
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
            let directory = store
                .cloud_outbox_payload_directory(&record.outbox_id)
                .map_err(map_store_error)?;
            write_staged_file(&directory, OBJECT_MANIFEST_FILE, &manifest)?;
            let mut chunks = Vec::with_capacity(
                usize::try_from(chunk_count).map_err(|_| CloudRuntimeError::IntegrityFailure)?,
            );
            for (index, plaintext_chunk) in plaintext.chunks(MAX_PLAINTEXT_CHUNK_BYTES).enumerate()
            {
                let index =
                    u32::try_from(index).map_err(|_| CloudRuntimeError::IntegrityFailure)?;
                let context = ObjectRevisionCryptoContext {
                    vault_id: &state.vault_id,
                    object_id: &record.object_id,
                    revision_id,
                    index: u64::from(index),
                    total: u64::from(chunk_count),
                    content_kind: ObjectContentKind::Chunk,
                    source_format: OBJECT_SOURCE_FORMAT,
                };
                let encrypted = seal_object_revision_payload(
                    &*keys.vault_root,
                    &context,
                    &random_array::<12>()?,
                    plaintext_chunk,
                )
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
                write_staged_file(&directory, &chunk_file_name(index), &encrypted)?;
                chunks.push(CloudOutboxChunk {
                    chunk_index: index,
                    size_bytes: u64::try_from(encrypted.len())
                        .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
                    sha256: sha256_base64url(&encrypted),
                    accepted: false,
                });
            }
            store
                .stage_cloud_outbox_chunks(&record.outbox_id, &chunks)
                .map_err(map_store_error)?;
            Ok(())
        })();
        plaintext.zeroize();
        result
    }

    fn stage_share(
        &self,
        store: &MeetingStore,
        record: &CloudOutboxRecord,
        share: &CloudShareRecord,
    ) -> Result<([u8; 32], StagedPayload), CloudRuntimeError> {
        let root = fixed_array_32(
            base64_url_decode(&share.encrypted_link_material)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
        )?;
        if share.outbox_id.as_deref() != Some(record.outbox_id.as_str())
            || record.share_content_kind != Some(share.content_kind)
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        if !store
            .cloud_outbox_chunks(&record.outbox_id)
            .map_err(map_store_error)?
            .is_empty()
        {
            return Ok((root, load_staged_payload(store, record)?));
        }
        let session_id = share
            .source_session_id
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        let (mut plaintext, manifest_plaintext) = match share.content_kind {
            CloudShareContentKind::CapabilityBundle => {
                let bundle = CloudMeetingBundleV1::export_from_store(store, session_id)
                    .map_err(map_store_error)?;
                let plaintext = bundle.to_json_bytes().map_err(map_store_error)?;
                let chunk_count = u32::try_from(plaintext.chunks(MAX_PLAINTEXT_CHUNK_BYTES).len())
                    .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
                let manifest = serde_json::to_vec(&CapabilityShareManifest {
                    version: PROTOCOL_VERSION,
                    kind: CAPABILITY_SHARE_KIND.to_owned(),
                    source_format: OBJECT_SOURCE_FORMAT.to_owned(),
                    chunk_count,
                    plaintext_bytes: u64::try_from(plaintext.len())
                        .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
                    plaintext_sha256: sha256_base64url(&plaintext),
                })
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
                (plaintext, manifest)
            }
            CloudShareContentKind::BrowserMarkdown => {
                let review = store.review_snapshot(session_id).map_err(map_store_error)?;
                let (title, markdown) = strict_browser_markdown(&review)?;
                let chunk_count = u32::try_from(markdown.chunks(MAX_PLAINTEXT_CHUNK_BYTES).len())
                    .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
                let manifest = serde_json::to_vec(&BrowserShareManifest {
                    version: PROTOCOL_VERSION,
                    kind: BROWSER_SHARE_KIND.to_owned(),
                    source_format: BROWSER_SOURCE_FORMAT.to_owned(),
                    title,
                    chunk_count,
                    plaintext_bytes: u64::try_from(markdown.len())
                        .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
                })
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
                (markdown, manifest)
            }
        };
        let result = (|| {
            if plaintext.is_empty() || plaintext.len() > MAX_SHARE_PLAINTEXT_BYTES {
                return Err(CloudRuntimeError::IntegrityFailure);
            }
            let chunk_count = u32::try_from(plaintext.chunks(MAX_PLAINTEXT_CHUNK_BYTES).len())
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
            let manifest = seal_share_payload(
                &root,
                &SharePayloadContext {
                    share_id: &share.share_id,
                    index: 0,
                    total: u64::from(chunk_count),
                    domain: SharePayloadDomain::Manifest,
                },
                &random_array::<12>()?,
                &manifest_plaintext,
            )
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
            let directory = store
                .cloud_outbox_payload_directory(&record.outbox_id)
                .map_err(map_store_error)?;
            write_staged_file(&directory, OBJECT_MANIFEST_FILE, &manifest)?;
            let mut chunks = Vec::with_capacity(
                usize::try_from(chunk_count).map_err(|_| CloudRuntimeError::IntegrityFailure)?,
            );
            for (index, plaintext_chunk) in plaintext.chunks(MAX_PLAINTEXT_CHUNK_BYTES).enumerate()
            {
                let index =
                    u32::try_from(index).map_err(|_| CloudRuntimeError::IntegrityFailure)?;
                let encrypted = seal_share_payload(
                    &root,
                    &SharePayloadContext {
                        share_id: &share.share_id,
                        index: u64::from(index),
                        total: u64::from(chunk_count),
                        domain: SharePayloadDomain::Chunk,
                    },
                    &random_array::<12>()?,
                    plaintext_chunk,
                )
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
                write_staged_file(&directory, &chunk_file_name(index), &encrypted)?;
                chunks.push(CloudOutboxChunk {
                    chunk_index: index,
                    size_bytes: u64::try_from(encrypted.len())
                        .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
                    sha256: sha256_base64url(&encrypted),
                    accepted: false,
                });
            }
            store
                .stage_cloud_outbox_chunks(&record.outbox_id, &chunks)
                .map_err(map_store_error)?;
            load_staged_payload(store, record)
        })();
        plaintext.zeroize();
        result.map(|payload| (root, payload))
    }

    fn object_upload_plan(
        &self,
        access: &CloudAccess,
        record: &CloudOutboxRecord,
        payload: &StagedPayload,
        upload_id: &str,
    ) -> Result<ObjectUploadPlan, CloudRuntimeError> {
        let revision_id = record
            .remote_revision_id
            .as_deref()
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        let chunks = upload_chunks(&payload.chunks)?;
        let signature_input = CanonicalUploadEnvelopeInput {
            vault_id: &access.state.vault_id,
            kind: UploadKind::Object,
            object_id: Some(&record.object_id),
            revision_id: Some(revision_id),
            base_revision_id: record.base_remote_revision_id.as_deref(),
            share_id: None,
            manifest_digest: &payload.manifest_sha256,
            crypto_version: u64::from(CRYPTO_VERSION),
            total_bytes: payload.total_bytes,
            chunks: &chunks,
        };
        let signature =
            sign_canonical_upload_envelope(&signature_input, &*access.keys.signing_seed)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        Ok(ObjectUploadPlan {
            version: PROTOCOL_VERSION,
            crypto_version: CRYPTO_VERSION,
            upload_id: upload_id.to_owned(),
            object_id: record.object_id.clone(),
            revision_id: revision_id.to_owned(),
            base_revision_id: record.base_remote_revision_id.clone(),
            manifest: base64_url_encode(&payload.manifest),
            manifest_sha256: payload.manifest_sha256.clone(),
            chunks: upload_chunk_plans(&payload.chunks)?,
            chunk_count: u32::try_from(payload.chunks.len())
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
            total_bytes: payload.total_bytes,
            writer_signature: base64_url_encode(&signature),
        })
    }

    fn share_writer_signature(
        &self,
        access: &CloudAccess,
        share: &CloudShareRecord,
        payload: &StagedPayload,
    ) -> Result<String, CloudRuntimeError> {
        let chunks = upload_chunks(&payload.chunks)?;
        let signature_input = CanonicalUploadEnvelopeInput {
            vault_id: &access.state.vault_id,
            kind: UploadKind::Share,
            object_id: None,
            revision_id: None,
            base_revision_id: None,
            share_id: Some(&share.share_id),
            manifest_digest: &payload.manifest_sha256,
            crypto_version: u64::from(CRYPTO_VERSION),
            total_bytes: payload.total_bytes,
            chunks: &chunks,
        };
        let signature =
            sign_canonical_upload_envelope(&signature_input, &*access.keys.signing_seed)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        Ok(base64_url_encode(&signature))
    }

    fn share_upload_plan(
        &self,
        access: &CloudAccess,
        share: &CloudShareRecord,
        payload: &StagedPayload,
        upload_id: &str,
    ) -> Result<ShareUploadPlan, CloudRuntimeError> {
        let writer_signature = self.share_writer_signature(access, share, payload)?;
        Ok(ShareUploadPlan {
            version: PROTOCOL_VERSION,
            crypto_version: CRYPTO_VERSION,
            upload_id: upload_id.to_owned(),
            share_id: share.share_id.clone(),
            expires_at: u64::try_from(share.expires_at_utc_ms)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
            manifest: base64_url_encode(&payload.manifest),
            manifest_sha256: payload.manifest_sha256.clone(),
            chunks: upload_chunk_plans(&payload.chunks)?,
            chunk_count: u32::try_from(payload.chunks.len())
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
            total_bytes: payload.total_bytes,
            writer_signature,
        })
    }

    async fn create_share_intent(
        &self,
        store: &MeetingStore,
        session_id: MeetingSessionId,
        expires_at_utc_ms: i64,
        content_kind: CloudShareContentKind,
    ) -> Result<NewShareIntent, CloudRuntimeError> {
        let access = self.configured_access().await?;
        if self.meetings.is_capture_active() {
            return Err(CloudRuntimeError::Deferred);
        }
        let now = adjusted_now_ms(access.state.clock_offset_ms);
        if expires_at_utc_ms <= now || expires_at_utc_ms > now.saturating_add(MAX_SHARE_EXPIRY_MS) {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let snapshot = store
            .session_snapshot(session_id)
            .map_err(map_store_error)?;
        if !matches!(
            snapshot.phase,
            MeetingPhase::ReviewReady | MeetingPhase::RecoveryRequired
        ) {
            return Err(CloudRuntimeError::Conflict);
        }
        let object_id = match store
            .cloud_head_for_session(session_id)
            .map_err(map_store_error)?
        {
            Some(head) => head.object_id,
            None => {
                let object_id = random_opaque_id()?;
                store
                    .upsert_cloud_head(&CloudHead {
                        object_id: object_id.clone(),
                        source_session_id: Some(session_id),
                        remote_revision_id: None,
                        tombstone: false,
                        acknowledged_revision_id: None,
                        change_sequence: 0,
                    })
                    .map_err(map_store_error)?;
                object_id
            }
        };
        let share_id = random_opaque_id()?;
        let root = random_array::<32>()?;
        let outbox = store
            .enqueue_cloud_outbox(CloudOutboxInput {
                kind: CloudOutboxKind::Share,
                object_id: share_id.clone(),
                source_session_id: Some(session_id),
                source_revision: Some(snapshot.revision),
                base_remote_revision_id: None,
                share_content_kind: Some(content_kind),
                remote_revision_id: None,
                idempotency_key: stable_idempotency_value(&["share", &share_id]),
                next_attempt_utc_ms: utc_now_ms(),
            })
            .map_err(map_store_error)?;
        let record = store
            .create_cloud_share(CloudShareInput {
                share_id,
                object_id,
                source_session_id: Some(session_id),
                expires_at_utc_ms,
                content_kind,
                encrypted_link_material: base64_url_encode(&root),
                outbox_id: Some(outbox.outbox_id.clone()),
            })
            .map_err(map_store_error)?;
        Ok(NewShareIntent {
            access,
            outbox,
            record,
        })
    }

    async fn pull_changes(&self, access: &CloudAccess) -> Result<(), CloudRuntimeError> {
        let mut cursor = access.state.cursor.clone();
        loop {
            self.require_request_permission(&access.state).await?;
            let credentials = credentials(access)?;
            let page = access
                .client
                .changes(&credentials, cursor.as_deref(), Some(100))
                .await;
            self.persist_clock(&access.store, &access.client);
            let page = match page {
                Ok(page) => page,
                Err(CloudClientError::Api(error))
                    if error.code == CloudErrorCode::CursorExpired =>
                {
                    self.pull_snapshot(access).await?;
                    return Ok(());
                }
                Err(error) => return Err(CloudRuntimeError::Client(error)),
            };
            for change in &page.changes {
                self.apply_remote_change(
                    access,
                    change.sequence,
                    &change.object_id,
                    &change.revision_id,
                    change.tombstone,
                )
                .await?;
            }
            let next_cursor = page.next_cursor;
            access
                .store
                .update_cloud_cursor(Some(next_cursor.clone()), None)
                .map_err(map_store_error)?;
            if !page.has_more {
                return Ok(());
            }
            cursor = Some(next_cursor);
        }
    }

    async fn pull_snapshot(&self, access: &CloudAccess) -> Result<(), CloudRuntimeError> {
        let mut high_water = access.state.snapshot_high_water.clone();
        let mut after = None;
        loop {
            self.require_request_permission(&access.state).await?;
            let credentials = credentials(access)?;
            let page = access
                .client
                .snapshot(
                    &credentials,
                    high_water.as_deref(),
                    after.as_deref(),
                    Some(100),
                )
                .await
                .map_err(CloudRuntimeError::Client);
            self.persist_clock(&access.store, &access.client);
            let page = page?;
            for head in &page.heads {
                self.apply_remote_change(
                    access,
                    head.sequence,
                    &head.object_id,
                    &head.revision_id,
                    head.tombstone,
                )
                .await?;
            }
            high_water = Some(page.high_water);
            after = page.after;
            access
                .store
                .update_cloud_cursor(None, high_water.clone())
                .map_err(map_store_error)?;
            if !page.has_more {
                access
                    .store
                    .update_cloud_cursor(None, None)
                    .map_err(map_store_error)?;
                return Ok(());
            }
        }
    }

    async fn apply_remote_change(
        &self,
        access: &CloudAccess,
        sequence: u64,
        object_id: &str,
        revision_id: &str,
        tombstone: bool,
    ) -> Result<(), CloudRuntimeError> {
        let current = access
            .store
            .cloud_head(object_id)
            .map_err(map_store_error)?;
        if current
            .as_ref()
            .is_some_and(|head| head.remote_revision_id.as_deref() == Some(revision_id))
        {
            let mut head = current.ok_or(CloudRuntimeError::IntegrityFailure)?;
            head.change_sequence = sequence;
            head.tombstone = tombstone;
            head.acknowledged_revision_id = Some(revision_id.to_owned());
            access
                .store
                .upsert_cloud_head(&head)
                .map_err(map_store_error)?;
            return Ok(());
        }
        if tombstone {
            if current.is_none() {
                access
                    .store
                    .upsert_cloud_head(&CloudHead {
                        object_id: object_id.to_owned(),
                        source_session_id: None,
                        remote_revision_id: Some(revision_id.to_owned()),
                        tombstone: true,
                        acknowledged_revision_id: Some(revision_id.to_owned()),
                        change_sequence: sequence,
                    })
                    .map_err(map_store_error)?;
            }
            return Ok(());
        }
        let bundle = self
            .fetch_remote_bundle(access, object_id, revision_id)
            .await?;
        self.install_or_conflict(access, object_id, revision_id, sequence, bundle)
            .await
    }

    async fn fetch_remote_bundle(
        &self,
        access: &CloudAccess,
        object_id: &str,
        revision_id: &str,
    ) -> Result<CloudMeetingBundleV1, CloudRuntimeError> {
        self.require_request_permission(&access.state).await?;
        let credentials = credentials(access)?;
        let response = access
            .client
            .object_manifest(&credentials, object_id, revision_id)
            .await
            .map_err(CloudRuntimeError::Client);
        self.persist_clock(&access.store, &access.client);
        let response = response?;
        self.verify_and_decrypt_remote_bundle(access, object_id, revision_id, response)
            .await
    }

    async fn verify_and_decrypt_remote_bundle(
        &self,
        access: &CloudAccess,
        object_id: &str,
        revision_id: &str,
        response: ObjectManifestResponse,
    ) -> Result<CloudMeetingBundleV1, CloudRuntimeError> {
        let envelope = response.envelope;
        if envelope.object_id != object_id
            || envelope.revision_id != revision_id
            || envelope.crypto_version != CRYPTO_VERSION
            || envelope.chunk_count == 0
            || envelope.chunk_count > 4096
            || envelope.total_bytes
                > u64::try_from(MAX_BUNDLE_BYTES + 1024)
                    .map_err(|_| CloudRuntimeError::IntegrityFailure)?
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let manifest = base64_url_decode(&response.manifest)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        if sha256_base64url(&manifest) != envelope.manifest_sha256 {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        self.require_request_permission(&access.state).await?;
        let credentials = credentials(access)?;
        let devices = access
            .client
            .devices(&credentials)
            .await
            .map_err(CloudRuntimeError::Client);
        self.persist_clock(&access.store, &access.client);
        let devices = devices?;
        let device = devices
            .devices
            .iter()
            .find(|device| {
                device.device_id == envelope.writer_device_id
                    && device.status == "active"
                    && device.revoked_at.is_none()
            })
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        let signing_public_key = fixed_array_32(
            base64_url_decode(&device.signing_public_key)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
        )?;
        let writer_signature = fixed_array_64(
            base64_url_decode(&envelope.writer_signature)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
        )?;
        let mut chunks = Vec::with_capacity(
            usize::try_from(envelope.chunk_count)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
        );
        let mut descriptors = Vec::with_capacity(chunks.capacity());
        let mut total_bytes = 0_u64;
        for index in 0..envelope.chunk_count {
            self.require_request_permission(&access.state).await?;
            let chunk = access
                .client
                .object_chunk(&credentials, object_id, revision_id, index)
                .await
                .map_err(CloudRuntimeError::Client);
            self.persist_clock(&access.store, &access.client);
            let chunk = chunk?;
            let digest = sha256_base64url(&chunk.bytes);
            let expected_etag = format!("\"{digest}\"");
            if chunk.etag.as_deref() != Some(expected_etag.as_str()) || chunk.bytes.len() < 28 {
                return Err(CloudRuntimeError::IntegrityFailure);
            }
            let size = u64::try_from(chunk.bytes.len())
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
            total_bytes = total_bytes
                .checked_add(size)
                .ok_or(CloudRuntimeError::IntegrityFailure)?;
            descriptors.push((u64::from(index), size, digest));
            chunks.push(chunk.bytes);
        }
        if total_bytes != envelope.total_bytes {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let canonical_chunks = descriptors
            .iter()
            .map(|(index, size, digest)| UploadChunk {
                index: *index,
                size: *size,
                sha256: digest,
            })
            .collect::<Vec<_>>();
        let signed = CanonicalUploadEnvelopeInput {
            vault_id: &access.state.vault_id,
            kind: UploadKind::Object,
            object_id: Some(object_id),
            revision_id: Some(revision_id),
            base_revision_id: envelope.parent_revision_id.as_deref(),
            share_id: None,
            manifest_digest: &envelope.manifest_sha256,
            crypto_version: u64::from(envelope.crypto_version),
            total_bytes: envelope.total_bytes,
            chunks: &canonical_chunks,
        };
        if !verify_ed25519(
            &signing_public_key,
            &writer_signature,
            &super::crypto::canonical_upload_envelope_bytes(&signed)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
        ) {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let manifest_context = ObjectRevisionCryptoContext {
            vault_id: &access.state.vault_id,
            object_id,
            revision_id,
            index: 0,
            total: u64::from(envelope.chunk_count),
            content_kind: ObjectContentKind::Manifest,
            source_format: OBJECT_SOURCE_FORMAT,
        };
        let mut manifest_plaintext =
            open_object_revision_payload(&*access.keys.vault_root, &manifest_context, &manifest)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let object_manifest = serde_json::from_slice::<ObjectPayloadManifest>(&manifest_plaintext)
            .map_err(|_| CloudRuntimeError::IntegrityFailure);
        manifest_plaintext.zeroize();
        let object_manifest = object_manifest?;
        if object_manifest.version != PROTOCOL_VERSION
            || object_manifest.kind != CAPABILITY_SHARE_KIND
            || object_manifest.source_format != OBJECT_SOURCE_FORMAT
            || object_manifest.chunk_count != envelope.chunk_count
            || usize::try_from(object_manifest.plaintext_bytes)
                .ok()
                .filter(|length| *length <= MAX_BUNDLE_BYTES)
                .is_none()
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let mut plaintext = Vec::with_capacity(
            usize::try_from(object_manifest.plaintext_bytes)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
        );
        for (index, chunk) in chunks.iter_mut().enumerate() {
            let index = u32::try_from(index).map_err(|_| CloudRuntimeError::IntegrityFailure)?;
            let decoded = open_object_revision_payload(
                &*access.keys.vault_root,
                &ObjectRevisionCryptoContext {
                    vault_id: &access.state.vault_id,
                    object_id,
                    revision_id,
                    index: u64::from(index),
                    total: u64::from(envelope.chunk_count),
                    content_kind: ObjectContentKind::Chunk,
                    source_format: OBJECT_SOURCE_FORMAT,
                },
                chunk,
            )
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
            plaintext.extend_from_slice(&decoded);
            chunk.zeroize();
        }
        if plaintext.len()
            != usize::try_from(object_manifest.plaintext_bytes)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?
            || sha256_base64url(&plaintext) != object_manifest.plaintext_sha256
        {
            plaintext.zeroize();
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        let bundle = CloudMeetingBundleV1::from_json_bytes(&plaintext)
            .map_err(|_| CloudRuntimeError::IntegrityFailure);
        plaintext.zeroize();
        bundle
    }

    async fn install_or_conflict(
        &self,
        access: &CloudAccess,
        object_id: &str,
        revision_id: &str,
        sequence: u64,
        bundle: CloudMeetingBundleV1,
    ) -> Result<(), CloudRuntimeError> {
        let existing_head = access
            .store
            .cloud_head(object_id)
            .map_err(map_store_error)?;
        let existing_session = access
            .store
            .session_snapshot(bundle.session.session_id)
            .ok();
        if existing_head.is_some() || existing_session.is_some() {
            let source_session_id = existing_head
                .as_ref()
                .and_then(|head| head.source_session_id)
                .or_else(|| existing_session.as_ref().map(|session| session.session_id));
            let source_revision = existing_session.as_ref().map(|session| session.revision);
            self.cache_conflict(
                &access.store,
                ConflictCacheInput {
                    object_id,
                    revision_id,
                    sequence,
                    source_session_id,
                    source_revision,
                    bundle: &bundle,
                },
            )?;
            self.emit_changed(source_session_id, Some(CloudObjectState::Conflict));
            return Ok(());
        }
        let snapshot = self
            .meetings
            .import_cloud_bundle(bundle)
            .await
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        access
            .store
            .upsert_cloud_head(&CloudHead {
                object_id: object_id.to_owned(),
                source_session_id: Some(snapshot.session_id),
                remote_revision_id: Some(revision_id.to_owned()),
                tombstone: false,
                acknowledged_revision_id: Some(revision_id.to_owned()),
                change_sequence: sequence,
            })
            .map_err(map_store_error)?;
        self.emit_changed(Some(snapshot.session_id), Some(CloudObjectState::Committed));
        Ok(())
    }

    fn cache_conflict(
        &self,
        store: &MeetingStore,
        input: ConflictCacheInput<'_>,
    ) -> Result<(), CloudRuntimeError> {
        let path = store
            .cloud_conflict_staging_path(input.object_id)
            .map_err(map_store_error)?;
        let bytes = input.bundle.to_json_bytes().map_err(map_store_error)?;
        write_path_atomically(&path, &bytes)?;
        store
            .cache_cloud_conflict(&CloudConflict {
                object_id: input.object_id.to_owned(),
                source_session_id: input.source_session_id,
                source_revision: input.source_revision,
                remote_revision_id: input.revision_id.to_owned(),
                remote_sequence: input.sequence,
                remote_bundle_relative_path: format!(".cloud-conflicts/{}.bundle", input.object_id),
            })
            .map_err(map_store_error)
    }

    fn meeting_status_from_store(
        &self,
        store: &MeetingStore,
        session_id: MeetingSessionId,
    ) -> Result<CloudMeetingStatus, CloudRuntimeError> {
        let cloud_settings = settings::get_settings(&self.app).cloud_sync;
        let head = store
            .cloud_head_for_session(session_id)
            .map_err(map_store_error)?;
        let share_count = store
            .cloud_share_count_for_session(session_id)
            .map_err(map_store_error)?;
        let outboxes = store
            .cloud_outboxes_for_session(session_id)
            .map_err(map_store_error)?;
        let conflict = head
            .as_ref()
            .map(|head| store.cloud_conflict(&head.object_id))
            .transpose()
            .map_err(map_store_error)?
            .flatten();
        let state = if conflict.is_some() {
            CloudObjectState::Conflict
        } else if let Some(outbox) = outboxes
            .iter()
            .rev()
            .find(|outbox| outbox.state == CloudOutboxState::Terminal)
        {
            terminal_object_state(
                outbox
                    .terminal_error
                    .as_deref()
                    .unwrap_or("integrity_failure"),
            )
        } else if outboxes
            .iter()
            .any(|outbox| outbox.state == CloudOutboxState::Claimed)
        {
            CloudObjectState::Uploading
        } else if outboxes.iter().any(|outbox| {
            outbox.state == CloudOutboxState::Pending && outbox.kind == CloudOutboxKind::Tombstone
        }) {
            CloudObjectState::PendingDeletion
        } else if outboxes
            .iter()
            .any(|outbox| outbox.state == CloudOutboxState::Pending)
        {
            CloudObjectState::Queued
        } else if head.as_ref().is_some_and(|head| head.tombstone) {
            CloudObjectState::Deleted
        } else if head
            .as_ref()
            .and_then(|head| head.remote_revision_id.as_ref())
            .is_some()
        {
            CloudObjectState::Committed
        } else if cloud_settings.paused {
            CloudObjectState::Paused
        } else {
            CloudObjectState::Local
        };
        let retry_at_utc_ms = outboxes
            .iter()
            .filter(|outbox| outbox.state == CloudOutboxState::Pending)
            .map(|outbox| outbox.next_attempt_utc_ms)
            .min();
        Ok(CloudMeetingStatus {
            session_id,
            state,
            remote_revision_id: head.and_then(|head| head.remote_revision_id),
            retry_at_utc_ms,
            share_count,
        })
    }

    fn emit_changed(&self, session_id: Option<MeetingSessionId>, state: Option<CloudObjectState>) {
        let _ = self.app.emit(
            <CloudSyncChangedEvent as tauri_specta::Event>::NAME,
            CloudSyncChangedPayload {
                event_schema_version: CLOUD_SYNC_EVENT_SCHEMA_VERSION,
                session_id,
                state,
            },
        );
    }
}

struct NewShareIntent {
    access: CloudAccess,
    outbox: CloudOutboxRecord,
    record: CloudShareRecord,
}

fn credentials(access: &CloudAccess) -> Result<CloudCredentials<'_>, CloudRuntimeError> {
    CloudCredentials::new(
        &access.state.vault_id,
        &access.state.device_id,
        &access.keys.signing_seed,
    )
    .map_err(CloudRuntimeError::Client)
}

fn validate_capabilities(capabilities: &CloudCapabilities) -> Result<(), CloudRuntimeError> {
    if capabilities.protocol_version != PROTOCOL_VERSION
        || capabilities.crypto_version != CRYPTO_VERSION
        || capabilities.request_auth.algorithm != "Ed25519"
        || capabilities.request_auth.clock_skew_seconds != 300
        || capabilities.request_auth.nonce_retention_seconds != 600
        || capabilities.limits.chunk_bytes
            != u64::try_from(MAX_ENCRYPTED_CHUNK_BYTES)
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?
        || capabilities.limits.chunks_per_upload != 4096
        || capabilities.limits.change_page > 100
        || capabilities.limits.snapshot_page > 100
    {
        return Err(CloudRuntimeError::UnsupportedProtocol);
    }
    Ok(())
}

fn canonical_endpoint(raw: &str) -> Result<String, CloudRuntimeError> {
    CloudSyncSettings {
        endpoint: Some(raw.to_owned()),
        ..CloudSyncSettings::default()
    }
    .endpoint()
    .map_err(|_| CloudRuntimeError::SetupRequired)?
    .ok_or(CloudRuntimeError::SetupRequired)
}

fn map_store_error(_error: StoreError) -> CloudRuntimeError {
    CloudRuntimeError::Storage
}

fn random_opaque_id() -> Result<String, CloudRuntimeError> {
    Ok(base64_url_encode(&random_array::<24>()?))
}

fn random_array<const N: usize>() -> Result<[u8; N], CloudRuntimeError> {
    let mut bytes = [0_u8; N];
    getrandom::fill(&mut bytes).map_err(|_| CloudRuntimeError::Randomness)?;
    Ok(bytes)
}

fn stable_idempotency_value(parts: &[&str]) -> String {
    let mut bytes = Vec::new();
    for part in parts {
        bytes.extend_from_slice(part.as_bytes());
        bytes.push(0);
    }
    base64_url_encode(&sha256_digest(&bytes))
}

fn idempotency_key(parts: &[&str]) -> Result<IdempotencyKey, CloudRuntimeError> {
    IdempotencyKey::new(stable_idempotency_value(parts)).map_err(CloudRuntimeError::Client)
}

fn operation_key(
    record: &CloudOutboxRecord,
    operation: &str,
) -> Result<IdempotencyKey, CloudRuntimeError> {
    idempotency_key(&["outbox", &record.idempotency_key, operation])
}
fn pairing_envelope_material(
    pairing_secret: &[u8; 32],
    candidate_record: &[u8],
) -> ([u8; 32], [u8; 12]) {
    let mut material = Vec::with_capacity(pairing_secret.len() + candidate_record.len() + 32);
    material.extend_from_slice(b"sona-pairing-ephemeral-v1");
    material.extend_from_slice(pairing_secret);
    material.extend_from_slice(candidate_record);
    let ephemeral_secret_key = sha256_digest(&material);
    material.clear();
    material.extend_from_slice(b"sona-pairing-nonce-v1");
    material.extend_from_slice(pairing_secret);
    material.extend_from_slice(candidate_record);
    let nonce_digest = sha256_digest(&material);
    material.zeroize();
    let mut nonce = [0_u8; 12];
    nonce.copy_from_slice(&nonce_digest[..12]);
    (ephemeral_secret_key, nonce)
}

fn adjusted_now_ms(clock_offset_ms: i64) -> i64 {
    utc_now_ms().saturating_add(clock_offset_ms)
}

fn utc_now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn retry_directive(
    error: &CloudRuntimeError,
    attempt_count: u32,
) -> Option<(Option<i64>, Option<&'static str>)> {
    let now = utc_now_ms();
    match error {
        CloudRuntimeError::Client(CloudClientError::Api(api)) => match api.code {
            CloudErrorCode::ClockSkew => Some((Some(now), None)),
            CloudErrorCode::RateLimited | CloudErrorCode::DependencyUnavailable
                if api.retryable =>
            {
                let retry_after_ms = api
                    .retry_after
                    .and_then(|delay| i64::try_from(delay.as_millis()).ok());
                Some((
                    Some(now.saturating_add(backoff_ms(attempt_count, retry_after_ms))),
                    None,
                ))
            }
            CloudErrorCode::Unauthorized | CloudErrorCode::RevokedDevice => {
                Some((None, Some("auth_required")))
            }
            CloudErrorCode::QuotaExceeded => Some((None, Some("quota"))),
            CloudErrorCode::StaleRevision => Some((None, Some("conflict"))),
            CloudErrorCode::UnsupportedVersion => Some((None, Some("unsupported_protocol"))),
            CloudErrorCode::IntegrityFailed
            | CloudErrorCode::ChunkConflict
            | CloudErrorCode::IdempotencyConflict
            | CloudErrorCode::Replay => Some((None, Some("integrity_failure"))),
            _ => Some((None, Some("integrity_failure"))),
        },
        CloudRuntimeError::Client(_) | CloudRuntimeError::Deferred => Some((
            Some(now.saturating_add(backoff_ms(attempt_count, None))),
            None,
        )),
        CloudRuntimeError::Conflict => Some((None, Some("conflict"))),
        CloudRuntimeError::UnsupportedProtocol => Some((None, Some("unsupported_protocol"))),
        _ => Some((None, Some("integrity_failure"))),
    }
}

fn backoff_ms(attempt_count: u32, retry_after_ms: Option<i64>) -> i64 {
    let exponent = attempt_count.min(8);
    let seconds = 1_i64.checked_shl(exponent).unwrap_or(256);
    let bounded = seconds.saturating_mul(1000).min(MAX_RETRY_DELAY_MS);
    retry_after_ms
        .unwrap_or(0)
        .clamp(0, MAX_RETRY_DELAY_MS)
        .max(bounded)
}

fn terminal_error_kind(value: &str) -> Option<CloudSyncErrorKind> {
    match value {
        "auth_required" => Some(CloudSyncErrorKind::AuthRequired),
        "quota" => Some(CloudSyncErrorKind::Quota),
        "conflict" => Some(CloudSyncErrorKind::Conflict),
        "unsupported_protocol" => Some(CloudSyncErrorKind::UnsupportedProtocol),
        "integrity_failure" => Some(CloudSyncErrorKind::IntegrityFailure),
        _ => None,
    }
}

fn terminal_object_state(value: &str) -> CloudObjectState {
    match value {
        "auth_required" => CloudObjectState::AuthRequired,
        "quota" => CloudObjectState::Quota,
        "conflict" => CloudObjectState::Conflict,
        _ => CloudObjectState::IntegrityFailure,
    }
}

fn fixed_array_16(mut bytes: Vec<u8>) -> Result<[u8; 16], CloudRuntimeError> {
    let result = bytes
        .as_slice()
        .try_into()
        .map_err(|_| CloudRuntimeError::IntegrityFailure);
    bytes.zeroize();
    result
}

fn fixed_array_32(mut bytes: Vec<u8>) -> Result<[u8; 32], CloudRuntimeError> {
    let result = bytes
        .as_slice()
        .try_into()
        .map_err(|_| CloudRuntimeError::IntegrityFailure);
    bytes.zeroize();
    result
}

fn fixed_array_64(mut bytes: Vec<u8>) -> Result<[u8; 64], CloudRuntimeError> {
    let result = bytes
        .as_slice()
        .try_into()
        .map_err(|_| CloudRuntimeError::IntegrityFailure);
    bytes.zeroize();
    result
}

fn chunk_file_name(index: u32) -> String {
    format!("chunk-{index}.bin")
}

fn write_staged_file(
    directory: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<(), CloudRuntimeError> {
    let destination = directory.join(file_name);
    let temporary = directory.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| CloudRuntimeError::File)?;
        file.write_all(bytes).map_err(|_| CloudRuntimeError::File)?;
        file.sync_all().map_err(|_| CloudRuntimeError::File)?;
        fs::rename(&temporary, &destination).map_err(|_| CloudRuntimeError::File)?;
        let _ = File::open(directory).and_then(|directory| directory.sync_all());
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn write_path_atomically(path: &Path, bytes: &[u8]) -> Result<(), CloudRuntimeError> {
    let parent = path.parent().ok_or(CloudRuntimeError::File)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or(CloudRuntimeError::File)?;
    write_staged_file(parent, file_name, bytes)
}

fn load_staged_payload(
    store: &MeetingStore,
    record: &CloudOutboxRecord,
) -> Result<StagedPayload, CloudRuntimeError> {
    let directory = store
        .cloud_outbox_payload_directory(&record.outbox_id)
        .map_err(map_store_error)?;
    let manifest =
        fs::read(directory.join(OBJECT_MANIFEST_FILE)).map_err(|_| CloudRuntimeError::File)?;
    if manifest.len() < 28 {
        return Err(CloudRuntimeError::IntegrityFailure);
    }
    let chunks = store
        .cloud_outbox_chunks(&record.outbox_id)
        .map_err(map_store_error)?;
    if chunks.is_empty() {
        return Err(CloudRuntimeError::IntegrityFailure);
    }
    let mut staged = Vec::with_capacity(chunks.len());
    let mut total_bytes = 0_u64;
    for metadata in chunks {
        let bytes = fs::read(directory.join(chunk_file_name(metadata.chunk_index)))
            .map_err(|_| CloudRuntimeError::File)?;
        let size = u64::try_from(bytes.len()).map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        if size != metadata.size_bytes
            || sha256_base64url(&bytes) != metadata.sha256
            || bytes.len() < 28
        {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        total_bytes = total_bytes
            .checked_add(size)
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        staged.push(StagedChunk {
            index: metadata.chunk_index,
            size,
            sha256: metadata.sha256,
            bytes,
        });
    }
    Ok(StagedPayload {
        manifest_sha256: sha256_base64url(&manifest),
        manifest,
        chunks: staged,
        total_bytes,
    })
}

fn upload_chunks(chunks: &[StagedChunk]) -> Result<Vec<UploadChunk<'_>>, CloudRuntimeError> {
    let mut expected = 0_u32;
    let mut values = Vec::with_capacity(chunks.len());
    for chunk in chunks {
        if chunk.index != expected || chunk.size < 28 {
            return Err(CloudRuntimeError::IntegrityFailure);
        }
        expected = expected
            .checked_add(1)
            .ok_or(CloudRuntimeError::IntegrityFailure)?;
        values.push(UploadChunk {
            index: u64::from(chunk.index),
            size: chunk.size,
            sha256: &chunk.sha256,
        });
    }
    Ok(values)
}

fn upload_chunk_plans(chunks: &[StagedChunk]) -> Result<Vec<UploadChunkPlan>, CloudRuntimeError> {
    upload_chunks(chunks)?;
    chunks
        .iter()
        .map(|chunk| {
            Ok(UploadChunkPlan {
                index: chunk.index,
                size: chunk.size,
                sha256: chunk.sha256.clone(),
            })
        })
        .collect()
}

fn worker_share_transport(
    share: &CloudShareRecord,
    payload: &StagedPayload,
    writer_signature: &str,
) -> Result<Vec<u8>, CloudRuntimeError> {
    let chunks = payload
        .chunks
        .iter()
        .map(|chunk| {
            Ok(WorkerShareTransportChunk {
                index: chunk.index,
                size: u32::try_from(chunk.size).map_err(|_| CloudRuntimeError::IntegrityFailure)?,
                sha256: chunk.sha256.clone(),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let header = serde_json::to_vec(&WorkerShareTransport {
        format: "sona-encrypted-share-v1",
        version: PROTOCOL_VERSION,
        share: WorkerShareTransportMetadata {
            share_id: &share.share_id,
            crypto_version: CRYPTO_VERSION,
            manifest_sha256: &payload.manifest_sha256,
            chunk_count: u32::try_from(payload.chunks.len())
                .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
            total_bytes: payload.total_bytes,
            writer_signature,
        },
        manifest: base64_url_encode(&payload.manifest),
        chunks,
    })
    .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
    let mut transport = header;
    transport.push(b'\n');
    for chunk in &payload.chunks {
        let size =
            u32::try_from(chunk.bytes.len()).map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        transport.extend_from_slice(&size.to_be_bytes());
        transport.extend_from_slice(&chunk.bytes);
    }
    Ok(transport)
}

fn decrypt_capability_bundle(
    file: &super::share_file::ValidatedShareFile,
) -> Result<CloudMeetingBundleV1, CloudRuntimeError> {
    let header = &file.header;
    if header.crypto_version != CRYPTO_VERSION
        || header.chunk_count == 0
        || usize::try_from(header.chunk_count).ok() != Some(file.ciphertext_frames.len())
    {
        return Err(CloudRuntimeError::IntegrityFailure);
    }
    let mut manifest_plaintext = open_share_payload(
        file.share_root(),
        &SharePayloadContext {
            share_id: &header.share_id,
            index: 0,
            total: u64::from(header.chunk_count),
            domain: SharePayloadDomain::Manifest,
        },
        &header.manifest_ciphertext,
    )
    .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
    let manifest = serde_json::from_slice::<CapabilityShareManifest>(&manifest_plaintext)
        .map_err(|_| CloudRuntimeError::IntegrityFailure);
    manifest_plaintext.zeroize();
    let manifest = manifest?;
    if manifest.version != PROTOCOL_VERSION
        || manifest.kind != CAPABILITY_SHARE_KIND
        || manifest.source_format != OBJECT_SOURCE_FORMAT
        || manifest.chunk_count != header.chunk_count
        || usize::try_from(manifest.plaintext_bytes)
            .ok()
            .filter(|length| *length <= MAX_BUNDLE_BYTES)
            .is_none()
    {
        return Err(CloudRuntimeError::IntegrityFailure);
    }
    let mut plaintext = Vec::with_capacity(
        usize::try_from(manifest.plaintext_bytes)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?,
    );
    for (index, ciphertext) in file.ciphertext_frames.iter().enumerate() {
        let index = u32::try_from(index).map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        let decoded = open_share_payload(
            file.share_root(),
            &SharePayloadContext {
                share_id: &header.share_id,
                index: u64::from(index),
                total: u64::from(header.chunk_count),
                domain: SharePayloadDomain::Chunk,
            },
            ciphertext,
        )
        .map_err(|_| CloudRuntimeError::IntegrityFailure)?;
        plaintext.extend_from_slice(&decoded);
    }
    if plaintext.len()
        != usize::try_from(manifest.plaintext_bytes)
            .map_err(|_| CloudRuntimeError::IntegrityFailure)?
        || sha256_base64url(&plaintext) != manifest.plaintext_sha256
    {
        plaintext.zeroize();
        return Err(CloudRuntimeError::IntegrityFailure);
    }
    let bundle = CloudMeetingBundleV1::from_json_bytes(&plaintext)
        .map_err(|_| CloudRuntimeError::IntegrityFailure);
    plaintext.zeroize();
    bundle
}

fn strict_browser_markdown(
    review: &MeetingReviewSnapshot,
) -> Result<(String, Vec<u8>), CloudRuntimeError> {
    let title = strict_text(&review.session.title);
    if title.is_empty() || title.len() > 240 {
        return Err(CloudRuntimeError::IntegrityFailure);
    }
    let speakers = review
        .speakers
        .iter()
        .map(|speaker| (speaker.speaker_id, strict_text(&speaker.display_name)))
        .collect::<HashMap<_, _>>();
    let mut markdown = String::new();
    markdown.push_str("# ");
    markdown.push_str(&title);
    markdown.push_str("\n\n## Transcript\n");
    let mut has_transcript = false;
    for segment in review.transcript.iter().filter(|segment| !segment.removed) {
        has_transcript = true;
        let text = segment
            .replacement_text
            .as_deref()
            .unwrap_or(segment.base.text.as_str());
        let speaker = speakers
            .get(&segment.assigned_speaker_id)
            .map(String::as_str)
            .unwrap_or("Unknown speaker");
        markdown.push_str("- ");
        markdown.push_str(speaker);
        markdown.push_str(": ");
        markdown.push_str(&strict_text(text));
        markdown.push('\n');
    }
    if !has_transcript {
        markdown.push_str("No transcript is available.\n");
    }
    markdown.push_str("\n## Notes\n");
    if review.notes.is_empty() {
        markdown.push_str("No manual notes.\n");
    } else {
        for note in &review.notes {
            markdown.push_str("- ");
            markdown.push_str(&strict_text(&note.body));
            markdown.push('\n');
        }
    }
    if markdown.len() > MAX_BUNDLE_BYTES {
        return Err(CloudRuntimeError::IntegrityFailure);
    }
    Ok((title, markdown.into_bytes()))
}

fn strict_text(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.replace(['\r', '\n'], " ").chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '\\' | '`' | '*' | '_' | '[' | ']' | '(' | ')' | '#' | '+' | '-' | '!' | '|' => {
                escaped.push('\\');
                escaped.push(character);
            }
            _ => escaped.push(character),
        }
    }
    escaped.trim().to_owned()
}
#[cfg(test)]
mod tests {
    use super::*;

    fn browser_share_payload(root: &[u8; 32]) -> (CloudShareRecord, StagedPayload) {
        let share = CloudShareRecord {
            share_id: "shareid123456789".to_owned(),
            object_id: "objectid12345678".to_owned(),
            source_session_id: None,
            expires_at_utc_ms: 1,
            state: CloudShareState::Active,
            content_kind: CloudShareContentKind::BrowserMarkdown,
            encrypted_link_material: base64_url_encode(root),
            outbox_id: None,
            revoked_at_utc_ms: None,
        };
        let manifest = serde_json::to_vec(&BrowserShareManifest {
            version: PROTOCOL_VERSION,
            kind: BROWSER_SHARE_KIND.to_owned(),
            source_format: BROWSER_SOURCE_FORMAT.to_owned(),
            title: "Safe title".to_owned(),
            chunk_count: 1,
            plaintext_bytes: 8,
        })
        .expect("browser manifest");
        let manifest = seal_share_payload(
            root,
            &SharePayloadContext {
                share_id: &share.share_id,
                index: 0,
                total: 1,
                domain: SharePayloadDomain::Manifest,
            },
            &[1; 12],
            &manifest,
        )
        .expect("seal browser manifest");
        let bytes = seal_share_payload(
            root,
            &SharePayloadContext {
                share_id: &share.share_id,
                index: 0,
                total: 1,
                domain: SharePayloadDomain::Chunk,
            },
            &[2; 12],
            b"# safe\n",
        )
        .expect("seal browser chunk");
        let size = u64::try_from(bytes.len()).expect("chunk size");
        (
            share,
            StagedPayload {
                manifest_sha256: sha256_base64url(&manifest),
                manifest,
                chunks: vec![StagedChunk {
                    index: 0,
                    size,
                    sha256: sha256_base64url(&bytes),
                    bytes,
                }],
                total_bytes: size,
            },
        )
    }

    #[test]
    fn browser_payload_cannot_cross_into_capability_import() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let root = [7; 32];
        let (share, payload) = browser_share_payload(&root);
        let transport = worker_share_transport(&share, &payload, &base64_url_encode(&[3; 64]))
            .expect("worker transport");
        let worker = parse_worker_share_transport(transport).expect("validated worker transport");
        let path = directory.path().join("browser.sona");
        write_share_file(&path, &root, &worker.header, &worker.ciphertext_frames)
            .expect("capability write");
        let file = read_share_file(&path).expect("capability read");
        assert!(matches!(
            decrypt_capability_bundle(&file),
            Err(CloudRuntimeError::IntegrityFailure)
        ));
    }

    #[test]
    fn retries_are_bounded_and_honor_retry_after() {
        assert_eq!(backoff_ms(0, None), 1_000);
        assert_eq!(backoff_ms(20, Some(600_000)), MAX_RETRY_DELAY_MS);
        assert_eq!(backoff_ms(2, Some(5_000)), 5_000);
    }

    #[test]
    fn operation_idempotency_is_stable_per_mutation_target() {
        let record = CloudOutboxRecord {
            outbox_id: Uuid::new_v4().to_string(),
            kind: CloudOutboxKind::Object,
            object_id: "objectid12345678".to_owned(),
            source_session_id: None,
            source_revision: None,
            base_remote_revision_id: None,
            share_content_kind: None,
            remote_revision_id: Some("revision123456789".to_owned()),
            upload_id: None,
            idempotency_key: "idempotencykey123".to_owned(),
            state: CloudOutboxState::Pending,
            attempt_count: 0,
            next_attempt_utc_ms: 0,
            terminal_error: None,
            payload_relative_dir: ".cloud-outbox/test".to_owned(),
            claim_token: None,
        };
        let first = operation_key(&record, "commit").expect("first key");
        let second = operation_key(&record, "commit").expect("second key");
        let chunk = operation_key(&record, "chunk-0").expect("chunk key");
        assert_eq!(first.as_str(), second.as_str());
        assert_ne!(first.as_str(), chunk.as_str());
    }

    #[test]
    fn strict_markdown_escapes_markup_and_newlines() {
        let text = strict_text("<script>alert(1)</script>\n# heading");
        assert!(!text.contains('<'));
        assert!(!text.contains('>'));
        assert!(!text.contains('\n'));
        assert!(text.contains("&lt;script&gt;"));
    }
}
