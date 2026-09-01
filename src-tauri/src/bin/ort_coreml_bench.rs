use anyhow::{Context, Result};
use clap::Parser;
use sona_app_lib::audio_toolkit::ort_session::{
    capability_label, configure_transcribe_provider, coreml_available, OrtProvider,
};
use sona_app_lib::audio_toolkit::vad::{
    SmoothedVad, TenVad, VoiceActivityDetector, VAD_OFFLINE_HANGOVER_FRAMES, VAD_ONSET_FRAMES,
    VAD_PREFILL_FRAMES,
};
use sona_app_lib::audio_toolkit::{normalize_transcription_output, read_wav_samples};
use std::collections::BTreeSet;
use std::f32::consts::TAU;
use std::mem::MaybeUninit;
use std::path::{Path, PathBuf};
use std::time::Instant;
use transcribe_rs::onnx::moonshine::StreamingModel;
use transcribe_rs::onnx::Quantization;
use transcribe_rs::{SpeechModel, TranscribeOptions};

const SAMPLE_RATE: usize = 16_000;
const FRAME_SAMPLES: usize = 480;
const TEN_THRESHOLD: f32 = 0.55;
const NODE_COUNTS: &str = "unavailable (ort rc.12 has no public post-partition API)";

#[derive(Parser)]
#[command(about = "Headless CPU/CoreML session benchmark")]
struct Args {
    #[arg(long, default_value = "resources/models/ten-vad.onnx")]
    ten_model: PathBuf,
    #[arg(long)]
    asr_model: PathBuf,
    #[arg(long)]
    audio: PathBuf,
    #[arg(long, default_value = "moonshine-tiny-streaming-en")]
    asr_label: String,
    #[arg(long, default_value_t = 30)]
    runs: usize,
    #[arg(long, default_value_t = 3)]
    vad_replays: usize,
    #[arg(long, default_value_t = 600)]
    capture_seconds: usize,
}

#[derive(Clone, Copy)]
struct ProcessUsage {
    cpu_ms: f64,
    footprint_mib: f64,
    lifetime_peak_footprint_mib: f64,
}

#[cfg(target_os = "macos")]
fn process_usage() -> Result<ProcessUsage> {
    let mut usage = MaybeUninit::<libc::rusage_info_v4>::zeroed();
    let status = unsafe {
        libc::proc_pid_rusage(
            libc::getpid(),
            libc::RUSAGE_INFO_V4,
            usage.as_mut_ptr() as _,
        )
    };
    if status != 0 {
        return Err(std::io::Error::last_os_error()).context("read process rusage");
    }
    let usage = unsafe { usage.assume_init() };
    Ok(ProcessUsage {
        cpu_ms: (usage.ri_user_time + usage.ri_system_time) as f64 / 1_000_000.0,
        footprint_mib: usage.ri_phys_footprint as f64 / (1024.0 * 1024.0),
        lifetime_peak_footprint_mib: usage.ri_lifetime_max_phys_footprint as f64
            / (1024.0 * 1024.0),
    })
}

#[cfg(not(target_os = "macos"))]
fn process_usage() -> Result<ProcessUsage> {
    let mut usage = MaybeUninit::<libc::rusage>::zeroed();
    let status = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    if status != 0 {
        return Err(std::io::Error::last_os_error()).context("read process rusage");
    }
    let usage = unsafe { usage.assume_init() };
    let millis = |time: libc::timeval| time.tv_sec as f64 * 1_000.0 + time.tv_usec as f64 / 1_000.0;
    Ok(ProcessUsage {
        cpu_ms: millis(usage.ru_utime) + millis(usage.ru_stime),
        footprint_mib: 0.0,
        lifetime_peak_footprint_mib: 0.0,
    })
}

#[derive(Default)]
struct Cohort {
    init_ms: Vec<f64>,
    wall_ms: Vec<f64>,
    cpu_ms: Vec<f64>,
    footprint_mib: Vec<f64>,
    providers: BTreeSet<String>,
}

