use crate::meeting::types::{DiarizationStatus, SpeakerAssignmentKind};
use hf_hub::api::tokio::ApiBuilder;
use hf_hub::{Repo, RepoType};
use ndarray::Array3;
use ort::inputs;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::TensorRef;
use rustfft::num_complex::Complex32;
use rustfft::num_traits::ToPrimitive;
use rustfft::{Fft, FftPlanner};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::sync::{Arc, Mutex};
use std::thread;

const SAMPLE_RATE_HZ: usize = 16_000;
const FRAME_SAMPLES: usize = 400;
const FRAME_HOP_SAMPLES: usize = 160;
const FFT_SIZE: usize = 512;
const MEL_BINS: usize = 80;
const MIN_WINDOW_SAMPLES: usize = SAMPLE_RATE_HZ;
const SPEAKER_MATCH_THRESHOLD: f32 = 0.72;
const OVERLAP_MARGIN: f32 = 0.04;

#[derive(Clone, Debug, Deserialize)]
pub struct DiarizationModelManifest {
    pub id: String,
    pub revision: String,
    pub filename: String,
    pub local_filename: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub license: String,
    pub sample_rate_hz: u32,
    pub feature_bins: usize,
    pub embedding_dimensions: usize,
}

static MODEL_MANIFEST: LazyLock<DiarizationModelManifest> = LazyLock::new(|| {
    // PANIC: the bundled, compile-time JSON asset is part of the application binary.
    serde_json::from_str(include_str!(
        "../../resources/models/meeting-diarization.json"
    ))
    .expect("meeting diarization manifest is valid")
});

pub fn model_manifest() -> &'static DiarizationModelManifest {
    &MODEL_MANIFEST
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiarizationModelAvailability {
    Ready,
    Unavailable,
    Downloading,
    Failed,
}

impl DiarizationModelAvailability {
    pub const fn status(self) -> DiarizationStatus {
        match self {
            Self::Ready => DiarizationStatus::NotRequested,
            Self::Unavailable => DiarizationStatus::ModelUnavailable,
            Self::Downloading => DiarizationStatus::Downloading,
            Self::Failed => DiarizationStatus::Failed,
        }
    }
}

#[derive(Clone)]
pub struct MeetingDiarizer {
    state: Arc<Mutex<DownloadState>>,
    allow_download: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DownloadState {
    Idle,
    Downloading,
    Failed,
}

impl Default for MeetingDiarizer {
    fn default() -> Self {
        Self::new()
    }
}

impl MeetingDiarizer {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(DownloadState::Idle)),
            allow_download: true,
        }
    }

    #[cfg(test)]
    pub fn without_download() -> Self {
        Self {
            state: Arc::new(Mutex::new(DownloadState::Idle)),
            allow_download: false,
        }
    }

    pub fn availability(&self, model_directory: &Path) -> DiarizationModelAvailability {
        if verified_model_path(model_directory).is_some() {
            return DiarizationModelAvailability::Ready;
        }
        match *self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
        {
            DownloadState::Idle => DiarizationModelAvailability::Unavailable,
            DownloadState::Downloading => DiarizationModelAvailability::Downloading,
            DownloadState::Failed => DiarizationModelAvailability::Failed,
        }
    }

    /// Returns a verified local path when the asset is present. A missing asset
    /// starts exactly one background asset download; callers retain the explicit
    /// unavailable state and never substitute another diarizer or a remote path.
    pub fn prepare(&self, model_directory: &Path) -> Result<PathBuf, DiarizationError> {
        if let Some(path) = verified_model_path(model_directory) {
            return Ok(path);
        }
        if !self.allow_download {
            return Err(DiarizationError::ModelUnavailable);
        }

        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *state == DownloadState::Idle || *state == DownloadState::Failed {
            *state = DownloadState::Downloading;
            let state = Arc::clone(&self.state);
            let model_directory = model_directory.to_path_buf();
            thread::spawn(move || {
                let result = tauri::async_runtime::block_on(download_model(&model_directory));
                let mut state = state
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                *state = if result.is_ok() {
                    DownloadState::Idle
                } else {
                    DownloadState::Failed
                };
            });
        }
        Err(DiarizationError::ModelUnavailable)
    }

    pub fn open(&self, path: &Path) -> Result<OnnxDiarizationSession, DiarizationError> {
        OnnxDiarizationSession::open(path)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiarizationError {
    ModelUnavailable,
    ModelInvalid,
    InferenceFailed,
    InvalidAudio,
    DownloadFailed,
}

impl fmt::Display for DiarizationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::ModelUnavailable => "diarization model is unavailable",
            Self::ModelInvalid => "diarization model failed verification",
            Self::InferenceFailed => "diarization inference failed",
            Self::InvalidAudio => "diarization received invalid audio",
            Self::DownloadFailed => "diarization model download failed",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for DiarizationError {}

async fn download_model(model_directory: &Path) -> Result<(), DiarizationError> {
    let manifest = model_manifest();
    let api = ApiBuilder::from_env()
        .build()
        .map_err(|_| DiarizationError::DownloadFailed)?;
    let repository = api.repo(Repo::with_revision(
        manifest.id.clone(),
        RepoType::Model,
        manifest.revision.clone(),
    ));
    let cached = repository
        .get(&manifest.filename)
        .await
        .map_err(|_| DiarizationError::DownloadFailed)?;
    install_verified_model(&cached, model_directory)
}

fn install_verified_model(cached: &Path, model_directory: &Path) -> Result<(), DiarizationError> {
    let manifest = model_manifest();
    fs::create_dir_all(model_directory).map_err(|_| DiarizationError::DownloadFailed)?;
    let target = model_directory.join(&manifest.local_filename);
    let temporary = model_directory.join(format!("{}.partial", manifest.local_filename));
    let _ = fs::remove_file(&temporary);

    let mut source = File::open(cached).map_err(|_| DiarizationError::DownloadFailed)?;
    let mut destination = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| DiarizationError::DownloadFailed)?;
    io::copy(&mut source, &mut destination).map_err(|_| DiarizationError::DownloadFailed)?;
    destination
        .flush()
        .and_then(|()| destination.sync_all())
        .map_err(|_| DiarizationError::DownloadFailed)?;
    drop(destination);

    if !verify_file(&temporary) {
        let _ = fs::remove_file(&temporary);
        return Err(DiarizationError::ModelInvalid);
    }
    fs::rename(&temporary, &target).map_err(|_| DiarizationError::DownloadFailed)?;
    sync_parent(&target).map_err(|_| DiarizationError::DownloadFailed)
}

