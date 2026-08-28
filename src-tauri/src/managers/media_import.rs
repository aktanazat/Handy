use crate::audio_toolkit::{audio::FrameResampler, constants::WHISPER_SAMPLE_RATE};
use crate::context::ContextReceipt;
use crate::managers::history::{HistoryManager, HistorySourceKind, NewRunReceipt};
use crate::managers::transcription::TranscriptionManager;
use crate::modes::{AsrPlan, ModeReceipt, RunPlan};
use anyhow::Result as AnyResult;
use parking_lot::{Condvar, Mutex};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{BTreeMap, VecDeque};
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::thread;
use std::time::Duration;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tauri::AppHandle;
use tauri_specta::Event;

pub const MAX_MEDIA_IMPORT_SAMPLES: usize = 28_800_000;
// Five seconds of fixed 16 kHz mono ASR output.
const IMPORT_PROGRESS_SAMPLES: usize = 80_000;
const SUPPORTED_MEDIA_EXTENSIONS: &[&str] = &[
    "wav", "mp3", "m4a", "aac", "flac", "ogg", "mov", "mp4", "m4v",
];

static NEXT_MEDIA_IMPORT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AudioImportStatus {
    Queued,
    Decoding,
    Transcribing,
    Done,
    Cancelled,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AudioImportFailureCode {
    InvalidFile,
    UnsupportedFormat,
    NoAudio,
    Decode,
    DurationLimit,
    Transcription,
    History,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AudioImportResult {
    Done {
        history_id: i64,
    },
    Cancelled,
    Failed {
        code: AudioImportFailureCode,
        message: String,
    },
}

/// The complete public state for one GUI import. Source paths remain private;
/// only the original file name crosses the IPC boundary.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Type)]
pub struct AudioImportJob {
    pub id: u64,
    pub file_name: String,
    pub status: AudioImportStatus,
    pub decoded_samples: u64,
    pub cancel_requested: bool,
    pub result: Option<AudioImportResult>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type, tauri_specta::Event)]
pub struct AudioImportUpdateEvent {
    pub job: AudioImportJob,
}

#[derive(Clone, Debug)]
pub struct AudioImportError {
    code: AudioImportFailureCode,
    message: &'static str,
}

impl AudioImportError {
    fn invalid_file() -> Self {
        Self {
            code: AudioImportFailureCode::InvalidFile,
            message: "Select a readable audio file.",
        }
    }

    fn unsupported_format() -> Self {
        Self {
            code: AudioImportFailureCode::UnsupportedFormat,
            message: "This media format is not supported.",
        }
    }

    fn no_audio() -> Self {
        Self {
            code: AudioImportFailureCode::NoAudio,
            message: "This media file has no audio track.",
        }
    }

    fn decode() -> Self {
        Self {
            code: AudioImportFailureCode::Decode,
            message: "The media file could not be decoded.",
        }
    }

    fn duration_limit() -> Self {
        Self {
            code: AudioImportFailureCode::DurationLimit,
            message: "Imported audio is limited to 30 minutes.",
        }
    }

    fn transcription() -> Self {
        Self {
            code: AudioImportFailureCode::Transcription,
            message: "The audio could not be transcribed.",
        }
    }

    fn history() -> Self {
        Self {
            code: AudioImportFailureCode::History,
            message: "The transcript could not be saved to history.",
        }
    }

    pub fn code(&self) -> AudioImportFailureCode {
        self.code
    }

    pub fn message(&self) -> &'static str {
        self.message
    }
}

impl std::fmt::Display for AudioImportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for AudioImportError {}

#[derive(Debug)]
struct ValidatedMediaPath {
    canonical_path: PathBuf,
    extension: String,
    file_name: String,
}

struct PendingJob {
    canonical_path: PathBuf,
    extension: String,
    run: RunPlan,
    cancellation: Arc<AtomicBool>,
    public: AudioImportJob,
}

struct WorkItem {
    id: u64,
    canonical_path: PathBuf,
    extension: String,
    run: RunPlan,
    cancellation: Arc<AtomicBool>,
}

#[derive(Default)]
struct ImportState {
    jobs: BTreeMap<u64, PendingJob>,
    queue: VecDeque<u64>,
    active: Option<u64>,
}

struct ImportHistoryRecord {
    file_name: String,
    transcription: String,
    run: ModeReceipt,
    context: ContextReceipt,
    started_at_ms: u64,
    duration_ms: Option<u64>,
    word_count: Option<u64>,
}

/// Keeps model unloading suspended for the duration of one import job. The
/// marker has no behavior beyond Drop; it is deliberately opaque to the queue.
trait ImportActivity: Send {}
impl<T: Send> ImportActivity for T {}

trait ImportRuntime: Send + Sync {
    fn begin_job(&self) -> Box<dyn ImportActivity>;
    fn transcribe(&self, plan: &AsrPlan, audio: &[f32]) -> AnyResult<String>;
    fn save(&self, record: ImportHistoryRecord) -> AnyResult<i64>;
}