impl Cohort {
    fn record(
        &mut self,
        init_ms: Option<f64>,
        wall_ms: f64,
        before: ProcessUsage,
        after: ProcessUsage,
        provider: impl Into<String>,
    ) {
        if let Some(init_ms) = init_ms {
            self.init_ms.push(init_ms);
        }
        self.wall_ms.push(wall_ms);
        self.cpu_ms.push((after.cpu_ms - before.cpu_ms).max(0.0));
        self.footprint_mib
            .push(after.footprint_mib.max(after.lifetime_peak_footprint_mib));
        self.providers.insert(provider.into());
    }

    fn provider_label(&self) -> String {
        self.providers
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join(", ")
    }
}

struct ProviderCohorts {
    cold: Cohort,
    warm: Cohort,
    transcripts: Vec<String>,
}

struct ReplayResult {
    provider: OrtProvider,
    wall_ms: f64,
    cpu_ms: f64,
    footprint_mib: f64,
    frame_wall_ms: Vec<f64>,
    decisions: Vec<bool>,
}

fn percentile(values: &[f64], quantile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let rank = ((sorted.len() as f64 * quantile).ceil() as usize)
        .saturating_sub(1)
        .min(sorted.len() - 1);
    sorted[rank]
}

fn spread(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    max - min
}

fn improvement_percent(cpu: f64, coreml: f64) -> f64 {
    if cpu <= 0.0 {
        0.0
    } else {
        (cpu - coreml) * 100.0 / cpu
    }
}

fn generate_capture(seconds: usize) -> Vec<f32> {
    let mut samples = Vec::with_capacity(seconds * SAMPLE_RATE);
    for sample_index in 0..seconds * SAMPLE_RATE {
        let time = sample_index as f32 / SAMPLE_RATE as f32;
        let cycle = time % 12.0;
        let hash = (sample_index as u32)
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        let noise = ((hash >> 8) as f32 / 16_777_215.0) * 2.0 - 1.0;
        let value = if (2.0..8.0).contains(&cycle) {
            let syllable = (time * 3.7).sin().max(-0.65) + 0.65;
            let voiced = (110.0 * time * TAU).sin() * 0.14
                + (220.0 * time * TAU).sin() * 0.07
                + (330.0 * time * TAU).sin() * 0.035;
            voiced * syllable + noise * 0.008
        } else {
            noise * 0.002
        };
        samples.push(value);
    }
    samples
}

fn benchmark_vad_sessions(
    model_path: &Path,
    capture: &[f32],
    requested: OrtProvider,
    runs: usize,
) -> Result<ProviderCohorts> {
    let frame = capture
        .chunks_exact(FRAME_SAMPLES)
        .nth(100)
        .context("synthetic capture has no benchmark frame")?;
    let mut cold = Cohort::default();
    for _ in 0..runs {
        let before = process_usage()?;
        let started = Instant::now();
        let mut vad = TenVad::new_with_provider(model_path, TEN_THRESHOLD, requested)?;
        let init_ms = vad.session_init_duration().as_secs_f64() * 1_000.0;
        let provider = vad.provider();
        let _ = vad.push_frame(frame)?;
        let wall_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let after = process_usage()?;
        cold.record(Some(init_ms), wall_ms, before, after, provider.to_string());
    }

    let mut vad = TenVad::new_with_provider(model_path, TEN_THRESHOLD, requested)?;
    let warm_provider = vad.provider();
    let _ = vad.push_frame(frame)?;
    let mut warm = Cohort::default();
    for frame in capture.chunks_exact(FRAME_SAMPLES).skip(101).take(runs) {
        let before = process_usage()?;
        let started = Instant::now();
        let _ = vad.push_frame(frame)?;
        let wall_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let after = process_usage()?;
        warm.record(None, wall_ms, before, after, warm_provider.to_string());
    }

    Ok(ProviderCohorts {
        cold,
        warm,
        transcripts: Vec::new(),
    })
}

