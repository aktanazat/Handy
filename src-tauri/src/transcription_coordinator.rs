use crate::actions;
use crate::managers::audio::AudioRecordingManager;
use crate::modes::{RunPlan, TranscriptionIntent};
use log::{debug, error, warn};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const DEBOUNCE: Duration = Duration::from_millis(30);
const RELEASE_GRACE: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PttAction {
    Passthrough,
    DeferRelease,
    CancelRelease,
}

struct PendingRelease {
    intent: TranscriptionIntent,
    shortcut_label: String,
    deadline: Instant,
}

/// Commands processed sequentially by the coordinator thread.
enum Command {
    Input {
        intent: TranscriptionIntent,
        shortcut_label: String,
        is_pressed: bool,
        push_to_talk: bool,
    },
    Cancel {
        recording_was_active: bool,
    },
    ProcessingFinished,
}

enum Stage {
    Idle,
    Recording {
        intent: TranscriptionIntent,
        run_plan: Box<RunPlan>,
    },
    Processing,
}

fn classify_ptt_event(
    pending_release_intent: Option<&TranscriptionIntent>,
    is_pressed: bool,
    push_to_talk: bool,
    intent: &TranscriptionIntent,
    recording_intent: Option<&TranscriptionIntent>,
) -> PttAction {
    if !push_to_talk {
        return PttAction::Passthrough;
    }

    if is_pressed {
        if pending_release_intent == Some(intent) {
            PttAction::CancelRelease
        } else {
            PttAction::Passthrough
        }
    } else if recording_intent == Some(intent) && pending_release_intent.is_none() {
        PttAction::DeferRelease
    } else {
        PttAction::Passthrough
    }
}

/// Serialises all transcription lifecycle events through a single thread
/// to eliminate race conditions between keyboard shortcuts, signals, and
/// the async transcribe-paste pipeline.
pub struct TranscriptionCoordinator {
    tx: Sender<Command>,
}

impl TranscriptionCoordinator {
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut stage = Stage::Idle;
                let mut last_press: Option<Instant> = None;
                let mut pending_release: Option<PendingRelease> = None;

                loop {
                    let cmd = if let Some(pending) = &pending_release {
                        match rx.recv_timeout(
                            pending.deadline.saturating_duration_since(Instant::now()),
                        ) {
                            Ok(cmd) => cmd,
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                if let Some(pending) = pending_release.take() {
                                    if matches!(&stage, Stage::Recording { intent, .. } if intent == &pending.intent)
                                    {
                                        stop(
                                            &app,
                                            &mut stage,
                                            &pending.intent,
                                            &pending.shortcut_label,
                                        );
                                    }
                                }
                                continue;
                            }
                            Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        }
                    } else {
                        match rx.recv() {
                            Ok(cmd) => cmd,
                            Err(_) => break,
                        }
                    };