struct AppImportRuntime {
    transcription: Arc<TranscriptionManager>,
    history: Arc<HistoryManager>,
}

impl ImportRuntime for AppImportRuntime {
    fn begin_job(&self) -> Box<dyn ImportActivity> {
        Box::new(self.transcription.begin_media_import())
    }

    fn transcribe(&self, plan: &AsrPlan, audio: &[f32]) -> AnyResult<String> {
        self.transcription.transcribe_shared(plan, audio)
    }

    fn save(&self, record: ImportHistoryRecord) -> AnyResult<i64> {
        let entry = self.history.save_entry_with_receipt(
            record.file_name,
            record.transcription,
            false,
            None,
            Some(NewRunReceipt {
                run: record.run,
                context: record.context,
                started_at_ms: record.started_at_ms,
                completed_at_ms: current_time_ms(),
                duration_ms: record.duration_ms,
                word_count: record.word_count,
                source_kind: HistorySourceKind::File,
                has_audio: false,
                capture_status: None,
            }),
        )?;
        Ok(entry.id)
    }
}

struct MediaImportInner {
    app_handle: Option<AppHandle>,
    runtime: Arc<dyn ImportRuntime>,
    state: Mutex<ImportState>,
    wake: Condvar,
    shutdown: AtomicBool,
}

/// A single-worker FIFO for bounded, local media transcription.
///
/// The manager intentionally never owns source media bytes after a job ends and
/// never calls the post-processing, context, or delivery pipeline.
pub struct MediaImportManager {
    inner: Arc<MediaImportInner>,
}

impl MediaImportManager {
    pub fn new(
        app_handle: &AppHandle,
        transcription: Arc<TranscriptionManager>,
        history: Arc<HistoryManager>,
    ) -> Self {
        Self::with_runtime(
            Some(app_handle.clone()),
            Arc::new(AppImportRuntime {
                transcription,
                history,
            }),
        )
    }

    fn with_runtime(app_handle: Option<AppHandle>, runtime: Arc<dyn ImportRuntime>) -> Self {
        let inner = Arc::new(MediaImportInner {
            app_handle,
            runtime,
            state: Mutex::new(ImportState::default()),
            wake: Condvar::new(),
            shutdown: AtomicBool::new(false),
        });
        let worker_inner = Arc::downgrade(&inner);
        thread::spawn(move || worker_loop(worker_inner));
        Self { inner }
    }

    /// Enqueue an already-frozen active-mode plan after validating the supplied
    /// path. The canonical path is retained only by the worker and is never
    /// serialized or emitted.
    pub fn enqueue(
        &self,
        path: String,
        run: RunPlan,
    ) -> std::result::Result<AudioImportJob, AudioImportError> {
        let path = validate_media_path(Path::new(&path))?;
        let id = NEXT_MEDIA_IMPORT_ID.fetch_add(1, Ordering::Relaxed);
        let public = AudioImportJob {
            id,
            file_name: path.file_name,
            status: AudioImportStatus::Queued,
            decoded_samples: 0,
            cancel_requested: false,
            result: None,
        };
        {
            let mut state = lock_state(&self.inner);
            state.jobs.insert(
                id,
                PendingJob {
                    canonical_path: path.canonical_path,
                    extension: path.extension,
                    run,
                    cancellation: Arc::new(AtomicBool::new(false)),
                    public: public.clone(),
                },
            );
            state.queue.push_back(id);
        }
        emit_update(&self.inner, public.clone());
        self.inner.wake.notify_one();
        Ok(public)
    }

    pub fn cancel(&self, id: u64) -> std::result::Result<AudioImportJob, AudioImportError> {
        let update = {
            let mut state = lock_state(&self.inner);
            let was_queued = state.queue.contains(&id);
            if was_queued {
                state.queue.retain(|queued_id| *queued_id != id);
            }
            let job = state
                .jobs
                .get_mut(&id)
                .ok_or_else(AudioImportError::invalid_file)?;
            if matches!(
                job.public.status,
                AudioImportStatus::Done | AudioImportStatus::Cancelled | AudioImportStatus::Failed
            ) {
                return Ok(job.public.clone());
            }
            job.cancellation.store(true, Ordering::Release);
            job.public.cancel_requested = true;
            if was_queued {
                job.public.status = AudioImportStatus::Cancelled;
                job.public.result = Some(AudioImportResult::Cancelled);
            }
            job.public.clone()
        };
        emit_update(&self.inner, update.clone());
        self.inner.wake.notify_one();
        Ok(update)
    }

    pub fn list_jobs(&self) -> Vec<AudioImportJob> {
        let state = lock_state(&self.inner);
        state.jobs.values().map(|job| job.public.clone()).collect()
    }

    #[cfg(test)]
    fn new_for_test(runtime: Arc<dyn ImportRuntime>) -> Self {
        Self::with_runtime(None, runtime)
    }
}

impl Drop for MediaImportManager {
    fn drop(&mut self) {
        self.inner.shutdown.store(true, Ordering::Release);
        self.inner.wake.notify_all();
    }
}