fn transcribe_once(model: &mut StreamingModel, audio: &[f32]) -> Result<String> {
    let result = model
        .transcribe(audio, &TranscribeOptions::default())
        .context("transcribe ASR fixture")?;
    Ok(normalize_transcription_output(&result.text))
}

fn configure_asr_provider(requested: OrtProvider) -> String {
    match configure_transcribe_provider(requested) {
        OrtProvider::Cpu => "cpu".to_string(),
        OrtProvider::CoreMl => "coreml (post-partition state opaque)".to_string(),
    }
}

fn benchmark_asr_sessions(
    model_path: &Path,
    audio: &[f32],
    requested: OrtProvider,
    runs: usize,
) -> Result<ProviderCohorts> {
    let mut cold = Cohort::default();
    let mut transcripts = Vec::with_capacity(runs * 2 + 1);
    for _ in 0..runs {
        let provider_label = configure_asr_provider(requested);
        let before = process_usage()?;
        let started = Instant::now();
        let init_started = Instant::now();
        let mut model = StreamingModel::load(model_path, 0, &Quantization::default())
            .context("initialize Moonshine streaming model")?;
        let init_ms = init_started.elapsed().as_secs_f64() * 1_000.0;
        transcripts.push(transcribe_once(&mut model, audio)?);
        let wall_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let after = process_usage()?;
        cold.record(Some(init_ms), wall_ms, before, after, provider_label);
    }

    let provider_label = configure_asr_provider(requested);
    let init_started = Instant::now();
    let mut model = StreamingModel::load(model_path, 0, &Quantization::default())
        .context("initialize warm Moonshine streaming model")?;
    let warm_init_ms = init_started.elapsed().as_secs_f64() * 1_000.0;
    transcripts.push(transcribe_once(&mut model, audio)?);

    let mut warm = Cohort::default();
    for index in 0..runs {
        let before = process_usage()?;
        let started = Instant::now();
        transcripts.push(transcribe_once(&mut model, audio)?);
        let wall_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let after = process_usage()?;
        warm.record(
            (index == 0).then_some(warm_init_ms),
            wall_ms,
            before,
            after,
            provider_label.clone(),
        );
    }

    Ok(ProviderCohorts {
        cold,
        warm,
        transcripts,
    })
}

fn replay_vad(model_path: &Path, capture: &[f32], requested: OrtProvider) -> Result<ReplayResult> {
    let ten = TenVad::new_with_provider(model_path, TEN_THRESHOLD, requested)?;
    let provider = ten.provider();
    let mut vad = SmoothedVad::new(
        Box::new(ten),
        VAD_PREFILL_FRAMES,
        VAD_OFFLINE_HANGOVER_FRAMES,
        VAD_ONSET_FRAMES,
    );
    let before = process_usage()?;
    let started = Instant::now();
    let mut decisions = Vec::with_capacity(capture.len() / FRAME_SAMPLES);
    let mut frame_wall_ms = Vec::with_capacity(decisions.capacity());
    for frame in capture.chunks_exact(FRAME_SAMPLES) {
        let frame_started = Instant::now();
        decisions.push(vad.push_frame(frame)?.is_speech());
        frame_wall_ms.push(frame_started.elapsed().as_secs_f64() * 1_000.0);
    }
    let wall_ms = started.elapsed().as_secs_f64() * 1_000.0;
    let after = process_usage()?;
    Ok(ReplayResult {
        provider,
        wall_ms,
        cpu_ms: (after.cpu_ms - before.cpu_ms).max(0.0),
        footprint_mib: after.footprint_mib.max(after.lifetime_peak_footprint_mib),
        frame_wall_ms,
        decisions,
    })
}