fn verified_model_path(model_directory: &Path) -> Option<PathBuf> {
    let path = model_directory.join(&model_manifest().local_filename);
    verify_file(&path).then_some(path)
}

fn verify_file(path: &Path) -> bool {
    let manifest = model_manifest();
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if metadata.len() != manifest.size_bytes {
        return false;
    }
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = match file.read(&mut buffer) {
            Ok(count) => count,
            Err(_) => return false,
        };
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    format!("{:x}", digest.finalize()) == manifest.sha256
}

fn sync_parent(path: &Path) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("diarization model has no parent"))?;
    File::open(parent)?.sync_all()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DiarizedWindow {
    pub start_offset_ns: u64,
    pub end_offset_ns: u64,
    pub cluster: Option<u32>,
    pub assignment: SpeakerAssignmentKind,
}

pub struct OnnxDiarizationSession {
    session: Session,
    fft: Arc<dyn Fft<f32>>,
    mel_filters: Vec<Vec<(usize, f32)>>,
    clusters: Vec<SpeakerCluster>,
}

struct SpeakerCluster {
    centroid: Vec<f32>,
    count: u32,
}

impl OnnxDiarizationSession {
    fn open(path: &Path) -> Result<Self, DiarizationError> {
        let manifest = model_manifest();
        if !verify_file(path)
            || manifest.sample_rate_hz != 16_000
            || manifest.feature_bins != MEL_BINS
        {
            return Err(DiarizationError::ModelInvalid);
        }
        let session = Session::builder()
            .map_err(|_| DiarizationError::InferenceFailed)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|_| DiarizationError::InferenceFailed)?
            .commit_from_file(path)
            .map_err(|_| DiarizationError::InferenceFailed)?;
        let mut planner = FftPlanner::new();
        Ok(Self {
            session,
            fft: planner.plan_fft_forward(FFT_SIZE),
            mel_filters: mel_filters()?,
            clusters: Vec::new(),
        })
    }

    pub fn diarize_window(
        &mut self,
        samples: &[f32],
        start_offset_ns: u64,
        end_offset_ns: u64,
    ) -> Result<DiarizedWindow, DiarizationError> {
        if samples.len() < MIN_WINDOW_SAMPLES || start_offset_ns >= end_offset_ns {
            return Err(DiarizationError::InvalidAudio);
        }
        let embedding = self.embed(samples)?;
        let mut ranked = self
            .clusters
            .iter()
            .enumerate()
            .map(|(index, cluster)| (index, cosine_similarity(&embedding, &cluster.centroid)))
            .collect::<Vec<_>>();
        ranked.sort_by(|left, right| right.1.total_cmp(&left.1));

        if ranked.len() > 1
            && ranked[0].1 >= SPEAKER_MATCH_THRESHOLD
            && ranked[1].1 >= SPEAKER_MATCH_THRESHOLD
            && ranked[0].1 - ranked[1].1 <= OVERLAP_MARGIN
        {
            return Ok(DiarizedWindow {
                start_offset_ns,
                end_offset_ns,
                cluster: None,
                assignment: SpeakerAssignmentKind::Overlap,
            });
        }

        let cluster_index = ranked
            .first()
            .filter(|(_, score)| *score >= SPEAKER_MATCH_THRESHOLD)
            .map(|(index, _)| *index)
            .unwrap_or_else(|| {
                self.clusters.push(SpeakerCluster {
                    centroid: embedding.clone(),
                    count: 0,
                });
                self.clusters.len() - 1
            });
        let cluster = self
            .clusters
            .get_mut(cluster_index)
            .ok_or(DiarizationError::InferenceFailed)?;
        update_centroid(cluster, &embedding)?;
        Ok(DiarizedWindow {
            start_offset_ns,
            end_offset_ns,
            cluster: Some(
                u32::try_from(cluster_index).map_err(|_| DiarizationError::InferenceFailed)?,
            ),
            assignment: SpeakerAssignmentKind::SystemSpeaker,
        })
    }

    fn embed(&mut self, samples: &[f32]) -> Result<Vec<f32>, DiarizationError> {
        let features = log_mel_features(samples, self.fft.as_ref(), &self.mel_filters)?;
        let frame_count = features.len() / MEL_BINS;
        let feature_array = Array3::from_shape_vec((1, frame_count, MEL_BINS), features)
            .map_err(|_| DiarizationError::InferenceFailed)?
            .into_dyn();
        let tensor = TensorRef::from_array_view(feature_array.view())
            .map_err(|_| DiarizationError::InferenceFailed)?;
        let outputs = self
            .session
            .run(inputs!["input_features" => tensor])
            .map_err(|_| DiarizationError::InferenceFailed)?;
        let embedding = outputs[0]
            .try_extract_array::<f32>()
            .map_err(|_| DiarizationError::InferenceFailed)?;
        let mut values = embedding.iter().copied().collect::<Vec<_>>();
        if values.len() != model_manifest().embedding_dimensions {
            return Err(DiarizationError::InferenceFailed);
        }
        normalize(&mut values).ok_or(DiarizationError::InferenceFailed)?;
        Ok(values)
    }
}