fn worker_loop(inner: Weak<MediaImportInner>) {
    loop {
        let Some(inner) = inner.upgrade() else {
            return;
        };
        let Some(work) = next_work(&inner) else {
            return;
        };
        process_work(&inner, work);
    }
}
fn next_work(inner: &Arc<MediaImportInner>) -> Option<WorkItem> {
    let mut state = lock_state(inner);
    loop {
        if inner.shutdown.load(Ordering::Acquire) {
            return None;
        }
        if let Some(id) = state.queue.pop_front() {
            let work = state.jobs.get(&id).map(|job| WorkItem {
                id,
                canonical_path: job.canonical_path.clone(),
                extension: job.extension.clone(),
                run: job.run.clone(),
                cancellation: Arc::clone(&job.cancellation),
            })?;
            state.active = Some(id);
            return Some(work);
        }
        inner.wake.wait(&mut state);
    }
}

fn process_work(inner: &Arc<MediaImportInner>, work: WorkItem) {
    let _activity = inner.runtime.begin_job();
    if work.cancellation.load(Ordering::Acquire) {
        finish_cancelled(inner, work.id);
        return;
    }

    set_status(inner, work.id, AudioImportStatus::Decoding);
    let decoded = decode_media(
        &work.canonical_path,
        &work.extension,
        &work.cancellation,
        |emitted_samples| update_decode_progress(inner, work.id, emitted_samples),
    );

    let audio = match decoded {
        Ok(audio) => audio,
        Err(DecodeFailure::Cancelled) => {
            finish_cancelled(inner, work.id);
            return;
        }
        Err(DecodeFailure::Failed(error)) => {
            finish_failed(inner, work.id, error);
            return;
        }
    };

    update_decode_progress(inner, work.id, audio.len());
    // Do not transition to native inference after a cancellation request. The
    // native engines are intentionally not interrupted mid-call because their
    // ownership is serialized by TranscriptionManager.
    if work.cancellation.load(Ordering::Acquire) {
        finish_cancelled(inner, work.id);
        return;
    }

    set_status(inner, work.id, AudioImportStatus::Transcribing);
    let transcription = inner.runtime.transcribe(work.run.asr(), &audio);
    if work.cancellation.load(Ordering::Acquire) {
        finish_cancelled(inner, work.id);
        return;
    }
    let transcription = match transcription {
        Ok(text) => text,
        Err(error) => {
            log::warn!("Media import transcription failed: {error}");
            finish_failed(inner, work.id, AudioImportError::transcription());
            return;
        }
    };

    let Some(file_name) = current_file_name(inner, work.id) else {
        finish_failed(inner, work.id, AudioImportError::history());
        return;
    };
    let record = ImportHistoryRecord {
        file_name,
        word_count: u64::try_from(transcription.split_whitespace().count()).ok(),
        duration_ms: duration_ms(audio.len()),
        transcription,
        run: work.run.mode_receipt(),
        context: work.run.context().receipt().clone(),
        started_at_ms: work.run.run_started_at_ms,
    };
    let history_id = match inner.runtime.save(record) {
        Ok(history_id) => history_id,
        Err(error) => {
            log::warn!("Media import history save failed: {error}");
            finish_failed(inner, work.id, AudioImportError::history());
            return;
        }
    };
    finish_done(inner, work.id, history_id);
}

fn set_status(inner: &Arc<MediaImportInner>, id: u64, status: AudioImportStatus) {
    let update = {
        let mut state = lock_state(inner);
        let Some(job) = state.jobs.get_mut(&id) else {
            return;
        };
        job.public.status = status;
        job.public.clone()
    };
    emit_update(inner, update);
}

fn update_decode_progress(inner: &Arc<MediaImportInner>, id: u64, emitted_samples: usize) {
    let update = {
        let mut state = lock_state(inner);
        let Some(job) = state.jobs.get_mut(&id) else {
            return;
        };
        job.public.decoded_samples = u64::try_from(emitted_samples).unwrap_or(u64::MAX);
        job.public.clone()
    };
    emit_update(inner, update);
}

fn finish_done(inner: &Arc<MediaImportInner>, id: u64, history_id: i64) {
    finish(
        inner,
        id,
        AudioImportStatus::Done,
        AudioImportResult::Done { history_id },
    );
}

fn finish_cancelled(inner: &Arc<MediaImportInner>, id: u64) {
    finish(
        inner,
        id,
        AudioImportStatus::Cancelled,
        AudioImportResult::Cancelled,
    );
}

fn finish_failed(inner: &Arc<MediaImportInner>, id: u64, error: AudioImportError) {
    finish(
        inner,
        id,
        AudioImportStatus::Failed,
        AudioImportResult::Failed {
            code: error.code(),
            message: error.message().to_string(),
        },
    );
}