fn print_cohort_row(session: &str, requested: OrtProvider, phase: &str, cohort: &Cohort) {
    let init = if cohort.init_ms.is_empty() {
        "n/a".to_string()
    } else {
        format!("{:.3}", percentile(&cohort.init_ms, 0.5))
    };
    println!(
        "| {session} | {requested} | {} | {phase} | {} | {init} | {NODE_COUNTS} | {:.3} | {:.3} | {:.3} | {:.3} | {:.1} |",
        cohort.provider_label(),
        cohort.wall_ms.len(),
        percentile(&cohort.wall_ms, 0.5),
        percentile(&cohort.wall_ms, 0.95),
        cohort.cpu_ms.iter().sum::<f64>(),
        percentile(&cohort.cpu_ms, 0.5),
        cohort.footprint_mib.iter().copied().fold(0.0, f64::max),
    );
}

fn print_replay_row(requested: OrtProvider, replays: &[ReplayResult]) {
    let walls = replays.iter().map(|run| run.wall_ms).collect::<Vec<_>>();
    let cpu = replays.iter().map(|run| run.cpu_ms).collect::<Vec<_>>();
    let providers = replays
        .iter()
        .map(|run| run.provider.to_string())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join(", ");
    println!(
        "| ten-vad 10m replay | {requested} | {providers} | replay | {} | n/a | {NODE_COUNTS} | {:.3} | {:.3} | {:.3} | {:.3} | {:.1} |",
        replays.len(),
        percentile(&walls, 0.5),
        percentile(&walls, 0.95),
        cpu.iter().sum::<f64>(),
        percentile(&cpu, 0.5),
        replays
            .iter()
            .map(|run| run.footprint_mib)
            .fold(0.0, f64::max),
    );
}

fn boundary_count(decisions: &[bool]) -> usize {
    decisions
        .windows(2)
        .filter(|pair| pair[0] != pair[1])
        .count()
}

fn vad_gate_passes(
    coreml_session_initialized: bool,
    cpu_drop_ms: f64,
    noise_ms: f64,
    boundary_mismatches: usize,
    cpu_frame_p95_ms: f64,
    coreml_frame_p95_ms: f64,
) -> bool {
    coreml_available()
        && coreml_session_initialized
        && cpu_drop_ms > noise_ms
        && boundary_mismatches == 0
        && coreml_frame_p95_ms <= 30.0
        && coreml_frame_p95_ms <= cpu_frame_p95_ms
}

fn asr_gate_passes(
    p50_win_percent: f64,
    cpu_win_percent: f64,
    cpu_p95_ms: f64,
    coreml_p95_ms: f64,
    transcript_mismatches: usize,
) -> bool {
    coreml_available()
        && (p50_win_percent >= 20.0 || cpu_win_percent >= 20.0)
        && coreml_p95_ms <= cpu_p95_ms
        && transcript_mismatches == 0
}