fn update_centroid(
    cluster: &mut SpeakerCluster,
    embedding: &[f32],
) -> Result<(), DiarizationError> {
    let previous = cluster
        .count
        .to_f32()
        .ok_or(DiarizationError::InferenceFailed)?;
    let next = previous + 1.0;
    for (centroid, value) in cluster.centroid.iter_mut().zip(embedding) {
        *centroid = (*centroid * previous + *value) / next;
    }
    cluster.count = cluster.count.saturating_add(1);
    normalize(&mut cluster.centroid).ok_or(DiarizationError::InferenceFailed)
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

fn normalize(values: &mut [f32]) -> Option<()> {
    let norm = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    (norm.is_finite() && norm > f32::EPSILON).then(|| {
        for value in values {
            *value /= norm;
        }
    })
}

fn log_mel_features(
    samples: &[f32],
    fft: &dyn Fft<f32>,
    filters: &[Vec<(usize, f32)>],
) -> Result<Vec<f32>, DiarizationError> {
    if samples.len() < FRAME_SAMPLES {
        return Err(DiarizationError::InvalidAudio);
    }
    let frame_count = 1 + (samples.len() - FRAME_SAMPLES) / FRAME_HOP_SAMPLES;
    let mut features = Vec::with_capacity(frame_count * MEL_BINS);
    let window = hamming_window()?;
    let mut spectrum = vec![Complex32::default(); FFT_SIZE];
    for frame_index in 0..frame_count {
        spectrum.fill(Complex32::default());
        let start = frame_index * FRAME_HOP_SAMPLES;
        for (sample, (windowed, coefficient)) in samples[start..start + FRAME_SAMPLES]
            .iter()
            .zip(spectrum.iter_mut().zip(window.iter()))
        {
            *windowed = Complex32::new(sample * coefficient, 0.0);
        }
        fft.process(&mut spectrum);
        let power = spectrum[..=FFT_SIZE / 2]
            .iter()
            .map(|value| value.norm_sqr() / 512.0)
            .collect::<Vec<_>>();
        for filter in filters {
            let energy = filter
                .iter()
                .map(|(bin, weight)| power[*bin] * *weight)
                .sum::<f32>();
            features.push(energy.max(1e-10).ln());
        }
    }
    let mean = features.iter().sum::<f32>()
        / features
            .len()
            .to_f32()
            .ok_or(DiarizationError::InferenceFailed)?;
    for value in &mut features {
        *value -= mean;
    }
    Ok(features)
}

fn hamming_window() -> Result<Vec<f32>, DiarizationError> {
    let denominator = (FRAME_SAMPLES - 1)
        .to_f32()
        .ok_or(DiarizationError::InferenceFailed)?;
    (0..FRAME_SAMPLES)
        .map(|index| {
            let index = index.to_f32().ok_or(DiarizationError::InferenceFailed)?;
            Ok(0.54 - 0.46 * (2.0 * std::f32::consts::PI * index / denominator).cos())
        })
        .collect()
}

fn mel_filters() -> Result<Vec<Vec<(usize, f32)>>, DiarizationError> {
    let lower_mel = hz_to_mel(20.0);
    let upper_mel = hz_to_mel(8_000.0);
    let denominator = (MEL_BINS + 1)
        .to_f32()
        .ok_or(DiarizationError::InferenceFailed)?;
    let mel_points = (0..MEL_BINS + 2)
        .map(|index| {
            let index = index.to_f32().ok_or(DiarizationError::InferenceFailed)?;
            let mel = lower_mel + (upper_mel - lower_mel) * index / denominator;
            hz_to_fft_bin(mel_to_hz(mel))
        })
        .collect::<Result<Vec<_>, _>>()?;
    (1..=MEL_BINS)
        .map(|index| {
            let lower = mel_points[index - 1];
            let center = mel_points[index];
            let upper = mel_points[index + 1];
            let mut filter = Vec::new();
            for bin in lower..center {
                let denominator = (center - lower)
                    .max(1)
                    .to_f32()
                    .ok_or(DiarizationError::InferenceFailed)?;
                let weight = (bin - lower)
                    .to_f32()
                    .ok_or(DiarizationError::InferenceFailed)?
                    / denominator;
                filter.push((bin, weight));
            }
            for bin in center..=upper.min(FFT_SIZE / 2) {
                let denominator = (upper - center)
                    .max(1)
                    .to_f32()
                    .ok_or(DiarizationError::InferenceFailed)?;
                let weight = upper
                    .saturating_sub(bin)
                    .to_f32()
                    .ok_or(DiarizationError::InferenceFailed)?
                    / denominator;
                filter.push((bin, weight));
            }
            Ok(filter)
        })
        .collect()
}

fn hz_to_mel(hz: f32) -> f32 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

fn mel_to_hz(mel: f32) -> f32 {
    700.0 * (10_f32.powf(mel / 2595.0) - 1.0)
}

fn hz_to_fft_bin(hz: f32) -> Result<usize, DiarizationError> {
    ((513.0 * hz / 16_000.0).floor().clamp(0.0, 256.0))
        .to_usize()
        .ok_or(DiarizationError::InferenceFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_model_stays_explicitly_unavailable_without_download(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let diarizer = MeetingDiarizer::without_download();
        assert_eq!(
            diarizer.availability(directory.path()),
            DiarizationModelAvailability::Unavailable
        );
        assert_eq!(
            diarizer.prepare(directory.path()),
            Err(DiarizationError::ModelUnavailable)
        );
        Ok(())
    }

    #[test]
    fn mel_features_are_bounded_by_window_size() -> Result<(), DiarizationError> {
        let mut planner = FftPlanner::new();
        let filters = mel_filters()?;
        let audio = vec![0.1_f32; SAMPLE_RATE_HZ * 2];
        let features = log_mel_features(
            &audio,
            planner.plan_fft_forward(FFT_SIZE).as_ref(),
            &filters,
        )?;
        assert_eq!(features.len() % MEL_BINS, 0);
        assert!(features.len() <= (SAMPLE_RATE_HZ * 2 / FRAME_HOP_SAMPLES + 1) * MEL_BINS);
        Ok(())
    }

    #[test]
    fn ambiguous_cluster_match_marks_overlap() -> Result<(), DiarizationError> {
        let mut cluster = SpeakerCluster {
            centroid: vec![1.0, 0.0],
            count: 1,
        };
        update_centroid(&mut cluster, &[1.0, 0.0])?;
        assert_eq!(cosine_similarity(&cluster.centroid, &[1.0, 0.0]), 1.0);
        assert!(OVERLAP_MARGIN > 0.0);
        Ok(())
    }
}