fn finish(
    inner: &Arc<MediaImportInner>,
    id: u64,
    status: AudioImportStatus,
    result: AudioImportResult,
) {
    let update = {
        let mut state = lock_state(inner);
        let update = {
            let Some(job) = state.jobs.get_mut(&id) else {
                return;
            };
            job.public.status = status;
            job.public.result = Some(result);
            job.public.clone()
        };
        if state.active == Some(id) {
            state.active = None;
        }
        update
    };
    emit_update(inner, update);
}
fn current_file_name(inner: &Arc<MediaImportInner>, id: u64) -> Option<String> {
    let state = lock_state(inner);
    state.jobs.get(&id).map(|job| job.public.file_name.clone())
}

fn emit_update(inner: &MediaImportInner, job: AudioImportJob) {
    if let Some(app_handle) = &inner.app_handle {
        let _ = AudioImportUpdateEvent { job }.emit(app_handle);
    }
}

fn lock_state(inner: &MediaImportInner) -> parking_lot::MutexGuard<'_, ImportState> {
    inner.state.lock()
}

pub(crate) fn validate_audio_import_path(path: &Path) -> std::result::Result<(), AudioImportError> {
    validate_media_path(path).map(|_| ())
}

fn validate_media_path(path: &Path) -> std::result::Result<ValidatedMediaPath, AudioImportError> {
    let canonical_path = fs::canonicalize(path).map_err(|_| AudioImportError::invalid_file())?;
    let metadata = fs::metadata(&canonical_path).map_err(|_| AudioImportError::invalid_file())?;
    if !metadata.file_type().is_file() {
        return Err(AudioImportError::invalid_file());
    }
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(AudioImportError::invalid_file)?;
    let extension = canonical_path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|value| is_supported_extension(value))
        .ok_or_else(AudioImportError::unsupported_format)?;
    Ok(ValidatedMediaPath {
        canonical_path,
        extension,
        file_name,
    })
}

fn is_supported_extension(extension: &str) -> bool {
    SUPPORTED_MEDIA_EXTENSIONS.contains(&extension)
}

#[derive(Debug)]
enum DecodeFailure {
    Cancelled,
    Failed(AudioImportError),
}

