use super::capture::{MeetingCaptureSource, PacketLaneReadError, PacketLaneReader, PacketSink};
use super::clock::host_monotonic_now_ns;
use super::export;
use super::keep_awake::MeetingKeepAwake;
use super::processing::{MeetingProcessingService, QuestionGenerationRequest};
use super::store::{
    MeetingStore, MeetingTrackWriter, SegmentEdit, StoreError, StoreMutation, StoreTransition,
    TrackCreation, STORE_SCHEMA_VERSION,
};
use super::suggestions::{
    MeetingSuggestion, MeetingSuggestionService, MeetingSuggestionSignal, MeetingSuggestionSink,
};
use super::types::*;
use crate::analytics::DashboardTrendRequest;
use crate::secrets::{SecretManager, SecretResolveError};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MEETING_EVENT_SCHEMA_VERSION: u32 = 1;
const DEFAULT_RECORD_MAX_PAYLOAD_BYTES: u32 = 4 * 1024 * 1024;
const DEFAULT_CHECKPOINT_INTERVAL_MS: u32 = 1_000;
const DEFAULT_SOURCE_SAMPLE_CAPACITY: u32 = 96_000;
const DEFAULT_SOURCE_DESCRIPTOR_CAPACITY: u32 = 128;
const RETENTION_SWEEP_INTERVAL: Duration = Duration::from_secs(15 * 60);
const RETENTION_OPERATION_NAMESPACE: Uuid =
    Uuid::from_u128(0x5192_4d08_51d9_4f31_a369_1f2d_a7de_c9d4);

pub trait MeetingSourceProvider: Send + Sync {
    fn probe(&self, source_kind: SourceKind) -> SourceProbe;

    fn acquire(
        &self,
        source_kind: SourceKind,
    ) -> Result<Box<dyn MeetingCaptureSource>, MeetingCaptureError>;
}

struct NoCaptureSources;

impl MeetingSourceProvider for NoCaptureSources {
    fn probe(&self, source_kind: SourceKind) -> SourceProbe {
        SourceProbe {
            source_kind,
            availability: SourceAvailability::UnsupportedPlatform,
            health: SourceHealth::NotStarted,
            detail: Some(SourceProbeDetail::Platform),
            negotiated_format: None,
        }
    }

    fn acquire(
        &self,
        _source_kind: SourceKind,
    ) -> Result<Box<dyn MeetingCaptureSource>, MeetingCaptureError> {
        Err(MeetingCaptureError::Unavailable)
    }
}

pub(crate) fn production_source_provider(
    audio: Arc<crate::managers::audio::AudioRecordingManager>,
) -> Arc<dyn MeetingSourceProvider> {
    Arc::new(BuiltinMeetingSources { audio })
}

struct BuiltinMeetingSources {
    audio: Arc<crate::managers::audio::AudioRecordingManager>,
}

impl MeetingSourceProvider for BuiltinMeetingSources {
    fn probe(&self, source_kind: SourceKind) -> SourceProbe {
        match source_kind {
            SourceKind::Microphone => match self.audio.try_acquire_meeting_microphone() {
                Ok(source) => source.probe(),
                Err(_) => SourceProbe {
                    source_kind,
                    availability: SourceAvailability::DeviceUnavailable,
                    health: SourceHealth::NotStarted,
                    detail: Some(SourceProbeDetail::Device),
                    negotiated_format: None,
                },
            },
            SourceKind::SystemAudio => {
                #[cfg(target_os = "macos")]
                {
                    crate::meeting_macos::MacosSystemAudioCapture::new().probe()
                }
                #[cfg(not(target_os = "macos"))]
                {
                    SourceProbe {
                        source_kind,
                        availability: SourceAvailability::UnsupportedPlatform,
                        health: SourceHealth::NotStarted,
                        detail: Some(SourceProbeDetail::Platform),
                        negotiated_format: None,
                    }
                }
            }
        }
    }