fn main() -> Result<()> {
    let args = Args::parse();
    anyhow::ensure!(args.runs > 0, "--runs must be positive");
    anyhow::ensure!(args.vad_replays >= 3, "--vad-replays must be at least 3");
    anyhow::ensure!(
        args.capture_seconds > 0,
        "--capture-seconds must be positive"
    );
    anyhow::ensure!(args.ten_model.is_file(), "TEN-VAD model is missing");
    anyhow::ensure!(args.asr_model.is_dir(), "ASR model directory is missing");
    anyhow::ensure!(args.audio.is_file(), "ASR fixture is missing");

    let capture = generate_capture(args.capture_seconds);
    let audio = read_wav_samples(&args.audio).context("read ASR fixture")?;

    println!("# ORT CoreML benchmark");
    println!();
    println!("Compiled provider capability: {}", capability_label());
    println!(
        "ASR model: {} ({})",
        args.asr_label,
        args.asr_model.display()
    );
    println!("ASR fixture: {}", args.audio.display());
    println!(
        "Synthetic VAD capture: {} seconds, {} frames at 30 ms cadence",
        args.capture_seconds,
        capture.len() / FRAME_SAMPLES
    );
    println!("Energy sampler: skipped; process CPU time is the safe proxy");
    println!();

    let vad_cpu = benchmark_vad_sessions(&args.ten_model, &capture, OrtProvider::Cpu, args.runs)?;
    let vad_coreml =
        benchmark_vad_sessions(&args.ten_model, &capture, OrtProvider::CoreMl, args.runs)?;

    let mut replay_cpu = Vec::with_capacity(args.vad_replays);
    let mut replay_coreml = Vec::with_capacity(args.vad_replays);
    for _ in 0..args.vad_replays {
        replay_cpu.push(replay_vad(&args.ten_model, &capture, OrtProvider::Cpu)?);
        replay_coreml.push(replay_vad(&args.ten_model, &capture, OrtProvider::CoreMl)?);
    }

    println!("## Results");
    println!();
    println!("| session | requested | initialized/provider visibility | phase | n | init p50 ms | assigned/fallback nodes | wall p50 ms | wall p95 ms | CPU total ms | CPU p50 ms | peak phys footprint MiB |");
    println!("|---|---:|---|---:|---:|---:|---|---:|---:|---:|---:|---:|");
    print_cohort_row("ten-vad", OrtProvider::Cpu, "cold", &vad_cpu.cold);
    print_cohort_row("ten-vad", OrtProvider::Cpu, "warm", &vad_cpu.warm);
    print_cohort_row("ten-vad", OrtProvider::CoreMl, "cold", &vad_coreml.cold);
    print_cohort_row("ten-vad", OrtProvider::CoreMl, "warm", &vad_coreml.warm);
    print_replay_row(OrtProvider::Cpu, &replay_cpu);
    print_replay_row(OrtProvider::CoreMl, &replay_coreml);
    println!();
    let asr_cpu = benchmark_asr_sessions(&args.asr_model, &audio, OrtProvider::Cpu, args.runs)?;
    print_cohort_row(&args.asr_label, OrtProvider::Cpu, "cold", &asr_cpu.cold);
    print_cohort_row(&args.asr_label, OrtProvider::Cpu, "warm", &asr_cpu.warm);
    let asr_coreml =
        benchmark_asr_sessions(&args.asr_model, &audio, OrtProvider::CoreMl, args.runs)?;
    print_cohort_row(
        &args.asr_label,
        OrtProvider::CoreMl,
        "cold",
        &asr_coreml.cold,
    );
    print_cohort_row(
        &args.asr_label,
        OrtProvider::CoreMl,
        "warm",
        &asr_coreml.warm,
    );
    println!();

    let reference_decisions = &replay_cpu[0].decisions;
    let boundary_mismatches = replay_cpu
        .iter()
        .chain(&replay_coreml)
        .filter(|run| run.decisions.as_slice() != reference_decisions.as_slice())
        .count();
    let cpu_replay_cpu = replay_cpu.iter().map(|run| run.cpu_ms).collect::<Vec<_>>();
    let coreml_replay_cpu = replay_coreml
        .iter()
        .map(|run| run.cpu_ms)
        .collect::<Vec<_>>();
    let cpu_replay_median = percentile(&cpu_replay_cpu, 0.5);
    let coreml_replay_median = percentile(&coreml_replay_cpu, 0.5);
    let replay_noise = spread(&cpu_replay_cpu).max(spread(&coreml_replay_cpu));
    let replay_cpu_drop = cpu_replay_median - coreml_replay_median;
    let cpu_frame_p95 = percentile(
        &replay_cpu
            .iter()
            .flat_map(|run| run.frame_wall_ms.iter().copied())
            .collect::<Vec<_>>(),
        0.95,
    );
    let coreml_frame_p95 = percentile(
        &replay_coreml
            .iter()
            .flat_map(|run| run.frame_wall_ms.iter().copied())
            .collect::<Vec<_>>(),
        0.95,
    );
    let coreml_vad_sessions_initialized = replay_coreml
        .iter()
        .all(|run| run.provider == OrtProvider::CoreMl);
    let vad_gate = vad_gate_passes(
        coreml_vad_sessions_initialized,
        replay_cpu_drop,
        replay_noise,
        boundary_mismatches,
        cpu_frame_p95,
        coreml_frame_p95,
    );

    let reference_transcript = asr_cpu
        .transcripts
        .first()
        .context("CPU ASR produced no transcript")?;
    anyhow::ensure!(
        !reference_transcript.trim().is_empty(),
        "CPU ASR produced an empty normalized transcript"
    );
    let transcript_mismatches = asr_cpu
        .transcripts
        .iter()
        .chain(&asr_coreml.transcripts)
        .filter(|transcript| transcript.as_str() != reference_transcript.as_str())
        .count();
    let cpu_asr_p50 = percentile(&asr_cpu.warm.wall_ms, 0.5);
    let coreml_asr_p50 = percentile(&asr_coreml.warm.wall_ms, 0.5);
    let cpu_asr_p95 = percentile(&asr_cpu.warm.wall_ms, 0.95);
    let coreml_asr_p95 = percentile(&asr_coreml.warm.wall_ms, 0.95);
    let cpu_asr_cpu = asr_cpu.warm.cpu_ms.iter().sum::<f64>();
    let coreml_asr_cpu = asr_coreml.warm.cpu_ms.iter().sum::<f64>();
    let asr_p50_win = improvement_percent(cpu_asr_p50, coreml_asr_p50);
    let asr_cpu_win = improvement_percent(cpu_asr_cpu, coreml_asr_cpu);
    let asr_gate = asr_gate_passes(
        asr_p50_win,
        asr_cpu_win,
        cpu_asr_p95,
        coreml_asr_p95,
        transcript_mismatches,
    );

    println!("## Gate decisions");
    println!();
    println!(
        "- TEN-VAD: {}. CoreML session initialized: {}. CPU median {:.3} ms vs CoreML {:.3} ms per 10-minute replay; drop {:.3} ms, three-run noise {:.3} ms; boundary mismatches {}; boundaries {}; frame p95 {:.3} ms CPU vs {:.3} ms CoreML.",
        if vad_gate { "keep CoreML" } else { "keep CPU" },
        coreml_vad_sessions_initialized,
        cpu_replay_median,
        coreml_replay_median,
        replay_cpu_drop,
        replay_noise,
        boundary_mismatches,
        boundary_count(reference_decisions),
        cpu_frame_p95,
        coreml_frame_p95,
    );
    println!(
        "- ONNX ASR: {}. Warm p50 {:.3} ms CPU vs {:.3} ms CoreML ({:.1}% win); warm p95 {:.3} ms vs {:.3} ms; CPU time {:.3} ms vs {:.3} ms ({:.1}% win); normalized transcript mismatches {}.",
        if asr_gate { "keep CoreML" } else { "keep CPU" },
        cpu_asr_p50,
        coreml_asr_p50,
        asr_p50_win,
        cpu_asr_p95,
        coreml_asr_p95,
        cpu_asr_cpu,
        coreml_asr_cpu,
        asr_cpu_win,
        transcript_mismatches,
    );
    println!("- Normalized transcript: {:?}", reference_transcript);
    println!("- Provider partition limit: {NODE_COUNTS}; transcribe-rs 0.3.8 also hides its component sessions, so its CoreML row means runtime capability plus successful model initialization, not proof that every node left CPU.");

    anyhow::ensure!(
        boundary_mismatches == 0,
        "CoreML changed smoothed TEN-VAD boundary decisions"
    );
    anyhow::ensure!(
        transcript_mismatches == 0,
        "CoreML changed the normalized ASR transcript"
    );
    Ok(())
}