fn decode_media(
    path: &Path,
    extension: &str,
    cancellation: &AtomicBool,
    mut progress: impl FnMut(usize),
) -> std::result::Result<Vec<f32>, DecodeFailure> {
    let file =
        File::open(path).map_err(|_| DecodeFailure::Failed(AudioImportError::invalid_file()))?;
    let media_stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(extension);
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            media_stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|_| DecodeFailure::Failed(AudioImportError::decode()))?;
    let mut format = probed.format;
    let mut has_audio_track = false;
    let mut selected = None;
    for track in format.tracks() {
        let params = &track.codec_params;
        // Video and metadata tracks do not declare a sample rate or channel
        // layout. Try only tracks that identify themselves as audio, then let
        // the enabled Symphonia codecs decide whether the audio codec is one
        // Sona can decode.
        if params.sample_rate.is_none() && params.channels.is_none() {
            continue;
        }
        has_audio_track = true;
        if let Ok(decoder) =
            symphonia::default::get_codecs().make(params, &DecoderOptions::default())
        {
            selected = Some((track.id, params.clone(), decoder));
            break;
        }
    }
    let (track_id, codec_params, mut decoder) = selected.ok_or_else(|| {
        DecodeFailure::Failed(if has_audio_track {
            AudioImportError::unsupported_format()
        } else {
            AudioImportError::no_audio()
        })
    })?;
    // WAV exposes an exact PCM frame count in its container header. Use it only
    // to reject truncation; duration admission remains based on emitted PCM.
    let expected_wav_frames = (extension == "wav")
        .then_some(codec_params.n_frames)
        .flatten();

    let mut resampler: Option<FrameResampler> = None;
    let mut source_rate = 0_u32;
    let mut channels = 0_usize;
    let mut sample_buffer: Option<SampleBuffer<f32>> = None;
    let mut sample_capacity = 0_usize;
    let mut downmixed = Vec::new();
    let mut output = Vec::new();
    let mut decoded_source_frames = 0_u64;
    let mut next_progress = IMPORT_PROGRESS_SAMPLES;

    loop {
        if cancellation.load(Ordering::Acquire) {
            return Err(DecodeFailure::Cancelled);
        }
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => return Err(DecodeFailure::Failed(AudioImportError::decode())),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(_) => return Err(DecodeFailure::Failed(AudioImportError::decode())),
        };
        if cancellation.load(Ordering::Acquire) {
            return Err(DecodeFailure::Cancelled);
        }
        let packet_frames = u64::try_from(decoded.frames())
            .map_err(|_| DecodeFailure::Failed(AudioImportError::decode()))?;
        decoded_source_frames = decoded_source_frames
            .checked_add(packet_frames)
            .ok_or_else(|| DecodeFailure::Failed(AudioImportError::decode()))?;

        let spec = *decoded.spec();
        let packet_channels = spec.channels.count();
        if spec.rate == 0 || packet_channels == 0 {
            return Err(DecodeFailure::Failed(AudioImportError::decode()));
        }
        let channel_count = u16::try_from(packet_channels)
            .map_err(|_| DecodeFailure::Failed(AudioImportError::decode()))?;
        let downmix_scale = 1.0 / f32::from(channel_count);
        if source_rate == 0 {
            source_rate = spec.rate;
            channels = packet_channels;
            let input_sample_rate = usize::try_from(source_rate)
                .map_err(|_| DecodeFailure::Failed(AudioImportError::decode()))?;
            let output_sample_rate = usize::try_from(WHISPER_SAMPLE_RATE)
                .map_err(|_| DecodeFailure::Failed(AudioImportError::decode()))?;
            resampler = Some(FrameResampler::new(
                input_sample_rate,
                output_sample_rate,
                Duration::from_millis(30),
            ));
        } else if source_rate != spec.rate || channels != packet_channels {
            return Err(DecodeFailure::Failed(AudioImportError::decode()));
        }

        let buffer_frames = decoded.capacity();
        let packet_capacity = buffer_frames
            .checked_mul(packet_channels)
            .ok_or_else(|| DecodeFailure::Failed(AudioImportError::decode()))?;
        if sample_buffer.is_none() || sample_capacity < packet_capacity {
            let duration = u64::try_from(buffer_frames)
                .map_err(|_| DecodeFailure::Failed(AudioImportError::decode()))?;
            sample_buffer = Some(SampleBuffer::<f32>::new(duration, spec));
            sample_capacity = packet_capacity;
        }
        let Some(buffer) = sample_buffer.as_mut() else {
            return Err(DecodeFailure::Failed(AudioImportError::decode()));
        };
        buffer.copy_interleaved_ref(decoded);
        let samples = buffer.samples();
        if samples.len() % packet_channels != 0 {
            return Err(DecodeFailure::Failed(AudioImportError::decode()));
        }

        downmixed.clear();
        downmixed
            .try_reserve_exact(samples.len() / packet_channels)
            .map_err(|_| DecodeFailure::Failed(AudioImportError::decode()))?;
        for frame in samples.chunks_exact(packet_channels) {
            downmixed.push(frame.iter().copied().sum::<f32>() * downmix_scale);
        }

        let mut cap_exceeded = false;
        let Some(resampler) = resampler.as_mut() else {
            return Err(DecodeFailure::Failed(AudioImportError::decode()));
        };
        resampler.push(&downmixed, |frame| {
            if append_emitted(&mut output, frame).is_err() {
                cap_exceeded = true;
                return;
            }
            if output.len() >= next_progress {
                progress(output.len());
                next_progress = next_progress.saturating_add(IMPORT_PROGRESS_SAMPLES);
            }
        });
        if cap_exceeded {
            return Err(DecodeFailure::Failed(AudioImportError::duration_limit()));
        }
    }

    if cancellation.load(Ordering::Acquire) {
        return Err(DecodeFailure::Cancelled);
    }
    if expected_wav_frames.is_some_and(|expected| expected != decoded_source_frames) {
        return Err(DecodeFailure::Failed(AudioImportError::decode()));
    }
    let Some(resampler) = resampler.as_mut() else {
        return Err(DecodeFailure::Failed(AudioImportError::decode()));
    };
    let mut cap_exceeded = false;
    resampler.finish(|frame| {
        if append_emitted(&mut output, frame).is_err() {
            cap_exceeded = true;
            return;
        }
        if output.len() >= next_progress {
            progress(output.len());
            next_progress = next_progress.saturating_add(IMPORT_PROGRESS_SAMPLES);
        }
    });
    if cap_exceeded {
        return Err(DecodeFailure::Failed(AudioImportError::duration_limit()));
    }
    if output.is_empty() {
        return Err(DecodeFailure::Failed(AudioImportError::decode()));
    }
    Ok(output)
}

fn exceeds_sample_cap(emitted_samples: usize, incoming_samples: usize) -> bool {
    emitted_samples
        .checked_add(incoming_samples)
        .is_none_or(|length| length > MAX_MEDIA_IMPORT_SAMPLES)
}

fn append_emitted(
    output: &mut Vec<f32>,
    frame: &[f32],
) -> std::result::Result<(), AudioImportError> {
    if exceeds_sample_cap(output.len(), frame.len()) {
        return Err(AudioImportError::duration_limit());
    }
    output
        .try_reserve_exact(frame.len())
        .map_err(|_| AudioImportError::decode())?;
    output.extend_from_slice(frame);
    Ok(())
}

fn duration_ms(samples: usize) -> Option<u64> {
    u64::try_from(samples)
        .ok()?
        .checked_mul(1_000)
        .map(|value| value / u64::from(WHISPER_SAMPLE_RATE))
}