    fn acquire(
        &self,
        source_kind: SourceKind,
    ) -> Result<Box<dyn MeetingCaptureSource>, MeetingCaptureError> {
        match source_kind {
            SourceKind::Microphone => self
                .audio
                .try_acquire_meeting_microphone()
                .map(|source| Box::new(source) as Box<dyn MeetingCaptureSource>),
            SourceKind::SystemAudio => {
                #[cfg(target_os = "macos")]
                {
                    Ok(Box::new(
                        crate::meeting_macos::MacosSystemAudioCapture::new(),
                    ))
                }
                #[cfg(not(target_os = "macos"))]
                {
                    Err(MeetingCaptureError::Unavailable)
                }
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingPreflightCreateRequest {
    pub operation_id: MeetingOperationId,
    pub expected_revision: u64,
    pub title: String,
    pub origin: MeetingOrigin,
    pub suggestion_id: Option<MeetingSuggestionId>,
    pub requested_sources: Vec<SourceKind>,
    pub required_sources: Vec<SourceKind>,
    pub accepted_known_missing_sources: Vec<SourceKind>,
    pub degraded_start_policy: DegradedStartPolicy,
    pub destination: ProcessingDestination,
    pub remote_acknowledgement: Option<RemoteAcknowledgement>,
    pub microphone_device_uid: Option<String>,
    pub frozen_system_audio_application_bundle_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingPreflightRefreshRequest {
    pub operation_id: MeetingOperationId,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingConsentInput {
    pub policy_version: u32,
    pub microphone_acknowledged: bool,
    pub system_audio_acknowledged: bool,
    pub known_missing_sources_acknowledged: Vec<SourceKind>,
    pub degraded_start_policy: DegradedStartPolicy,
    pub destination: ProcessingDestination,
    pub remote_acknowledgement: Option<RemoteAcknowledgement>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingStartRequest {
    pub operation_id: MeetingOperationId,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
    pub consent: MeetingConsentInput,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingMutationRequest {
    pub operation_id: MeetingOperationId,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingTitleSetRequest {
    pub operation_id: MeetingOperationId,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingSpeakerRenameRequest {
    pub operation_id: MeetingOperationId,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
    pub speaker_id: SpeakerId,
    pub display_name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingSpeakerMergeRequest {
    pub operation_id: MeetingOperationId,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
    pub source_speaker_id: SpeakerId,
    pub target_speaker_id: SpeakerId,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingSegmentEditRequest {
    pub operation_id: MeetingOperationId,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
    pub segment_id: TranscriptSegmentId,
    pub replacement_text: String,
    pub removed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingNoteCreateRequest {
    pub operation_id: MeetingOperationId,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
    pub start_offset_ns: Option<u64>,
    pub end_offset_ns: Option<u64>,
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingNoteUpdateRequest {
    pub operation_id: MeetingOperationId,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
    pub note_id: ManualNoteId,
    pub expected_note_revision: u64,
    pub start_offset_ns: Option<u64>,
    pub end_offset_ns: Option<u64>,
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingNoteDeleteRequest {
    pub operation_id: MeetingOperationId,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
    pub note_id: ManualNoteId,
    pub expected_note_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingQuestionRequest {
    pub operation_id: MeetingOperationId,
    pub session_id: MeetingSessionId,
    pub expected_revision: u64,
    pub question_id: MeetingQuestionId,
    pub question: String,
    #[serde(default)]
    pub scope: MeetingQuestionScope,
    #[serde(default)]
    pub save_history: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingMutationResult {
    pub receipt: OperationReceipt,
    pub snapshot: MeetingSessionSnapshot,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingQuestionResult {
    pub receipt: OperationReceipt,
    pub snapshot: MeetingSessionSnapshot,
    pub answer: MeetingAnswer,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct MeetingRemovalResult {
    pub receipt: OperationReceipt,
    pub session_id: MeetingSessionId,
    pub removed: bool,
}

/// One lifecycle actor for all meetings. It serializes capture authority and
/// owns the global capture lease, while packet workers only persist bounded
/// source lanes and report health observations back through the store.
pub struct MeetingSessionManager {
    app: Option<AppHandle>,
    root: Option<PathBuf>,
    secrets: Arc<SecretManager>,
    suggestions: MeetingSuggestionService,
    sources: Mutex<Arc<dyn MeetingSourceProvider>>,
    store: Mutex<Option<Arc<MeetingStore>>>,
    recovery_complete: AtomicBool,
    processing: Arc<MeetingProcessingService>,
    keep_awake: Mutex<MeetingKeepAwake>,
    actor: Mutex<ActorState>,
}

struct ActorState {
    active: Option<ActiveCapture>,
    tray_session_id: Option<MeetingSessionId>,
}

struct ActiveCapture {
    session_id: MeetingSessionId,
    sources: HashMap<SourceKind, ActiveSource>,
}

struct ActiveSource {
    track_id: SourceTrackId,
    epoch: SourceEpoch,
    source: Box<dyn MeetingCaptureSource>,
    worker: TrackWorker,
}

struct TrackWorker {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<Result<(), StoreError>>>,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct RetentionSweepResult {
    pub due_sessions: usize,
    pub deleted_sessions: usize,
    pub failed_sessions: usize,
}

impl MeetingSessionManager {
    pub fn new(app: &AppHandle, secrets: Arc<SecretManager>) -> Self {
        let root = crate::portable::app_data_dir(app)
            .ok()
            .map(|directory| directory.join("meetings"));
        Self::with_parts(Some(app.clone()), root, secrets, Arc::new(NoCaptureSources))
    }

    pub fn with_parts(
        app: Option<AppHandle>,
        root: Option<PathBuf>,
        secrets: Arc<SecretManager>,
        source_provider: Arc<dyn MeetingSourceProvider>,
    ) -> Self {
        let processing = Arc::new(MeetingProcessingService::new(app.clone()));
        Self {
            app,
            root,
            secrets,
            suggestions: MeetingSuggestionService::new(Vec::new(), 120_000_000_000),
            sources: Mutex::new(source_provider),
            store: Mutex::new(None),
            recovery_complete: AtomicBool::new(false),
            processing,
            keep_awake: Mutex::new(MeetingKeepAwake::new()),
            actor: Mutex::new(ActorState {
                active: None,
                tray_session_id: None,
            }),
        }
    }

    pub fn set_source_provider(&self, source_provider: Arc<dyn MeetingSourceProvider>) {
        *self.sources_lock() = source_provider;
    }

    pub fn set_transcription_manager(
        &self,
        manager: Arc<crate::managers::transcription::TranscriptionManager>,
    ) {
        self.processing.set_transcription_manager(manager);
    }

    fn acquire_keep_awake(&self) {
        self.keep_awake
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .acquire();
    }

    fn release_keep_awake(&self) {
        self.keep_awake
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .release();
    }

    pub(crate) fn start_retention_sweeper(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        thread::spawn(move || loop {
            thread::sleep(RETENTION_SWEEP_INTERVAL);
            if let Err(error) =
                tauri::async_runtime::block_on(manager.sweep_retention_at(utc_now_ms()))
            {
                log::warn!("Meeting retention sweep is unavailable: {error:?}");
            }
        });
    }

    pub async fn recover_at_startup(&self) -> Result<Vec<MeetingSessionId>, MeetingCommandError> {
        self.recover_at_startup_at(utc_now_ms()).await
    }

    pub(crate) async fn recover_at_startup_at(
        &self,
        now_utc_ms: i64,
    ) -> Result<Vec<MeetingSessionId>, MeetingCommandError> {
        let store = self.store().await?;
        let recovered = store.recover_interrupted().map_err(map_store_error)?;
        for session_id in &recovered {
            let snapshot = store
                .session_snapshot(*session_id)
                .map_err(map_store_error)?;
            self.emit_session_changed(&snapshot);
        }
        if let Err(error) = self.sweep_retention_at(now_utc_ms).await {
            log::warn!("Meeting retention sweep is unavailable at startup: {error:?}");
        }
        self.recovery_complete.store(true, Ordering::Release);
        Ok(recovered)
    }

    pub(crate) async fn sweep_retention_at(
        &self,
        now_utc_ms: i64,
    ) -> Result<RetentionSweepResult, MeetingCommandError> {
        let due_sessions = self
            .store()
            .await?
            .due_retention_sessions(now_utc_ms)
            .map_err(map_store_error)?;
        let mut result = RetentionSweepResult {
            due_sessions: due_sessions.len(),
            deleted_sessions: 0,
            failed_sessions: 0,
        };
        for due in due_sessions {
            match self
                .delete_with_cause(
                    MeetingMutationRequest {
                        operation_id: retention_operation_id(due.session_id),
                        session_id: due.session_id,
                        expected_revision: due.revision,
                    },
                    DeletionCause::Retention,
                )
                .await
            {
                Ok(removal) if removal.removed => result.deleted_sessions += 1,
                Ok(_) => {}
                Err(error) => {
                    result.failed_sessions += 1;
                    log::warn!("Meeting retention deletion failed: {error:?}");
                }
            }
        }
        Ok(result)
    }

    pub async fn tray_snapshot(
        &self,
    ) -> Result<Option<MeetingSessionSnapshot>, MeetingCommandError> {
        let session_id = {
            let actor = self.actor_lock();
            actor
                .active
                .as_ref()
                .map(|active| active.session_id)
                .or(actor.tray_session_id)
        };
        let Some(session_id) = session_id else {
            return Ok(None);
        };
        let store = self.store().await?;
        match store.session_snapshot(session_id) {
            Ok(snapshot) => Ok(Some(snapshot)),
            Err(StoreError::NotFound) => {
                let mut actor = self.actor_lock();
                if actor.tray_session_id == Some(session_id) {
                    actor.tray_session_id = None;
                }
                Ok(None)
            }
            Err(error) => Err(map_store_error(error)),
        }
    }

    pub fn suggestion_sink(self: &Arc<Self>) -> Arc<dyn MeetingSuggestionSink> {
        Arc::new(SessionSuggestionSink {
            manager: Arc::clone(self),
        })
    }

    pub fn suggestion_service(&self) -> MeetingSuggestionService {
        self.suggestions.clone()
    }

    pub fn suggestions_list(&self, now_ns: u64) -> Vec<MeetingSuggestion> {
        self.suggestions.list(now_ns)
    }

    pub async fn create_preflight(
        &self,
        request: MeetingPreflightCreateRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        if request.expected_revision != 0
            || request.title.trim().is_empty()
            || request.requested_sources.is_empty()
            || !request
                .required_sources
                .iter()
                .all(|source| request.requested_sources.contains(source))
        {
            return Err(MeetingCommandError::InvalidRequest);
        }
        if let Some(suggestion_id) = request.suggestion_id {
            self.suggestions
                .take_for_preflight(suggestion_id, host_monotonic_now_ns())
                .ok_or(MeetingCommandError::ConsentStale)?;
        }
        validate_destination(
            &request.destination,
            request.remote_acknowledgement.as_ref(),
        )?;
        let store = self.store().await?;
        if let Some(receipt) = store
            .operation_receipt(request.operation_id)
            .map_err(map_store_error)?
        {
            let session_id = receipt.session_id.ok_or(MeetingCommandError::NotFound)?;
            return self.result_for_receipt(store, receipt, session_id);
        }
        let session_id = MeetingSessionId::new();
        let preflight = self.build_preflight_snapshot(session_id, &request);
        let (retention_policy, _) = store.default_retention_policy().map_err(map_store_error)?;
        let receipt = store
            .create_preflight(
                StoreMutation {
                    operation_id: request.operation_id,
                    requested_at_utc_ms: utc_now_ms(),
                    session_id,
                    expected_revision: request.expected_revision,
                    command: MeetingCommandKind::PreflightCreate,
                },
                request.title,
                request.origin,
                preflight,
                retention_policy,
            )
            .map_err(map_store_error)?;
        let result = self.result_for_receipt(store, receipt, session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }

    pub async fn create_manual_preflight_from_tray(
        &self,
    ) -> Result<MeetingSessionSnapshot, MeetingCommandError> {
        let result = self
            .create_preflight(MeetingPreflightCreateRequest {
                operation_id: MeetingOperationId::new(),
                expected_revision: 0,
                title: "Local notes".to_string(),
                origin: MeetingOrigin::Manual,
                suggestion_id: None,
                requested_sources: SourceKind::ALL.to_vec(),
                required_sources: SourceKind::ALL.to_vec(),
                accepted_known_missing_sources: Vec::new(),
                degraded_start_policy: DegradedStartPolicy::AbortIfRequiredSourceFails,
                destination: ProcessingDestination::Local,
                remote_acknowledgement: None,
                microphone_device_uid: None,
                frozen_system_audio_application_bundle_ids: Vec::new(),
            })
            .await?;
        let snapshot = result.snapshot;
        self.actor_lock().tray_session_id = Some(snapshot.session_id);
        Ok(snapshot)
    }

    pub async fn refresh_preflight(
        &self,
        request: MeetingPreflightRefreshRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        if let Some(receipt) = store
            .operation_receipt(request.operation_id)
            .map_err(map_store_error)?
        {
            return self.result_for_receipt(store, receipt, request.session_id);
        }
        let current = store
            .preflight_snapshot(request.session_id)
            .map_err(map_store_error)?;
        let refreshed_request = MeetingPreflightCreateRequest {
            operation_id: request.operation_id,
            expected_revision: request.expected_revision.saturating_add(1),
            title: current.proposed_title.clone(),
            origin: current.origin,
            suggestion_id: None,
            requested_sources: current
                .sources
                .iter()
                .map(|source| source.source_kind)
                .collect(),
            required_sources: current
                .sources
                .iter()
                .filter(|source| source.required)
                .map(|source| source.source_kind)
                .collect(),
            accepted_known_missing_sources: current.accepted_known_missing_sources.clone(),
            degraded_start_policy: current.degraded_start_policy,
            destination: current.destination.clone(),
            remote_acknowledgement: None,
            microphone_device_uid: current.microphone_device_uid.clone(),
            frozen_system_audio_application_bundle_ids: current
                .frozen_system_audio_application_bundle_ids
                .clone(),
        };
        let refreshed = self.build_preflight_snapshot(request.session_id, &refreshed_request);
        let receipt = store
            .refresh_preflight(
                request.operation_id,
                utc_now_ms(),
                request.session_id,
                request.expected_revision,
                refreshed,
            )
            .map_err(map_store_error)?;
        let result = self.result_for_receipt(store, receipt, request.session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }

    pub async fn cancel_preflight(
        &self,
        request: MeetingMutationRequest,
    ) -> Result<OperationReceipt, MeetingCommandError> {
        let store = self.store().await?;
        let receipt = store
            .cancel_preflight(
                request.operation_id,
                utc_now_ms(),
                request.session_id,
                request.expected_revision,
            )
            .map_err(map_store_error)?;
        if receipt.result == OperationResult::Committed {
            let mut actor = self.actor_lock();
            if actor.tray_session_id == Some(request.session_id) {
                actor.tray_session_id = None;
            }
            drop(actor);
            self.emit_removed(request.session_id, request.expected_revision);
        }
        Ok(receipt)
    }

    pub async fn start(
        &self,
        request: MeetingStartRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        if let Some(receipt) = store
            .operation_receipt(request.operation_id)
            .map_err(map_store_error)?
        {
            return self.result_for_receipt(store, receipt, request.session_id);
        }
        let mut actor = self.actor_lock();
        if actor.active.is_some() {
            return Err(MeetingCommandError::CaptureLeaseBusy);
        }
        let preflight = store
            .preflight_snapshot(request.session_id)
            .map_err(map_store_error)?;
        validate_consent(&preflight, &request.consent)?;
        let attempt_number = store
            .next_plan_attempt(request.session_id)
            .map_err(map_store_error)?;
        let plan = self.build_plan(
            request.session_id,
            request.expected_revision,
            attempt_number,
            &preflight,
            &request.consent,
            &store,
        )?;
        let consent = MeetingConsent {
            consent_id: plan.consent_id,
            session_id: request.session_id,
            attempt_number,
            preflight_revision: request.expected_revision,
            policy_version: request.consent.policy_version,
            acknowledged_at_utc_ms: utc_now_ms(),
            microphone_acknowledged: request.consent.microphone_acknowledged,
            system_audio_acknowledged: request.consent.system_audio_acknowledged,
            known_missing_sources_acknowledged: request
                .consent
                .known_missing_sources_acknowledged
                .clone(),
            degraded_start_policy: request.consent.degraded_start_policy,
            destination: request.consent.destination.clone(),
            remote_acknowledgement: request.consent.remote_acknowledgement.clone(),
        };
        let receipt = store
            .start_with_plan_and_consent(
                request.operation_id,
                utc_now_ms(),
                &plan,
                &consent,
                request.expected_revision,
            )
            .map_err(map_store_error)?;
        if receipt.result != OperationResult::Committed {
            drop(actor);
            return self.result_for_receipt(store, receipt, request.session_id);
        }
        self.acquire_keep_awake();
        self.processing.set_capture_active(true);

        let mut active_sources = HashMap::new();
        let source_provider = Arc::clone(&*self.sources_lock());
        for source_kind in &plan.requested_sources {
            let probe = source_provider.probe(*source_kind);
            if probe.availability != SourceAvailability::Available {
                continue;
            }
            let Ok(mut source) = source_provider.acquire(*source_kind) else {
                continue;
            };
            let track_id = SourceTrackId::new();
            let (sink, lane_reader) = PacketSink::new(
                track_id,
                usize::try_from(plan.storage.source_lane_sample_capacity)
                    .map_err(|_| MeetingCommandError::InvalidRequest)?,
                usize::try_from(plan.storage.source_lane_descriptor_capacity)
                    .map_err(|_| MeetingCommandError::InvalidRequest)?,
            );
            let source_plan = SourceStartPlan {
                session_id: request.session_id,
                track_id,
                source_kind: *source_kind,
                required: plan.required_sources.contains(source_kind),
                frozen_application_bundle_ids: plan
                    .frozen_system_audio_application_bundle_ids
                    .clone(),
                source_epoch: SourceEpoch::new(0),
            };
            let report = match source.start(source_plan, plan.session_clock_anchor, sink) {
                Ok(report) if report.track_id == track_id && report.source_kind == *source_kind => {
                    report
                }
                Ok(_) | Err(_) => continue,
            };
            store
                .create_track(TrackCreation {
                    session_id: request.session_id,
                    plan_id: plan.plan_id,
                    source_kind: *source_kind,
                    required: plan.required_sources.contains(source_kind),
                    requested: true,
                    descriptor_json: "{}",
                    report,
                })
                .map_err(map_store_error)?;
            let writer = store
                .open_track_writer(request.session_id, track_id, plan.storage.clone())
                .map_err(map_store_error)?;
            let worker = TrackWorker::start(Arc::clone(&store), writer, lane_reader, report);
            active_sources.insert(
                *source_kind,
                ActiveSource {
                    track_id,
                    epoch: report.epoch,
                    source,
                    worker,
                },
            );
        }

        let missing_required_source = plan
            .required_sources
            .iter()
            .any(|source_kind| !active_sources.contains_key(source_kind));
        if active_sources.is_empty()
            || (missing_required_source
                && plan.degraded_start_policy == DegradedStartPolicy::AbortIfRequiredSourceFails)
        {
            for source in active_sources.values_mut() {
                let _ = source.source.abort();
                let _ = source.worker.stop();
            }
            let snapshot = store
                .session_snapshot(request.session_id)
                .map_err(map_store_error)?;
            store
                .transition(StoreTransition {
                    operation_id: None,
                    actor: OperationActor::System,
                    command: MeetingCommandKind::Start,
                    requested_at_utc_ms: utc_now_ms(),
                    session_id: request.session_id,
                    expected_revision: snapshot.revision,
                    allowed_from: &[MeetingPhase::Starting],
                    next_phase: MeetingPhase::Preflight,
                    event_kind: "source_start_incomplete",
                    reason_codes: vec![MeetingReasonCode::SourceStartFailed],
                })
                .map_err(map_store_error)?;
            self.processing.set_capture_active(false);
            self.release_keep_awake();
            drop(actor);
            let snapshot = store
                .session_snapshot(request.session_id)
                .map_err(map_store_error)?;
            self.emit_session_changed(&snapshot);
            return Ok(MeetingMutationResult { receipt, snapshot });
        }

        store
            .open_capture_window(request.session_id, 0)
            .map_err(map_store_error)?;
        let starting_snapshot = store
            .session_snapshot(request.session_id)
            .map_err(map_store_error)?;
        store
            .transition(StoreTransition {
                operation_id: None,
                actor: OperationActor::System,
                command: MeetingCommandKind::Start,
                requested_at_utc_ms: utc_now_ms(),
                session_id: request.session_id,
                expected_revision: starting_snapshot.revision,
                allowed_from: &[MeetingPhase::Starting],
                next_phase: MeetingPhase::CapturingRecording,
                event_kind: "capture_started",
                reason_codes: Vec::new(),
            })
            .map_err(map_store_error)?;
        actor.active = Some(ActiveCapture {
            session_id: request.session_id,
            sources: active_sources,
        });
        actor.tray_session_id = None;
        drop(actor);
        let snapshot = store
            .session_snapshot(request.session_id)
            .map_err(map_store_error)?;
        self.emit_session_changed(&snapshot);
        Ok(MeetingMutationResult { receipt, snapshot })
    }

    pub async fn pause(
        &self,
        request: MeetingMutationRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        if let Some(receipt) = store
            .operation_receipt(request.operation_id)
            .map_err(map_store_error)?
        {
            return self.result_for_receipt(store, receipt, request.session_id);
        }
        let mut actor = self.actor_lock();
        let active = actor
            .active
            .as_mut()
            .filter(|active| active.session_id == request.session_id)
            .ok_or(MeetingCommandError::NotFound)?;
        let receipt = required_transition(
            &store,
            &request,
            MeetingCommandKind::Pause,
            &[MeetingPhase::CapturingRecording],
            MeetingPhase::CapturingPausing,
            "pause_requested",
        )?;
        if receipt.result != OperationResult::Committed {
            drop(actor);
            return self.result_for_receipt(store, receipt, request.session_id);
        }
        for source in active.sources.values_mut() {
            if source.source.pause().is_err() {
                store
                    .record_gap(&SourceGap {
                        track_id: source.track_id,
                        epoch: source.epoch,
                        start_offset_ns: None,
                        end_offset_ns: None,
                        reason: SourceGapReason::SourceStopped,
                        dropped_frames: None,
                    })
                    .map_err(map_store_error)?;
                store
                    .update_track_health(request.session_id, source.track_id, SourceHealth::Failed)
                    .map_err(map_store_error)?;
            }
        }
        let snapshot = store
            .session_snapshot(request.session_id)
            .map_err(map_store_error)?;
        let end = snapshot.elapsed_offset_ns.unwrap_or(0);
        store
            .close_open_capture_window(request.session_id, end, "paused")
            .map_err(map_store_error)?;
        let pausing = store
            .session_snapshot(request.session_id)
            .map_err(map_store_error)?;
        store
            .transition(StoreTransition {
                operation_id: None,
                actor: OperationActor::System,
                command: MeetingCommandKind::Pause,
                requested_at_utc_ms: utc_now_ms(),
                session_id: request.session_id,
                expected_revision: pausing.revision,
                allowed_from: &[MeetingPhase::CapturingPausing],
                next_phase: MeetingPhase::CapturingPaused,
                event_kind: "pause_confirmed",
                reason_codes: Vec::new(),
            })
            .map_err(map_store_error)?;
        self.release_keep_awake();
        drop(actor);
        let snapshot = store
            .session_snapshot(request.session_id)
            .map_err(map_store_error)?;
        self.emit_session_changed(&snapshot);
        Ok(MeetingMutationResult { receipt, snapshot })
    }

    pub async fn resume(
        &self,
        request: MeetingMutationRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        if let Some(receipt) = store
            .operation_receipt(request.operation_id)
            .map_err(map_store_error)?
        {
            return self.result_for_receipt(store, receipt, request.session_id);
        }
        let mut actor = self.actor_lock();
        let active = actor
            .active
            .as_mut()
            .filter(|active| active.session_id == request.session_id)
            .ok_or(MeetingCommandError::NotFound)?;
        let receipt = required_transition(
            &store,
            &request,
            MeetingCommandKind::Resume,
            &[MeetingPhase::CapturingPaused],
            MeetingPhase::CapturingResuming,
            "resume_requested",
        )?;
        if receipt.result != OperationResult::Committed {
            drop(actor);
            return self.result_for_receipt(store, receipt, request.session_id);
        }
        self.acquire_keep_awake();
        for source in active.sources.values_mut() {
            let next_epoch = source
                .epoch
                .get()
                .checked_add(1)
                .map(SourceEpoch::new)
                .ok_or(MeetingCommandError::InvalidRequest)?;
            match source.source.resume(next_epoch) {
                Ok(report)
                    if report.track_id == source.track_id
                        && report.epoch.get() >= next_epoch.get() =>
                {
                    source.epoch = report.epoch;
                }
                Ok(_) | Err(_) => {
                    let _ = source.source.abort();
                    store
                        .record_gap(&SourceGap {
                            track_id: source.track_id,
                            epoch: next_epoch,
                            start_offset_ns: None,
                            end_offset_ns: None,
                            reason: SourceGapReason::SourceStopped,
                            dropped_frames: None,
                        })
                        .map_err(map_store_error)?;
                    store
                        .update_track_health(
                            request.session_id,
                            source.track_id,
                            SourceHealth::Failed,
                        )
                        .map_err(map_store_error)?;
                }
            }
        }
        let resuming = store
            .session_snapshot(request.session_id)
            .map_err(map_store_error)?;
        store
            .open_capture_window(request.session_id, resuming.elapsed_offset_ns.unwrap_or(0))
            .map_err(map_store_error)?;
        store
            .transition(StoreTransition {
                operation_id: None,
                actor: OperationActor::System,
                command: MeetingCommandKind::Resume,
                requested_at_utc_ms: utc_now_ms(),
                session_id: request.session_id,
                expected_revision: resuming.revision,
                allowed_from: &[MeetingPhase::CapturingResuming],
                next_phase: MeetingPhase::CapturingRecording,
                event_kind: "resume_confirmed",
                reason_codes: Vec::new(),
            })
            .map_err(map_store_error)?;
        drop(actor);
        let snapshot = store
            .session_snapshot(request.session_id)
            .map_err(map_store_error)?;
        self.emit_session_changed(&snapshot);
        Ok(MeetingMutationResult { receipt, snapshot })
    }

    pub async fn stop(
        &self,
        request: MeetingMutationRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        if let Some(receipt) = store
            .operation_receipt(request.operation_id)
            .map_err(map_store_error)?
        {
            return self.result_for_receipt(store, receipt, request.session_id);
        }
        let mut actor = self.actor_lock();
        let receipt = required_transition(
            &store,
            &request,
            MeetingCommandKind::Stop,
            &[
                MeetingPhase::Starting,
                MeetingPhase::CapturingRecording,
                MeetingPhase::CapturingPausing,
                MeetingPhase::CapturingPaused,
                MeetingPhase::CapturingResuming,
            ],
            MeetingPhase::Stopping,
            "stop_requested",
        )?;
        if receipt.result != OperationResult::Committed {
            drop(actor);
            return self.result_for_receipt(store, receipt, request.session_id);
        }
        let mut active = actor
            .active
            .take()
            .filter(|active| active.session_id == request.session_id)
            .ok_or(MeetingCommandError::NotFound)?;
        for source in active.sources.values_mut() {
            if let Ok(report) = source.source.stop() {
                for gap in report.observed_gaps {
                    store.record_gap(&gap).map_err(map_store_error)?;
                }
            }
            source.worker.stop().map_err(map_store_error)?;
        }
        let stopping = store
            .session_snapshot(request.session_id)
            .map_err(map_store_error)?;
        store
            .close_open_capture_window(
                request.session_id,
                stopping.elapsed_offset_ns.unwrap_or(0),
                "stopped",
            )
            .map_err(map_store_error)?;
        store
            .transition(StoreTransition {
                operation_id: None,
                actor: OperationActor::System,
                command: MeetingCommandKind::Stop,
                requested_at_utc_ms: utc_now_ms(),
                session_id: request.session_id,
                expected_revision: stopping.revision,
                allowed_from: &[MeetingPhase::Stopping],
                next_phase: MeetingPhase::Processing,
                event_kind: "capture_sealed",
                reason_codes: Vec::new(),
            })
            .map_err(map_store_error)?;
        self.processing.set_capture_active(false);
        self.release_keep_awake();
        actor.tray_session_id = Some(request.session_id);
        drop(active);
        drop(actor);
        self.processing
            .submit(Arc::clone(&store), request.session_id);
        let snapshot = store
            .session_snapshot(request.session_id)
            .map_err(map_store_error)?;
        self.emit_session_changed(&snapshot);
        Ok(MeetingMutationResult { receipt, snapshot })
    }

    pub async fn discard(
        &self,
        request: MeetingMutationRequest,
    ) -> Result<MeetingRemovalResult, MeetingCommandError> {
        self.delete_with_cause(request, DeletionCause::Discard)
            .await
    }

    pub async fn delete(
        &self,
        request: MeetingMutationRequest,
    ) -> Result<MeetingRemovalResult, MeetingCommandError> {
        self.delete_with_cause(request, DeletionCause::User).await
    }

    async fn delete_with_cause(
        &self,
        request: MeetingMutationRequest,
        cause: DeletionCause,
    ) -> Result<MeetingRemovalResult, MeetingCommandError> {
        let store = self.store().await?;
        let (receipt, job_id) = store
            .reserve_deletion(
                request.operation_id,
                utc_now_ms(),
                request.session_id,
                request.expected_revision,
                cause,
            )
            .map_err(map_store_error)?;
        if receipt.result == OperationResult::Rejected {
            return Ok(MeetingRemovalResult {
                receipt,
                session_id: request.session_id,
                removed: false,
            });
        }
        if !self.is_capture_active() {
            store
                .enqueue_cloud_tombstone_for_session(
                    request.session_id,
                    receipt.new_revision.unwrap_or(request.expected_revision),
                    format!("tombstone-{}", job_id.uuid()),
                    utc_now_ms(),
                )
                .map_err(map_store_error)?;
        }

        self.processing.cancel(request.session_id);
        self.processing.set_capture_active(false);
        self.release_keep_awake();

        let active = {
            let mut actor = self.actor_lock();
            if actor.tray_session_id == Some(request.session_id) {
                actor.tray_session_id = None;
            }
            if actor
                .active
                .as_ref()
                .is_some_and(|active| active.session_id == request.session_id)
            {
                actor.active.take()
            } else {
                None
            }
        };

        if let Some(mut active) = active {
            for source in active.sources.values_mut() {
                let _ = source.source.abort();
                source.worker.stop().map_err(map_store_error)?;
            }
        }
        store.finish_deletion(job_id).map_err(map_store_error)?;
        self.emit_removed(
            request.session_id,
            receipt.new_revision.unwrap_or(request.expected_revision),
        );
        Ok(MeetingRemovalResult {
            receipt,
            session_id: request.session_id,
            removed: true,
        })
    }

    pub async fn recovery_list(&self) -> Result<Vec<MeetingHistorySummary>, MeetingCommandError> {
        let store = self.store().await?;
        Ok(store
            .list_sessions(None, 100)
            .map_err(map_store_error)?
            .entries
            .into_iter()
            .filter(|summary| summary.phase == MeetingPhase::RecoveryRequired)
            .collect())
    }

    pub async fn recovery_finalize(
        &self,
        request: MeetingMutationRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        let receipt = required_transition(
            &store,
            &request,
            MeetingCommandKind::RecoveryFinalize,
            &[MeetingPhase::RecoveryRequired],
            MeetingPhase::Processing,
            "recovery_finalized_partial",
        )?;
        if receipt.result == OperationResult::Committed {
            self.processing.set_capture_active(false);
            self.processing
                .submit(Arc::clone(&store), request.session_id);
        }
        let result = self.result_for_receipt(store, receipt, request.session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }

    pub async fn list(
        &self,
        cursor_utc_ms: Option<i64>,
        limit: usize,
    ) -> Result<PaginatedMeetings, MeetingCommandError> {
        self.store()
            .await?
            .list_sessions(cursor_utc_ms, limit)
            .map_err(map_store_error)
    }

    /// Dashboard trend reads are optional when encrypted meeting storage is
    /// unavailable. Returning the tagged projection keeps that state distinct
    /// from a real empty range.
    pub async fn trend_projection(&self, request: DashboardTrendRequest) -> MeetingTrendProjection {
        let range = request.range;
        let Ok(store) = self.store().await else {
            return MeetingTrendProjection::unavailable(range);
        };
        store
            .trend_projection(request)
            .unwrap_or_else(|_| MeetingTrendProjection::unavailable(range))
    }

    pub async fn get(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingReviewSnapshot, MeetingCommandError> {
        self.store()
            .await?
            .review_snapshot(session_id)
            .map_err(map_store_error)
    }

    pub async fn search(
        &self,
        request: MeetingSearchRequest,
    ) -> Result<MeetingSearchResult, MeetingCommandError> {
        if request.session_ids.is_empty() {
            return Err(MeetingCommandError::InvalidRequest);
        }
        let evidence = self
            .store()
            .await?
            .search_evidence(
                &request.session_ids,
                &request.query,
                request.limit.unwrap_or(20).clamp(1, 50),
            )
            .map_err(map_store_error)?;
        Ok(MeetingSearchResult {
            entries: evidence
                .into_iter()
                .map(|evidence| MeetingSearchHit {
                    session_id: evidence.citation.session_id,
                    kind: evidence.citation.kind,
                    entity_id: evidence.citation.entity_id,
                    start_offset_ns: evidence.citation.start_offset_ns,
                    end_offset_ns: evidence.citation.end_offset_ns,
                    excerpt: evidence.text,
                })
                .collect(),
        })
    }

    pub async fn title_set(
        &self,
        request: MeetingTitleSetRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        let receipt = store
            .set_title(
                request.operation_id,
                utc_now_ms(),
                request.session_id,
                request.expected_revision,
                request.title,
            )
            .map_err(map_store_error)?;
        let result = self.result_for_receipt(store, receipt, request.session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }

    pub async fn speaker_rename(
        &self,
        request: MeetingSpeakerRenameRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        let receipt = store
            .rename_speaker(
                request.operation_id,
                utc_now_ms(),
                request.session_id,
                request.expected_revision,
                request.speaker_id,
                request.display_name,
            )
            .map_err(map_store_error)?;
        let result = self.result_for_receipt(store, receipt, request.session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }

    pub async fn speaker_merge(
        &self,
        request: MeetingSpeakerMergeRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        let receipt = store
            .merge_speaker(
                request.operation_id,
                utc_now_ms(),
                request.session_id,
                request.expected_revision,
                request.source_speaker_id,
                request.target_speaker_id,
            )
            .map_err(map_store_error)?;
        let result = self.result_for_receipt(store, receipt, request.session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }

    pub async fn segment_edit(
        &self,
        request: MeetingSegmentEditRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        let receipt = store
            .edit_segment(SegmentEdit {
                mutation: StoreMutation {
                    operation_id: request.operation_id,
                    requested_at_utc_ms: utc_now_ms(),
                    session_id: request.session_id,
                    expected_revision: request.expected_revision,
                    command: MeetingCommandKind::SegmentEdit,
                },
                segment_id: request.segment_id,
                replacement_text: request.replacement_text,
                removed: request.removed,
            })
            .map_err(map_store_error)?;
        let result = self.result_for_receipt(store, receipt, request.session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }

    pub async fn note_create(
        &self,
        request: MeetingNoteCreateRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        let now = utc_now_ms();
        let note = ManualNote {
            note_id: ManualNoteId::new(),
            session_id: request.session_id,
            start_offset_ns: request.start_offset_ns,
            end_offset_ns: request.end_offset_ns,
            body: request.body,
            revision: 0,
            created_at_utc_ms: now,
            updated_at_utc_ms: now,
        };
        let receipt = store
            .create_note(request.operation_id, now, &note, request.expected_revision)
            .map_err(map_store_error)?;
        let result = self.result_for_receipt(store, receipt, request.session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }

    pub async fn note_update(
        &self,
        request: MeetingNoteUpdateRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        let note = ManualNote {
            note_id: request.note_id,
            session_id: request.session_id,
            start_offset_ns: request.start_offset_ns,
            end_offset_ns: request.end_offset_ns,
            body: request.body,
            revision: request
                .expected_note_revision
                .checked_add(1)
                .ok_or(MeetingCommandError::InvalidRequest)?,
            created_at_utc_ms: 0,
            updated_at_utc_ms: utc_now_ms(),
        };
        let receipt = store
            .update_note(
                request.operation_id,
                utc_now_ms(),
                &note,
                request.expected_revision,
                request.expected_note_revision,
            )
            .map_err(map_store_error)?;
        let result = self.result_for_receipt(store, receipt, request.session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }

    pub async fn note_delete(
        &self,
        request: MeetingNoteDeleteRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        let receipt = store
            .delete_note(
                request.operation_id,
                utc_now_ms(),
                request.session_id,
                request.expected_revision,
                request.note_id,
                request.expected_note_revision,
            )
            .map_err(map_store_error)?;
        let result = self.result_for_receipt(store, receipt, request.session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }

    pub async fn artifacts_regenerate(
        &self,
        request: MeetingMutationRequest,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        if let Some(receipt) = store
            .operation_receipt(request.operation_id)
            .map_err(map_store_error)?
        {
            return self.result_for_receipt(store, receipt, request.session_id);
        }
        let artifact = self
            .processing
            .regenerate(&store, request.session_id, request.expected_revision)
            .map_err(map_processing_error)?;
        let receipt = store
            .record_artifact_regeneration(
                request.operation_id,
                utc_now_ms(),
                request.session_id,
                request.expected_revision,
                artifact.artifact_id,
            )
            .map_err(map_store_error)?;
        if receipt.result == OperationResult::Rejected {
            return Err(MeetingCommandError::StaleRevision);
        }
        let result = self.result_for_receipt(store, receipt, request.session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }
    pub async fn export(
        &self,
        request: MeetingExportRequest,
    ) -> Result<MeetingExportResult, MeetingCommandError> {
        let store = self.store().await?;
        if let Some(result) = store
            .export_result_for_operation(request.operation_id)
            .map_err(map_store_error)?
        {
            return Ok(result);
        }
        if store
            .operation_receipt(request.operation_id)
            .map_err(map_store_error)?
            .is_some()
        {
            return Err(MeetingCommandError::InvalidRequest);
        }

        let review = store
            .review_snapshot(request.session_id)
            .map_err(map_store_error)?;
        if review.session.revision != request.expected_revision {
            return Err(MeetingCommandError::StaleRevision);
        }
        if !review.can_export {
            return Err(MeetingCommandError::InvalidTransition);
        }
        let contents = export::render(request.format, &review)
            .map_err(|_| MeetingCommandError::ExportFailed)?;
        let app = self.app.clone().ok_or(MeetingCommandError::ExportFailed)?;
        let (filter_name, extension, file_name) = match request.format {
            MeetingExportFormat::Json => ("JSON", "json", "meeting.json"),
            MeetingExportFormat::Markdown => ("Markdown", "md", "meeting.md"),
        };
        let selected = tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .file()
                .add_filter(filter_name, &[extension])
                .set_file_name(file_name)
                .blocking_save_file()
                .map(|path| path.into_path().map_err(|_| ()))
        })
        .await
        .map_err(|_| MeetingCommandError::ExportFailed)?;
        let path = selected
            .ok_or(MeetingCommandError::ExportCancelled)?
            .map_err(|_| MeetingCommandError::ExportFailed)?;
        tauri::async_runtime::spawn_blocking(move || export::write_atomic(&path, &contents))
            .await
            .map_err(|_| MeetingCommandError::ExportFailed)?
            .map_err(|_| MeetingCommandError::ExportFailed)?;
        store
            .record_export(
                request.operation_id,
                utc_now_ms(),
                request.session_id,
                request.expected_revision,
                request.format,
            )
            .map_err(map_store_error)
    }

    pub async fn question_ask(
        &self,
        request: MeetingQuestionRequest,
    ) -> Result<MeetingQuestionResult, MeetingCommandError> {
        let store = self.store().await?;
        if let Some(receipt) = store
            .operation_receipt(request.operation_id)
            .map_err(map_store_error)?
        {
            let snapshot = store
                .session_snapshot(request.session_id)
                .map_err(map_store_error)?;
            let review = store
                .review_snapshot(request.session_id)
                .map_err(map_store_error)?;
            if let Some(answer) = review
                .questions
                .into_iter()
                .find(|answer| answer.question_id == request.question_id)
            {
                return Ok(MeetingQuestionResult {
                    receipt,
                    snapshot,
                    answer,
                });
            }
            if request.save_history {
                return Err(MeetingCommandError::NotFound);
            }
        }
        let (receipt, answer) = self
            .processing
            .ask_question(
                &store,
                QuestionGenerationRequest {
                    operation_id: request.operation_id,
                    requested_at_utc_ms: utc_now_ms(),
                    session_id: request.session_id,
                    expected_revision: request.expected_revision,
                    question_id: request.question_id,
                    question: request.question,
                    scope: request.scope,
                    save_history: request.save_history,
                },
            )
            .map_err(map_processing_error)?;
        let snapshot = store
            .session_snapshot(request.session_id)
            .map_err(map_store_error)?;
        self.emit_session_changed(&snapshot);
        Ok(MeetingQuestionResult {
            receipt,
            snapshot,
            answer,
        })
    }

    pub async fn question_forget(
        &self,
        request: MeetingMutationRequest,
        question_id: MeetingQuestionId,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let store = self.store().await?;
        let receipt = store
            .forget_question(
                request.operation_id,
                utc_now_ms(),
                request.session_id,
                request.expected_revision,
                question_id,
            )
            .map_err(map_store_error)?;
        let result = self.result_for_receipt(store, receipt, request.session_id)?;
        self.emit_session_changed(&result.snapshot);
        Ok(result)
    }

    pub async fn retention_get(&self) -> Result<MeetingRetentionSnapshot, MeetingCommandError> {
        let (policy, revision) = self
            .store()
            .await?
            .default_retention_policy()
            .map_err(map_store_error)?;
        Ok(MeetingRetentionSnapshot { policy, revision })
    }

    pub async fn retention_set(
        &self,
        request: MeetingRetentionSetRequest,
    ) -> Result<MeetingRetentionMutationResult, MeetingCommandError> {
        if matches!(
            request.policy,
            MeetingRetentionPolicy::DeleteAfterDays { days: 0 }
        ) {
            return Err(MeetingCommandError::InvalidRequest);
        }
        let store = self.store().await?;
        let (receipt, _) = store
            .set_default_retention_policy(
                request.operation_id,
                utc_now_ms(),
                request.expected_revision,
                &request.policy,
            )
            .map_err(map_store_error)?;
        let (policy, revision) = store.default_retention_policy().map_err(map_store_error)?;
        Ok(MeetingRetentionMutationResult {
            receipt,
            snapshot: MeetingRetentionSnapshot { policy, revision },
        })
    }

    pub async fn remote_cancel(
        &self,
        request: MeetingMutationRequest,
    ) -> Result<(), MeetingCommandError> {
        let snapshot = self
            .store()
            .await?
            .session_snapshot(request.session_id)
            .map_err(map_store_error)?;
        if snapshot.revision != request.expected_revision {
            return Err(MeetingCommandError::StaleRevision);
        }
        if !snapshot
            .allowed_actions
            .contains(&AllowedMeetingAction::CancelRemote)
        {
            return Err(MeetingCommandError::NotFound);
        }
        Err(MeetingCommandError::RemoteUnavailable)
    }

    /// Returns the startup-recovered cached store without opening another SQLCipher connection.
    pub(crate) async fn cloud_store(&self) -> Result<Arc<MeetingStore>, MeetingCommandError> {
        if !self.recovery_complete.load(Ordering::Acquire) {
            return Err(MeetingCommandError::StorageUnavailable);
        }
        self.store_lock()
            .clone()
            .ok_or(MeetingCommandError::StorageUnavailable)
    }
    pub(crate) async fn import_cloud_bundle(
        &self,
        bundle: super::cloud_bundle::CloudMeetingBundleV1,
    ) -> Result<MeetingSessionSnapshot, MeetingCommandError> {
        let store = self.cloud_store().await?;
        let session_id = bundle.import_into_store(&store).map_err(map_store_error)?;
        let snapshot = store
            .session_snapshot(session_id)
            .map_err(map_store_error)?;
        self.emit_session_changed(&snapshot);
        Ok(snapshot)
    }

    /// Reports whether the lifecycle actor currently owns a live capture lease.
    pub(crate) fn is_capture_active(&self) -> bool {
        self.actor_lock().active.is_some()
    }

    async fn store(&self) -> Result<Arc<MeetingStore>, MeetingCommandError> {
        if let Some(store) = self.store_lock().clone() {
            return Ok(store);
        }
        let root = self
            .root
            .clone()
            .ok_or(MeetingCommandError::StorageUnavailable)?;
        let key = self
            .secrets
            .meeting_storage_key()
            .await
            .map_err(map_secret_error)?;
        let opened = MeetingStore::open(root, key).map_err(map_store_error)?;
        let mut cached = self.store_lock();
        Ok(cached.get_or_insert(opened).clone())
    }

    fn build_preflight_snapshot(
        &self,
        session_id: MeetingSessionId,
        request: &MeetingPreflightCreateRequest,
    ) -> MeetingPreflightSnapshot {
        let provider = Arc::clone(&*self.sources_lock());
        let sources = request
            .requested_sources
            .iter()
            .map(|source_kind| {
                let probe = provider.probe(*source_kind);
                MeetingSourceSnapshot {
                    track_id: None,
                    source_kind: *source_kind,
                    required: request.required_sources.contains(source_kind),
                    availability: probe.availability,
                    health: probe.health,
                    format: probe.negotiated_format,
                    last_durable_offset_ns: None,
                    gap_count: 0,
                }
            })
            .collect();
        MeetingPreflightSnapshot {
            session_id,
            revision: request.expected_revision,
            proposed_title: request.title.clone(),
            origin: request.origin,
            sources,
            storage: StorageAvailability::Available,
            local_processing: self.processing.local_processing_availability(),
            destination: request.destination.clone(),
            microphone_device_uid: request.microphone_device_uid.clone(),
            frozen_system_audio_application_bundle_ids: request
                .frozen_system_audio_application_bundle_ids
                .clone(),
            accepted_known_missing_sources: request.accepted_known_missing_sources.clone(),
            degraded_start_policy: request.degraded_start_policy,
            required_acknowledgements: request.required_sources.clone(),
            allowed_actions: vec![
                AllowedMeetingAction::RefreshPreflight,
                AllowedMeetingAction::CancelPreflight,
                AllowedMeetingAction::Start,
            ],
        }
    }

    fn build_plan(
        &self,
        session_id: MeetingSessionId,
        preflight_revision: u64,
        attempt_number: u32,
        preflight: &MeetingPreflightSnapshot,
        consent: &MeetingConsentInput,
        store: &MeetingStore,
    ) -> Result<MeetingRunPlan, MeetingCommandError> {
        let retention_policy = store
            .session_retention_policy(session_id)
            .map_err(map_store_error)?;
        let asr_model_id = self.processing.current_asr_model_id();
        let language = self
            .app
            .as_ref()
            .map(|app| crate::settings::get_settings(app).selected_language)
            .unwrap_or_else(|| "und".to_string());
        Ok(MeetingRunPlan {
            plan_id: MeetingPlanId::new(),
            session_id,
            consent_id: ConsentId::new(),
            attempt_number,
            schema_version: STORE_SCHEMA_VERSION,
            app_build: env!("CARGO_PKG_VERSION").to_string(),
            preflight_revision,
            requested_sources: preflight
                .sources
                .iter()
                .map(|source| source.source_kind)
                .collect(),
            required_sources: preflight
                .sources
                .iter()
                .filter(|source| source.required)
                .map(|source| source.source_kind)
                .collect(),
            accepted_known_missing_sources: preflight.accepted_known_missing_sources.clone(),
            degraded_start_policy: preflight.degraded_start_policy,
            microphone_device_uid: preflight.microphone_device_uid.clone(),
            frozen_system_audio_application_bundle_ids: preflight
                .frozen_system_audio_application_bundle_ids
                .clone(),
            session_clock_anchor: SessionClockAnchor {
                host_monotonic_anchor_ns: host_monotonic_now_ns(),
                wall_start_utc_ms: utc_now_ms(),
                clock_policy_version: 1,
            },
            storage: MeetingStoragePlan {
                format_version: 1,
                record_max_payload_bytes: DEFAULT_RECORD_MAX_PAYLOAD_BYTES,
                checkpoint_interval_ms: DEFAULT_CHECKPOINT_INTERVAL_MS,
                source_lane_sample_capacity: DEFAULT_SOURCE_SAMPLE_CAPACITY,
                source_lane_descriptor_capacity: DEFAULT_SOURCE_DESCRIPTOR_CAPACITY,
            },
            language,
            asr_model_id: asr_model_id.clone(),
            asr_model_version: asr_model_id,
            diarization_model_id: Some(crate::meeting::diarization::model_manifest().id.clone()),
            diarization_model_version: Some(
                crate::meeting::diarization::model_manifest()
                    .revision
                    .clone(),
            ),
            destination: consent.destination.clone(),
            remote_acknowledgement: consent.remote_acknowledgement.clone(),
            retention_policy,
        })
    }

    fn result_for_receipt(
        &self,
        store: Arc<MeetingStore>,
        receipt: OperationReceipt,
        session_id: MeetingSessionId,
    ) -> Result<MeetingMutationResult, MeetingCommandError> {
        let snapshot = store
            .session_snapshot(session_id)
            .map_err(map_store_error)?;
        Ok(MeetingMutationResult { receipt, snapshot })
    }

    fn actor_lock(&self) -> std::sync::MutexGuard<'_, ActorState> {
        self.actor
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn sources_lock(&self) -> std::sync::MutexGuard<'_, Arc<dyn MeetingSourceProvider>> {
        self.sources
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn store_lock(&self) -> std::sync::MutexGuard<'_, Option<Arc<MeetingStore>>> {
        self.store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn emit_session_changed(&self, snapshot: &MeetingSessionSnapshot) {
        if let Some(app) = &self.app {
            let _ = app.emit(
                "meeting:session-changed",
                MeetingEventPayload {
                    event_schema_version: MEETING_EVENT_SCHEMA_VERSION,
                    session_id: Some(snapshot.session_id),
                    revision: snapshot.revision,
                },
            );
        }
    }

    fn emit_removed(&self, session_id: MeetingSessionId, revision: u64) {
        if let Some(app) = &self.app {
            let _ = app.emit(
                "meeting:removed",
                MeetingEventPayload {
                    event_schema_version: MEETING_EVENT_SCHEMA_VERSION,
                    session_id: Some(session_id),
                    revision,
                },
            );
        }
    }
}

struct SessionSuggestionSink {
    manager: Arc<MeetingSessionManager>,
}

impl MeetingSuggestionSink for SessionSuggestionSink {
    fn submit(&self, signal: MeetingSuggestionSignal) {
        self.manager.suggestions.submit(signal);
        if let Some(app) = &self.manager.app {
            let _ = app.emit(
                "meeting:suggestion-changed",
                MeetingEventPayload {
                    event_schema_version: MEETING_EVENT_SCHEMA_VERSION,
                    session_id: None,
                    revision: 0,
                },
            );
        }
    }
}

impl TrackWorker {
    fn start(
        store: Arc<MeetingStore>,
        writer: MeetingTrackWriter,
        reader: PacketLaneReader,
        report: SourceStartReport,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let handle =
            thread::spawn(move || run_track_worker(store, writer, reader, report, worker_stop));
        Self {
            stop,
            handle: Some(handle),
        }
    }

    fn stop(&mut self) -> Result<(), StoreError> {
        self.stop.store(true, Ordering::Release);
        let Some(handle) = self.handle.take() else {
            return Ok(());
        };
        handle.join().map_err(|_| StoreError::Unavailable)??;
        Ok(())
    }
}

fn run_track_worker(
    store: Arc<MeetingStore>,
    mut writer: MeetingTrackWriter,
    mut reader: PacketLaneReader,
    report: SourceStartReport,
    stop: Arc<AtomicBool>,
) -> Result<(), StoreError> {
    let mut bridges = HashMap::new();
    bridges.insert(
        (report.epoch.get(), report.format_epoch),
        report.timestamp_bridge,
    );
    let mut samples = Vec::new();
    loop {
        let mut progressed = false;
        while let Some(epoch) = reader.pop_clock_epoch() {
            store.record_clock_epoch(epoch)?;
            bridges.insert((epoch.epoch.get(), epoch.format_epoch), epoch.bridge);
            progressed = true;
        }
        while let Some(gap) = reader.pop_gap() {
            store.record_gap(&gap)?;
            progressed = true;
        }
        if reader.take_gap_overflow() {
            store.record_gap(&SourceGap {
                track_id: report.track_id,
                epoch: report.epoch,
                start_offset_ns: None,
                end_offset_ns: None,
                reason: SourceGapReason::WriterPressure,
                dropped_frames: None,
            })?;
            progressed = true;
        }
        match reader.pop_into(&mut samples) {
            Ok(Some(packet)) => {
                let bridge = bridges
                    .get(&(packet.source_epoch.get(), packet.format_epoch))
                    .copied();
                if let Some(bridge) = bridge {
                    let _ = writer.accept_with_bridge(packet, &samples, bridge)?;
                } else {
                    store.record_gap(&SourceGap {
                        track_id: packet.track_id,
                        epoch: packet.source_epoch,
                        start_offset_ns: None,
                        end_offset_ns: None,
                        reason: SourceGapReason::TimestampDiscontinuity,
                        dropped_frames: Some(u64::from(packet.frame_count)),
                    })?;
                }
                progressed = true;
            }
            Ok(None) => {}
            Err(PacketLaneReadError::DescriptorWithoutSamples) => {
                store.record_gap(&SourceGap {
                    track_id: report.track_id,
                    epoch: report.epoch,
                    start_offset_ns: None,
                    end_offset_ns: None,
                    reason: SourceGapReason::PacketDropped,
                    dropped_frames: None,
                })?;
                progressed = true;
            }
        }
        if stop.load(Ordering::Acquire) && !progressed {
            return writer.seal();
        }
        if !progressed {
            thread::sleep(Duration::from_millis(5));
        }
    }
}

fn required_transition(
    store: &MeetingStore,
    request: &MeetingMutationRequest,
    command: MeetingCommandKind,
    allowed_from: &[MeetingPhase],
    next_phase: MeetingPhase,
    event_kind: &str,
) -> Result<OperationReceipt, MeetingCommandError> {
    store
        .transition(StoreTransition {
            operation_id: Some(request.operation_id),
            actor: OperationActor::User,
            command,
            requested_at_utc_ms: utc_now_ms(),
            session_id: request.session_id,
            expected_revision: request.expected_revision,
            allowed_from,
            next_phase,
            event_kind,
            reason_codes: Vec::new(),
        })
        .map_err(map_store_error)?
        .ok_or(MeetingCommandError::InvalidRequest)
}

fn validate_destination(
    destination: &ProcessingDestination,
    acknowledgement: Option<&RemoteAcknowledgement>,
) -> Result<(), MeetingCommandError> {
    match destination {
        ProcessingDestination::Local => Ok(()),
        ProcessingDestination::Remote { destination_id } => acknowledgement
            .filter(|acknowledgement| acknowledgement.destination_id == *destination_id)
            .map(|_| ())
            .ok_or(MeetingCommandError::ConsentRequired),
    }
}

fn validate_consent(
    preflight: &MeetingPreflightSnapshot,
    consent: &MeetingConsentInput,
) -> Result<(), MeetingCommandError> {
    validate_destination(
        &consent.destination,
        consent.remote_acknowledgement.as_ref(),
    )?;
    if preflight.destination != consent.destination {
        return Err(MeetingCommandError::ConsentStale);
    }
    for source in &preflight.required_acknowledgements {
        match source {
            SourceKind::Microphone if !consent.microphone_acknowledged => {
                return Err(MeetingCommandError::ConsentRequired)
            }
            SourceKind::SystemAudio if !consent.system_audio_acknowledged => {
                return Err(MeetingCommandError::ConsentRequired)
            }
            _ => {}
        }
    }
    let unavailable_required = preflight
        .sources
        .iter()
        .filter(|source| source.required && source.availability != SourceAvailability::Available)
        .map(|source| source.source_kind)
        .collect::<Vec<_>>();
    if !unavailable_required.is_empty()
        && (consent.degraded_start_policy != DegradedStartPolicy::ContinueAndMarkPartial
            || !unavailable_required
                .iter()
                .all(|source| consent.known_missing_sources_acknowledged.contains(source)))
    {
        return Err(MeetingCommandError::SourceUnavailable);
    }
    Ok(())
}

fn map_secret_error(error: SecretResolveError) -> MeetingCommandError {
    match error {
        SecretResolveError::NotFound | SecretResolveError::Store(_) => {
            MeetingCommandError::StorageUnavailable
        }
    }
}

fn map_store_error(error: StoreError) -> MeetingCommandError {
    match error {
        StoreError::NotFound => MeetingCommandError::NotFound,
        StoreError::Conflict => MeetingCommandError::InvalidTransition,
        StoreError::Invalid => MeetingCommandError::InvalidRequest,
        StoreError::EncryptionUnavailable
        | StoreError::Unavailable
        | StoreError::Io
        | StoreError::Corrupt => MeetingCommandError::StorageUnavailable,
    }
}

fn map_processing_error(error: ProcessingFailure) -> MeetingCommandError {
    match error {
        ProcessingFailure::LocalModelUnavailable => MeetingCommandError::LocalModelUnavailable,
        ProcessingFailure::RemoteUnavailable => MeetingCommandError::RemoteUnavailable,
        ProcessingFailure::Cancelled => MeetingCommandError::StaleRevision,
        ProcessingFailure::EngineFailure => MeetingCommandError::InvalidRequest,
    }
}

fn utc_now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn retention_operation_id(session_id: MeetingSessionId) -> MeetingOperationId {
    MeetingOperationId::from_uuid(Uuid::new_v5(
        &RETENTION_OPERATION_NAMESPACE,
        session_id.uuid().as_bytes(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::{MemorySecretBackend, SecretManager};
    use tempfile::TempDir;

    struct FakeSource {
        kind: SourceKind,
        starts: Arc<std::sync::atomic::AtomicUsize>,
        aborts: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl MeetingCaptureSource for FakeSource {
        fn probe(&self) -> SourceProbe {
            SourceProbe {
                source_kind: self.kind,
                availability: SourceAvailability::Available,
                health: SourceHealth::Healthy,
                detail: None,
                negotiated_format: Some(AudioFormat {
                    sample_rate_hz: 48_000,
                    channels: 1,
                }),
            }
        }

        fn start(
            &mut self,
            plan: SourceStartPlan,
            _anchor: SessionClockAnchor,
            _sink: PacketSink,
        ) -> Result<SourceStartReport, MeetingCaptureError> {
            self.starts.fetch_add(1, Ordering::AcqRel);
            Ok(SourceStartReport {
                track_id: plan.track_id,
                source_kind: plan.source_kind,
                format: AudioFormat {
                    sample_rate_hz: 48_000,
                    channels: 1,
                },
                epoch: SourceEpoch::new(0),
                format_epoch: 0,
                timestamp_bridge: TimestampBridge {
                    native_anchor_value: 0,
                    native_timescale: 1_000_000_000,
                    host_monotonic_anchor_ns: 0,
                    session_offset_ns: 0,
                },
            })
        }

        fn pause(&mut self) -> Result<(), MeetingCaptureError> {
            Ok(())
        }

        fn resume(
            &mut self,
            _epoch: SourceEpoch,
        ) -> Result<SourceStartReport, MeetingCaptureError> {
            Err(MeetingCaptureError::InvalidState)
        }

        fn stop(&mut self) -> Result<SourceStopReport, MeetingCaptureError> {
            Ok(SourceStopReport {
                track_id: SourceTrackId::new(),
                final_offset_ns: Some(0),
                health: SourceHealth::Stopped,
                observed_gaps: Vec::new(),
            })
        }

        fn abort(&mut self) -> Result<(), MeetingCaptureError> {
            self.aborts.fetch_add(1, Ordering::AcqRel);
            Ok(())
        }
    }

    struct FakeSources {
        starts: Arc<std::sync::atomic::AtomicUsize>,
        aborts: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl MeetingSourceProvider for FakeSources {
        fn probe(&self, source_kind: SourceKind) -> SourceProbe {
            SourceProbe {
                source_kind,
                availability: SourceAvailability::Available,
                health: SourceHealth::Healthy,
                detail: None,
                negotiated_format: Some(AudioFormat {
                    sample_rate_hz: 48_000,
                    channels: 1,
                }),
            }
        }

        fn acquire(
            &self,
            source_kind: SourceKind,
        ) -> Result<Box<dyn MeetingCaptureSource>, MeetingCaptureError> {
            Ok(Box::new(FakeSource {
                kind: source_kind,
                starts: Arc::clone(&self.starts),
                aborts: Arc::clone(&self.aborts),
            }))
        }
    }

    fn manager() -> (
        TempDir,
        MeetingSessionManager,
        Arc<std::sync::atomic::AtomicUsize>,
        Arc<std::sync::atomic::AtomicUsize>,
    ) {
        let directory = TempDir::new().unwrap();
        let secrets = Arc::new(SecretManager::with_backend(Arc::new(
            MemorySecretBackend::new(),
        )));
        let starts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let aborts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let manager = MeetingSessionManager::with_parts(
            None,
            Some(directory.path().join("meetings")),
            secrets,
            Arc::new(FakeSources {
                starts: Arc::clone(&starts),
                aborts: Arc::clone(&aborts),
            }),
        );
        (directory, manager, starts, aborts)
    }
    fn review_ready_session(manager: &MeetingSessionManager) -> MeetingSessionSnapshot {
        tauri::async_runtime::block_on(async {
            let session_id = MeetingSessionId::new();
            let store = manager.store().await.unwrap();
            let request = MeetingPreflightCreateRequest {
                operation_id: MeetingOperationId::new(),
                expected_revision: 0,
                title: "Retention test".to_string(),
                origin: MeetingOrigin::Manual,
                suggestion_id: None,
                requested_sources: SourceKind::ALL.to_vec(),
                required_sources: SourceKind::ALL.to_vec(),
                accepted_known_missing_sources: Vec::new(),
                degraded_start_policy: DegradedStartPolicy::AbortIfRequiredSourceFails,
                destination: ProcessingDestination::Local,
                remote_acknowledgement: None,
                microphone_device_uid: None,
                frozen_system_audio_application_bundle_ids: Vec::new(),
            };
            let preflight = manager.build_preflight_snapshot(session_id, &request);
            store
                .create_preflight(
                    StoreMutation {
                        operation_id: request.operation_id,
                        requested_at_utc_ms: 0,
                        session_id,
                        expected_revision: request.expected_revision,
                        command: MeetingCommandKind::PreflightCreate,
                    },
                    request.title,
                    request.origin,
                    preflight,
                    MeetingRetentionPolicy::DeleteAfterDays { days: 1 },
                )
                .unwrap();
            store
                .transition(StoreTransition {
                    operation_id: None,
                    actor: OperationActor::System,
                    command: MeetingCommandKind::Start,
                    requested_at_utc_ms: 0,
                    session_id,
                    expected_revision: 0,
                    allowed_from: &[MeetingPhase::Preflight],
                    next_phase: MeetingPhase::Starting,
                    event_kind: "test_start",
                    reason_codes: Vec::new(),
                })
                .unwrap();
            store
                .transition(StoreTransition {
                    operation_id: None,
                    actor: OperationActor::System,
                    command: MeetingCommandKind::Stop,
                    requested_at_utc_ms: 0,
                    session_id,
                    expected_revision: 1,
                    allowed_from: &[MeetingPhase::Starting],
                    next_phase: MeetingPhase::ReviewReady,
                    event_kind: "test_review_ready",
                    reason_codes: Vec::new(),
                })
                .unwrap();
            store.session_snapshot(session_id).unwrap()
        })
    }

    #[test]
    fn meeting_trend_is_typed_unavailable_without_meeting_storage() {
        let secrets = Arc::new(SecretManager::with_backend(Arc::new(
            MemorySecretBackend::new(),
        )));
        let manager =
            MeetingSessionManager::with_parts(None, None, secrets, Arc::new(NoCaptureSources));
        let request = DashboardTrendRequest {
            range: crate::analytics::DashboardTrendRange::Days7,
        };

        let projection = tauri::async_runtime::block_on(manager.trend_projection(request));
        assert_eq!(
            projection,
            MeetingTrendProjection::Unavailable {
                range: crate::analytics::DashboardTrendRange::Days7
            }
        );
    }

    fn retention_deadline(snapshot: &MeetingSessionSnapshot) -> i64 {
        snapshot
            .retention_deadline_utc_ms
            .expect("review-ready test session has a deadline")
    }

    #[test]
    fn retention_sweep_deletes_due_review_ready_sessions() {
        let (_directory, manager, _starts, _aborts) = manager();
        let snapshot = review_ready_session(&manager);
        let result = tauri::async_runtime::block_on(
            manager.sweep_retention_at(retention_deadline(&snapshot)),
        )
        .unwrap();

        assert_eq!(
            result,
            RetentionSweepResult {
                due_sessions: 1,
                deleted_sessions: 1,
                failed_sessions: 0,
            }
        );
        assert!(matches!(
            tauri::async_runtime::block_on(manager.get(snapshot.session_id)),
            Err(MeetingCommandError::NotFound)
        ));
    }
    #[test]
    fn retention_sweep_does_not_take_another_session_capture() {
        let (_directory, manager, _starts, aborts) = manager();
        let due = review_ready_session(&manager);
        let preflight = tauri::async_runtime::block_on(manager.create_preflight(
            MeetingPreflightCreateRequest {
                operation_id: MeetingOperationId::new(),
                expected_revision: 0,
                title: "Active capture".to_string(),
                origin: MeetingOrigin::Manual,
                suggestion_id: None,
                requested_sources: SourceKind::ALL.to_vec(),
                required_sources: SourceKind::ALL.to_vec(),
                accepted_known_missing_sources: Vec::new(),
                degraded_start_policy: DegradedStartPolicy::AbortIfRequiredSourceFails,
                destination: ProcessingDestination::Local,
                remote_acknowledgement: None,
                microphone_device_uid: None,
                frozen_system_audio_application_bundle_ids: Vec::new(),
            },
        ))
        .unwrap();
        let active = tauri::async_runtime::block_on(manager.start(MeetingStartRequest {
            operation_id: MeetingOperationId::new(),
            session_id: preflight.snapshot.session_id,
            expected_revision: preflight.snapshot.revision,
            consent: MeetingConsentInput {
                policy_version: 1,
                microphone_acknowledged: true,
                system_audio_acknowledged: true,
                known_missing_sources_acknowledged: Vec::new(),
                degraded_start_policy: DegradedStartPolicy::AbortIfRequiredSourceFails,
                destination: ProcessingDestination::Local,
                remote_acknowledgement: None,
            },
        }))
        .unwrap();

        tauri::async_runtime::block_on(manager.sweep_retention_at(retention_deadline(&due)))
            .unwrap();
        assert_eq!(aborts.load(Ordering::Acquire), 0);
        assert_eq!(
            tauri::async_runtime::block_on(manager.stop(MeetingMutationRequest {
                operation_id: MeetingOperationId::new(),
                session_id: active.snapshot.session_id,
                expected_revision: active.snapshot.revision,
            }))
            .unwrap()
            .snapshot
            .phase,
            MeetingPhase::ReviewReady
        );
    }

    #[test]
    fn retention_sweep_leaves_not_due_review_ready_sessions() {
        let (_directory, manager, _starts, _aborts) = manager();
        let snapshot = review_ready_session(&manager);
        let result = tauri::async_runtime::block_on(
            manager.sweep_retention_at(retention_deadline(&snapshot).saturating_sub(1)),
        )
        .unwrap();

        assert_eq!(
            result,
            RetentionSweepResult {
                due_sessions: 0,
                deleted_sessions: 0,
                failed_sessions: 0,
            }
        );
        assert_eq!(
            tauri::async_runtime::block_on(manager.get(snapshot.session_id))
                .unwrap()
                .session
                .phase,
            MeetingPhase::ReviewReady
        );
    }

    #[test]
    fn retention_sweep_uses_an_idempotent_manager_deletion_operation() {
        let (_directory, manager, _starts, _aborts) = manager();
        let snapshot = review_ready_session(&manager);
        let operation_id = retention_operation_id(snapshot.session_id);
        tauri::async_runtime::block_on(manager.sweep_retention_at(retention_deadline(&snapshot)))
            .unwrap();
        let receipt = tauri::async_runtime::block_on(manager.store())
            .unwrap()
            .operation_receipt(operation_id)
            .unwrap()
            .expect("retention operation receipt");

        let duplicate = tauri::async_runtime::block_on(manager.delete_with_cause(
            MeetingMutationRequest {
                operation_id,
                session_id: snapshot.session_id,
                expected_revision: snapshot.revision,
            },
            DeletionCause::Retention,
        ))
        .unwrap();
        assert_eq!(duplicate.receipt, receipt);
        assert!(duplicate.removed);
        assert_eq!(
            tauri::async_runtime::block_on(
                manager.sweep_retention_at(retention_deadline(&snapshot)),
            )
            .unwrap(),
            RetentionSweepResult {
                due_sessions: 0,
                deleted_sessions: 0,
                failed_sessions: 0,
            }
        );
    }

    #[test]
    fn startup_retention_sweep_uses_the_injected_clock_after_restart() {
        let directory = TempDir::new().unwrap();
        let secrets = Arc::new(SecretManager::with_backend(Arc::new(
            MemorySecretBackend::new(),
        )));
        let root = directory.path().join("meetings");
        let starts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let aborts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let manager = MeetingSessionManager::with_parts(
            None,
            Some(root.clone()),
            Arc::clone(&secrets),
            Arc::new(FakeSources {
                starts: Arc::clone(&starts),
                aborts: Arc::clone(&aborts),
            }),
        );
        let snapshot = review_ready_session(&manager);
        drop(manager);

        let restarted = MeetingSessionManager::with_parts(
            None,
            Some(root),
            secrets,
            Arc::new(FakeSources { starts, aborts }),
        );
        assert!(tauri::async_runtime::block_on(
            restarted.recover_at_startup_at(retention_deadline(&snapshot)),
        )
        .unwrap()
        .is_empty());
        assert!(matches!(
            tauri::async_runtime::block_on(restarted.get(snapshot.session_id)),
            Err(MeetingCommandError::NotFound)
        ));
    }

    #[test]
    fn suggestion_has_no_capture_authority_until_start() {
        let (_directory, manager, starts, _aborts) = manager();
        manager
            .suggestion_service()
            .submit(MeetingSuggestionSignal {
                provider: super::super::suggestions::MeetingProvider::Zoom,
                app_bundle_id: "us.zoom.xos".to_string(),
                observed_at_ns: 1,
                evidence_flags: Default::default(),
            });
        assert_eq!(starts.load(Ordering::Acquire), 0);
        let preflight = tauri::async_runtime::block_on(manager.create_preflight(
            MeetingPreflightCreateRequest {
                operation_id: MeetingOperationId::new(),
                expected_revision: 0,
                title: "Design sync".to_string(),
                origin: MeetingOrigin::Manual,
                suggestion_id: None,
                requested_sources: SourceKind::ALL.to_vec(),
                required_sources: SourceKind::ALL.to_vec(),
                accepted_known_missing_sources: Vec::new(),
                degraded_start_policy: DegradedStartPolicy::AbortIfRequiredSourceFails,
                destination: ProcessingDestination::Local,
                remote_acknowledgement: None,
                microphone_device_uid: None,
                frozen_system_audio_application_bundle_ids: Vec::new(),
            },
        ))
        .unwrap();
        assert_eq!(starts.load(Ordering::Acquire), 0);
        let _ = tauri::async_runtime::block_on(manager.start(MeetingStartRequest {
            operation_id: MeetingOperationId::new(),
            session_id: preflight.snapshot.session_id,
            expected_revision: preflight.snapshot.revision,
            consent: MeetingConsentInput {
                policy_version: 1,
                microphone_acknowledged: true,
                system_audio_acknowledged: true,
                known_missing_sources_acknowledged: Vec::new(),
                degraded_start_policy: DegradedStartPolicy::AbortIfRequiredSourceFails,
                destination: ProcessingDestination::Local,
                remote_acknowledgement: None,
            },
        }))
        .unwrap();
        assert_eq!(starts.load(Ordering::Acquire), 2);
    }
    #[test]
    fn stale_discard_does_not_abort_an_active_capture() {
        let (_directory, manager, _starts, aborts) = manager();
        let preflight = tauri::async_runtime::block_on(manager.create_preflight(
            MeetingPreflightCreateRequest {
                operation_id: MeetingOperationId::new(),
                expected_revision: 0,
                title: "Design sync".to_string(),
                origin: MeetingOrigin::Manual,
                suggestion_id: None,
                requested_sources: SourceKind::ALL.to_vec(),
                required_sources: SourceKind::ALL.to_vec(),
                accepted_known_missing_sources: Vec::new(),
                degraded_start_policy: DegradedStartPolicy::AbortIfRequiredSourceFails,
                destination: ProcessingDestination::Local,
                remote_acknowledgement: None,
                microphone_device_uid: None,
                frozen_system_audio_application_bundle_ids: Vec::new(),
            },
        ))
        .unwrap();
        let started = tauri::async_runtime::block_on(manager.start(MeetingStartRequest {
            operation_id: MeetingOperationId::new(),
            session_id: preflight.snapshot.session_id,
            expected_revision: preflight.snapshot.revision,
            consent: MeetingConsentInput {
                policy_version: 1,
                microphone_acknowledged: true,
                system_audio_acknowledged: true,
                known_missing_sources_acknowledged: Vec::new(),
                degraded_start_policy: DegradedStartPolicy::AbortIfRequiredSourceFails,
                destination: ProcessingDestination::Local,
                remote_acknowledgement: None,
            },
        }))
        .unwrap();

        let stale = tauri::async_runtime::block_on(manager.discard(MeetingMutationRequest {
            operation_id: MeetingOperationId::new(),
            session_id: preflight.snapshot.session_id,
            expected_revision: preflight.snapshot.revision,
        }))
        .unwrap();
        assert!(!stale.removed);
        assert_eq!(aborts.load(Ordering::Acquire), 0);

        let removed = tauri::async_runtime::block_on(manager.discard(MeetingMutationRequest {
            operation_id: MeetingOperationId::new(),
            session_id: preflight.snapshot.session_id,
            expected_revision: started.snapshot.revision,
        }))
        .unwrap();
        assert!(removed.removed);
        assert_eq!(aborts.load(Ordering::Acquire), 2);
    }
}