                    match cmd {
                        Command::Input {
                            intent,
                            shortcut_label,
                            is_pressed,
                            push_to_talk,
                        } => {
                            let pending_release_intent =
                                pending_release.as_ref().map(|pending| &pending.intent);
                            let recording_intent = match &stage {
                                Stage::Recording { intent, .. } => Some(intent),
                                _ => None,
                            };

                            match classify_ptt_event(
                                pending_release_intent,
                                is_pressed,
                                push_to_talk,
                                &intent,
                                recording_intent,
                            ) {
                                PttAction::CancelRelease => {
                                    pending_release = None;
                                    continue;
                                }
                                PttAction::DeferRelease => {
                                    pending_release = Some(PendingRelease {
                                        intent,
                                        shortcut_label,
                                        deadline: Instant::now() + RELEASE_GRACE,
                                    });
                                    continue;
                                }
                                PttAction::Passthrough => {}
                            }

                            // Debounce rapid-fire press events (key repeat / double-tap).
                            // Push-to-talk releases may be deferred above to absorb X11 auto-repeat.
                            if is_pressed {
                                let now = Instant::now();
                                if last_press.is_some_and(|t| now.duration_since(t) < DEBOUNCE) {
                                    debug!("Debounced transcription intent: {intent:?}");
                                    continue;
                                }
                                last_press = Some(now);
                            }

                            if push_to_talk {
                                if is_pressed && matches!(stage, Stage::Idle) {
                                    start(&app, &mut stage, &intent, &shortcut_label);
                                } else if !is_pressed
                                    && matches!(&stage, Stage::Recording { intent: active, .. } if active == &intent)
                                {
                                    stop(&app, &mut stage, &intent, &shortcut_label);
                                }
                            } else if is_pressed {
                                match &stage {
                                    Stage::Idle => {
                                        start(&app, &mut stage, &intent, &shortcut_label);
                                    }
                                    Stage::Recording { intent: active, .. }
                                        if active == &intent =>
                                    {
                                        stop(&app, &mut stage, &intent, &shortcut_label);
                                    }
                                    _ => {
                                        debug!("Ignoring transcription intent {intent:?}: pipeline busy")
                                    }
                                }
                            }
                        }
                        Command::Cancel {
                            recording_was_active,
                        } => {
                            pending_release = None;
                            // Don't reset during processing — wait for the pipeline to finish.
                            if !matches!(stage, Stage::Processing)
                                && (recording_was_active
                                    || matches!(stage, Stage::Recording { .. }))
                            {
                                stage = Stage::Idle;
                            }
                        }
                        Command::ProcessingFinished => {
                            stage = Stage::Idle;
                        }
                    }
                }
                debug!("Transcription coordinator exited");
            }));
            if let Err(e) = result {
                error!("Transcription coordinator panicked: {e:?}");
            }
        });

        Self { tx }
    }

    /// Route a keyboard event that has already resolved to a typed
    /// transcription intent.
    pub fn send_shortcut_input(
        &self,
        intent: TranscriptionIntent,
        shortcut_label: &str,
        is_pressed: bool,
        push_to_talk: bool,
    ) {
        if self
            .tx
            .send(Command::Input {
                intent,
                shortcut_label: shortcut_label.to_string(),
                is_pressed,
                push_to_talk,
            })
            .is_err()
        {
            warn!("Transcription coordinator channel closed");
        }
    }

    /// Signals and CLI toggles are semantic inputs, not hidden shortcut IDs.
    pub fn send_intent(&self, intent: TranscriptionIntent, source: &str) {
        self.send_shortcut_input(intent, source, true, false);
    }

    pub fn notify_cancel(&self, recording_was_active: bool) {
        if self
            .tx
            .send(Command::Cancel {
                recording_was_active,
            })
            .is_err()
        {
            warn!("Transcription coordinator channel closed");
        }
    }

    pub fn notify_processing_finished(&self) {
        if self.tx.send(Command::ProcessingFinished).is_err() {
            warn!("Transcription coordinator channel closed");
        }
    }
}

fn start(app: &AppHandle, stage: &mut Stage, intent: &TranscriptionIntent, shortcut_label: &str) {
    let settings = crate::settings::get_settings(app);
    let run_plan = match RunPlan::for_intent(&settings, intent) {
        Ok(plan) => plan,
        Err(error) => {
            warn!("Could not build run plan for {intent:?}: {error}");
            return;
        }
    };
    let recording_id = intent.recording_id();
    actions::start_transcription(app, &recording_id, shortcut_label, &run_plan);
    if app
        .try_state::<Arc<AudioRecordingManager>>()
        .is_some_and(|manager| manager.is_recording())
    {
        *stage = Stage::Recording {
            intent: intent.clone(),
            run_plan: Box::new(run_plan),
        };
    } else {
        debug!("Start for {intent:?} did not begin recording; staying idle");
    }
}