fn current_time_ms() -> u64 {
    u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modes::RunPlan;
    use crate::settings::get_default_settings;
    use hound::{SampleFormat, WavSpec, WavWriter};
    use std::collections::BTreeSet;
    use std::process::Command;

    #[derive(Deserialize)]
    struct TauriConfig {
        bundle: BundleConfig,
    }

    #[derive(Deserialize)]
    struct BundleConfig {
        #[serde(rename = "fileAssociations")]
        file_associations: Vec<FileAssociation>,
    }

    #[derive(Deserialize)]
    struct FileAssociation {
        ext: Vec<String>,
    }

    struct QueueGate {
        state: Mutex<(bool, bool)>,
        wake: Condvar,
    }

    impl QueueGate {
        fn new() -> Self {
            Self {
                state: Mutex::new((false, false)),
                wake: Condvar::new(),
            }
        }

        fn wait_until_entered(&self) {
            let mut state = self.state.lock();
            while !state.0 {
                if self
                    .wake
                    .wait_for(&mut state, Duration::from_secs(2))
                    .timed_out()
                {
                    panic!("fake transcriber did not start");
                }
            }
        }

        fn release(&self) {
            let mut state = self.state.lock();
            state.1 = true;
            self.wake.notify_all();
        }

        fn wait_for_release(&self) {
            let mut state = self.state.lock();
            state.0 = true;
            self.wake.notify_all();
            while !state.1 {
                self.wake.wait(&mut state);
            }
        }
    }

    #[derive(Default)]
    struct FakeRuntime {
        transcripts: Mutex<Vec<Vec<f32>>>,
        saved_names: Mutex<Vec<String>>,
        gate: Option<Arc<QueueGate>>,
    }

    impl FakeRuntime {
        fn blocking() -> (Self, Arc<QueueGate>) {
            let gate = Arc::new(QueueGate::new());
            (
                Self {
                    transcripts: Mutex::new(Vec::new()),
                    saved_names: Mutex::new(Vec::new()),
                    gate: Some(Arc::clone(&gate)),
                },
                gate,
            )
        }
    }

    impl ImportRuntime for FakeRuntime {
        fn begin_job(&self) -> Box<dyn ImportActivity> {
            Box::new(())
        }

        fn transcribe(&self, _plan: &AsrPlan, audio: &[f32]) -> AnyResult<String> {
            if let Some(gate) = &self.gate {
                gate.wait_for_release();
            }
            self.transcripts.lock().push(audio.to_vec());
            Ok(format!("{} samples", audio.len()))
        }

        fn save(&self, record: ImportHistoryRecord) -> AnyResult<i64> {
            let mut saved_names = self.saved_names.lock();
            saved_names.push(record.file_name);
            Ok(i64::try_from(saved_names.len()).unwrap_or(i64::MAX))
        }
    }

    fn import_plan() -> RunPlan {
        RunPlan::for_media_import(&get_default_settings()).expect("configured media-import plan")
    }

    fn write_stereo_wav(path: &Path, seconds: usize, left: f32, right: f32) {
        let spec = WavSpec {
            channels: 2,
            sample_rate: 48_000,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        };
        let mut writer = WavWriter::create(path, spec).expect("create wav fixture");
        for _ in 0..(seconds * 48_000) {
            writer.write_sample(left).expect("write left sample");
            writer.write_sample(right).expect("write right sample");
        }
        writer.finalize().expect("finalize wav fixture");
    }

    fn ffmpeg_fixture(source: &Path, output: &Path, codec: &[&str]) {
        let status = Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(source)
            .args(codec)
            .arg(output)
            .status()
            .expect("ffmpeg is required to generate local codec fixtures");
        assert!(status.success(), "ffmpeg failed to generate fixture");
    }

    fn ffmpeg_video_fixture(source: &Path, output: &Path) {
        let status = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=16x16:r=1",
                "-i",
            ])
            .arg(source)
            .args([
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-shortest",
                "-c:v",
                "mpeg4",
                "-c:a",
                "aac",
            ])
            .arg(output)
            .status()
            .expect("ffmpeg is required to generate local video fixtures");
        assert!(status.success(), "ffmpeg failed to generate video fixture");
    }

    fn ffmpeg_silent_video_fixture(output: &Path) {
        let status = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=16x16:r=1",
                "-t",
                "1",
                "-c:v",
                "mpeg4",
                "-an",
            ])
            .arg(output)
            .status()
            .expect("ffmpeg is required to generate local video fixtures");
        assert!(
            status.success(),
            "ffmpeg failed to generate silent video fixture"
        );
    }

    fn wait_for_terminal(manager: &MediaImportManager, id: u64) -> AudioImportJob {
        for _ in 0..200 {
            let job = manager
                .list_jobs()
                .into_iter()
                .find(|job| job.id == id)
                .expect("job exists");
            if matches!(
                job.status,
                AudioImportStatus::Done | AudioImportStatus::Cancelled | AudioImportStatus::Failed
            ) {
                return job;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("import job did not terminate");
    }

    #[test]
    fn viewer_associations_keep_sona_out_of_audio_imports() {
        let config: TauriConfig = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .expect("read Tauri bundle configuration");
        let associated = config
            .bundle
            .file_associations
            .into_iter()
            .flat_map(|association| association.ext)
            .collect::<BTreeSet<_>>();
        let supported = SUPPORTED_MEDIA_EXTENSIONS
            .iter()
            .map(|extension| (*extension).to_string())
            .collect::<BTreeSet<_>>();
        let non_audio = associated
            .difference(&supported)
            .cloned()
            .collect::<Vec<_>>();

        assert!(supported.is_subset(&associated));
        assert_eq!(non_audio, ["sona".to_string()]);
    }

    #[test]
    fn downmixes_and_resamples_deterministically() {
        let directory = tempfile::tempdir().expect("temporary fixture directory");
        let path = directory.path().join("stereo.wav");
        write_stereo_wav(&path, 3, 0.75, -0.25);
        let cancellation = AtomicBool::new(false);
        let decoded = decode_media(&path, "wav", &cancellation, |_| {}).expect("decode wav");
        assert!(
            (47_000..=49_500).contains(&decoded.len()),
            "expected about 3 seconds at 16 kHz, got {} samples",
            decoded.len()
        );
        let average = decoded.iter().skip(1_000).take(1_000).copied().sum::<f32>() / 1_000.0;
        assert!(
            (average - 0.25).abs() < 0.02,
            "deterministic average {average}"
        );
    }

    #[test]
    fn codecs_are_generated_and_decoded_locally() {
        let directory = tempfile::tempdir().expect("temporary fixture directory");
        let source = directory.path().join("source.wav");
        write_stereo_wav(&source, 2, 0.3, 0.3);
        let cases: [(&str, &[&str]); 5] = [
            ("fixture.mp3", &["-c:a", "libmp3lame"]),
            ("fixture.m4a", &["-c:a", "aac"]),
            ("fixture.aac", &["-c:a", "aac", "-f", "adts"]),
            ("fixture.flac", &["-c:a", "flac"]),
            ("fixture.ogg", &["-strict", "-2", "-c:a", "vorbis"]),
        ];
        for (name, codec) in cases {
            let output = directory.path().join(name);
            ffmpeg_fixture(&source, &output, codec);
            let cancellation = AtomicBool::new(false);
            let extension = output.extension().unwrap().to_str().unwrap();
            let decoded = decode_media(&output, extension, &cancellation, |_| {})
                .unwrap_or_else(|_| panic!("failed to decode {name}"));
            assert!(
                (30_000..=38_400).contains(&decoded.len()),
                "{name} did not resample near 16 kHz: {} samples",
                decoded.len()
            );
        }
    }

    #[test]
    fn video_containers_transcribe_their_audio_track_with_original_name() {
        let directory = tempfile::tempdir().expect("temporary fixture directory");
        let source = directory.path().join("source.wav");
        write_stereo_wav(&source, 2, 0.3, 0.3);
        let runtime = Arc::new(FakeRuntime::default());
        let manager = MediaImportManager::new_for_test(runtime.clone());

        for extension in ["mov", "mp4", "m4v"] {
            let name = format!("meeting.{extension}");
            let video = directory.path().join(&name);
            ffmpeg_video_fixture(&source, &video);
            let job = manager
                .enqueue(video.to_string_lossy().into_owned(), import_plan())
                .expect("enqueue supported video");

            assert_eq!(
                wait_for_terminal(&manager, job.id).status,
                AudioImportStatus::Done,
                "{name} should transcribe its audio track"
            );
        }

        let saved_names = runtime.saved_names.lock();
        assert_eq!(
            saved_names.as_slice(),
            [
                "meeting.mov".to_string(),
                "meeting.mp4".to_string(),
                "meeting.m4v".to_string(),
            ]
        );
        let transcripts = runtime.transcripts.lock();
        assert_eq!(transcripts.len(), 3);
        assert!(
            transcripts
                .iter()
                .all(|audio| (30_000..=38_400).contains(&audio.len())),
            "each video should yield approximately two seconds of 16 kHz audio"
        );
    }

    #[test]
    fn video_without_audio_returns_a_typed_no_audio_failure() {
        let directory = tempfile::tempdir().expect("temporary fixture directory");
        let video = directory.path().join("silent.mov");
        ffmpeg_silent_video_fixture(&video);
        let runtime = Arc::new(FakeRuntime::default());
        let manager = MediaImportManager::new_for_test(runtime.clone());
        let job = manager
            .enqueue(video.to_string_lossy().into_owned(), import_plan())
            .expect("enqueue supported video container");

        let completed = wait_for_terminal(&manager, job.id);
        assert_eq!(
            completed.result,
            Some(AudioImportResult::Failed {
                code: AudioImportFailureCode::NoAudio,
                message: "This media file has no audio track.".to_string(),
            })
        );
        assert!(runtime.saved_names.lock().is_empty());
    }

    #[test]
    fn corrupt_truncated_and_unsupported_files_fail_safely() {
        let directory = tempfile::tempdir().expect("temporary fixture directory");
        let corrupt = directory.path().join("corrupt.mp3");
        fs::write(&corrupt, b"not audio").expect("write corrupt fixture");
        let cancellation = AtomicBool::new(false);
        assert!(matches!(
            decode_media(&corrupt, "mp3", &cancellation, |_| {}),
            Err(DecodeFailure::Failed(_))
        ));

        let complete = directory.path().join("complete.wav");
        let truncated = directory.path().join("truncated.wav");
        write_stereo_wav(&complete, 1, 0.2, 0.2);
        let bytes = fs::read(&complete).expect("read complete fixture");
        fs::write(&truncated, &bytes[..bytes.len() / 2]).expect("write truncated fixture");
        assert!(matches!(
            decode_media(&truncated, "wav", &AtomicBool::new(false), |_| {}),
            Err(DecodeFailure::Failed(_))
        ));

        let unsupported = directory.path().join("unsupported.avi");
        fs::write(&unsupported, b"not a supported container").expect("write unsupported fixture");
        assert_eq!(
            validate_media_path(&unsupported).unwrap_err().code(),
            AudioImportFailureCode::UnsupportedFormat
        );
    }

    #[test]
    fn cap_is_checked_from_emitted_samples_without_metadata() {
        assert!(!exceeds_sample_cap(MAX_MEDIA_IMPORT_SAMPLES, 0));
        assert!(exceeds_sample_cap(MAX_MEDIA_IMPORT_SAMPLES, 1));
        assert!(exceeds_sample_cap(usize::MAX, 1));
        assert_eq!(duration_ms(MAX_MEDIA_IMPORT_SAMPLES), Some(1_800_000));
    }

    #[test]
    fn cancellation_stops_between_packets() {
        let directory = tempfile::tempdir().expect("temporary fixture directory");
        let path = directory.path().join("long.wav");
        write_stereo_wav(&path, 6, 0.1, 0.1);
        let cancellation = AtomicBool::new(false);
        let result = decode_media(&path, "wav", &cancellation, |_| {
            cancellation.store(true, Ordering::Release);
        });
        assert!(matches!(result, Err(DecodeFailure::Cancelled)));
    }

    #[test]
    fn manager_preserves_fifo_order_and_discards_cancelled_work() {
        let directory = tempfile::tempdir().expect("temporary fixture directory");
        let first = directory.path().join("first.wav");
        let second = directory.path().join("second.wav");
        let third = directory.path().join("third.wav");
        write_stereo_wav(&first, 1, 0.2, 0.2);
        write_stereo_wav(&second, 1, 0.2, 0.2);
        write_stereo_wav(&third, 1, 0.2, 0.2);
        let (fake_runtime, gate) = FakeRuntime::blocking();
        let runtime = Arc::new(fake_runtime);
        let manager = MediaImportManager::new_for_test(runtime.clone());

        let first_job = manager
            .enqueue(first.to_string_lossy().into_owned(), import_plan())
            .expect("enqueue first");
        gate.wait_until_entered();
        let second_job = manager
            .enqueue(second.to_string_lossy().into_owned(), import_plan())
            .expect("enqueue second");
        let third_job = manager
            .enqueue(third.to_string_lossy().into_owned(), import_plan())
            .expect("enqueue third");
        assert_eq!(
            manager
                .cancel(third_job.id)
                .expect("cancel queued job")
                .status,
            AudioImportStatus::Cancelled
        );

        gate.release();
        assert_eq!(
            wait_for_terminal(&manager, first_job.id).status,
            AudioImportStatus::Done
        );
        assert_eq!(
            wait_for_terminal(&manager, second_job.id).status,
            AudioImportStatus::Done
        );
        assert_eq!(
            wait_for_terminal(&manager, third_job.id).result,
            Some(AudioImportResult::Cancelled)
        );
        let saved_names = runtime.saved_names.lock();
        assert_eq!(
            saved_names.as_slice(),
            ["first.wav".to_string(), "second.wav".to_string()]
        );
    }

    #[test]
    fn duplicate_channels_produce_the_same_fake_transcript() {
        let directory = tempfile::tempdir().expect("temporary fixture directory");
        let first = directory.path().join("first.wav");
        let second = directory.path().join("second.wav");
        write_stereo_wav(&first, 1, 0.35, 0.35);
        write_stereo_wav(&second, 1, 0.35, 0.35);
        let runtime = Arc::new(FakeRuntime::default());
        let manager = MediaImportManager::new_for_test(runtime.clone());
        let first_job = manager
            .enqueue(first.to_string_lossy().into_owned(), import_plan())
            .expect("enqueue first");
        let second_job = manager
            .enqueue(second.to_string_lossy().into_owned(), import_plan())
            .expect("enqueue second");
        assert_eq!(
            wait_for_terminal(&manager, first_job.id).status,
            AudioImportStatus::Done
        );
        assert_eq!(
            wait_for_terminal(&manager, second_job.id).status,
            AudioImportStatus::Done
        );
        let transcripts = runtime.transcripts.lock();
        assert_eq!(transcripts[0], transcripts[1]);
    }

    #[test]
    fn media_plan_never_starts_context_or_post_processing() {
        let run = RunPlan::for_media_import(&get_default_settings()).expect("media plan");
        assert!(!run.post_process_requested());
        assert!(run.context().packet().target.application_name.is_none());
    }
}