fn stop(app: &AppHandle, stage: &mut Stage, intent: &TranscriptionIntent, shortcut_label: &str) {
    let prior = std::mem::replace(stage, Stage::Processing);
    match prior {
        Stage::Recording {
            intent: active_intent,
            run_plan,
        } if active_intent == *intent => {
            actions::stop_transcription(app, &intent.recording_id(), shortcut_label, *run_plan);
        }
        other => {
            warn!("Ignoring stop for {intent:?} because no matching recording is active");
            *stage = other;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn active_mode() -> TranscriptionIntent {
        TranscriptionIntent::ActiveMode
    }

    #[test]
    fn push_to_talk_release_while_recording_defers_release() {
        let intent = active_mode();
        assert_eq!(
            classify_ptt_event(None, false, true, &intent, Some(&intent)),
            PttAction::DeferRelease
        );
    }

    #[test]
    fn push_to_talk_press_matching_pending_release_cancels_release() {
        let intent = active_mode();
        assert_eq!(
            classify_ptt_event(Some(&intent), true, true, &intent, Some(&intent)),
            PttAction::CancelRelease
        );
    }

    #[test]
    fn toggle_mode_press_and_release_pass_through() {
        let intent = active_mode();
        assert_eq!(
            classify_ptt_event(Some(&intent), true, false, &intent, Some(&intent)),
            PttAction::Passthrough
        );
        assert_eq!(
            classify_ptt_event(None, false, false, &intent, Some(&intent)),
            PttAction::Passthrough
        );
    }

    #[test]
    fn different_semantic_intent_does_not_cancel_a_pending_release() {
        let active = active_mode();
        let post_process = TranscriptionIntent::ActiveModeWithPostProcess;
        assert_eq!(
            classify_ptt_event(Some(&active), true, true, &post_process, Some(&active)),
            PttAction::Passthrough
        );
    }

    #[test]
    fn legacy_binding_id_is_not_a_transcription_binding() {
        assert!(
            TranscriptionIntent::from_binding(crate::modes::LEGACY_POST_PROCESS_BINDING_ID)
                .is_none()
        );
        assert_eq!(
            TranscriptionIntent::from_binding("transcribe"),
            Some(TranscriptionIntent::ActiveMode)
        );
    }

    #[derive(Clone, Copy)]
    enum Ev {
        Press,
        Release,
        Grace,
    }

    #[derive(Debug, PartialEq, Eq)]
    enum SimStage {
        Idle,
        Recording,
        Processing,
    }

    struct SimResult {
        starts: u32,
        stops: u32,
        stage: SimStage,
    }

    fn simulate(events: &[Ev]) -> SimResult {
        let intent = active_mode();
        let mut stage = SimStage::Idle;
        let mut pending: Option<TranscriptionIntent> = None;
        let mut last_press: Option<Duration> = None;
        let mut clock = Duration::ZERO;
        let mut starts = 0u32;
        let mut stops = 0u32;

        for ev in events {
            clock += Duration::from_millis(5);
            match ev {
                Ev::Grace => {
                    if pending
                        .take()
                        .is_some_and(|pending| stage == SimStage::Recording && pending == intent)
                    {
                        stage = SimStage::Processing;
                        stops += 1;
                    }
                }
                Ev::Press | Ev::Release => {
                    let is_pressed = matches!(ev, Ev::Press);
                    let pending_intent = pending.as_ref();
                    let recording_intent = (stage == SimStage::Recording).then_some(&intent);
                    match classify_ptt_event(
                        pending_intent,
                        is_pressed,
                        true,
                        &intent,
                        recording_intent,
                    ) {
                        PttAction::CancelRelease => {
                            pending = None;
                            continue;
                        }
                        PttAction::DeferRelease => {
                            pending = Some(intent.clone());
                            continue;
                        }
                        PttAction::Passthrough => {}
                    }

                    if is_pressed {
                        if last_press.is_some_and(|then| clock - then < DEBOUNCE) {
                            continue;
                        }
                        last_press = Some(clock);
                    }

                    if is_pressed && stage == SimStage::Idle {
                        stage = SimStage::Recording;
                        starts += 1;
                    } else if !is_pressed && stage == SimStage::Recording {
                        stage = SimStage::Processing;
                        stops += 1;
                    }
                }
            }
        }

        SimResult {
            starts,
            stops,
            stage,
        }
    }

    fn autorepeat_burst() -> Vec<Ev> {
        let mut events = vec![Ev::Press];
        for _ in 0..6 {
            events.push(Ev::Release);
            events.push(Ev::Press);
        }
        events
    }

    #[test]
    fn x11_autorepeat_burst_does_not_toggle_recording() {
        let result = simulate(&autorepeat_burst());
        assert_eq!(result.starts, 1);
        assert_eq!(result.stops, 0);
        assert_eq!(result.stage, SimStage::Recording);
    }

    #[test]
    fn genuine_release_after_grace_stops_recording_once() {
        let mut events = autorepeat_burst();
        events.push(Ev::Release);
        events.push(Ev::Grace);
        let result = simulate(&events);
        assert_eq!(result.starts, 1);
        assert_eq!(result.stops, 1);
        assert_eq!(result.stage, SimStage::Processing);
    }
}
