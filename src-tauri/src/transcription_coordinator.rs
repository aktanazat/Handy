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

/// A press that arrived while the pipeline was still processing the previous
/// transcription. Toggle-style triggers (signals, CLI flags, some pedals) flip
/// state on every edge, so dropping a busy press desyncs the parity: the next
/// edge then starts a recording nobody will ever stop.
struct PendingPress {
    intent: TranscriptionIntent,
    shortcut_label: String,
}

/// What to do with an input that arrives while the pipeline is busy.
/// `remembered` is whether a press for the same intent is already waiting for
/// the pipeline to drain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BusyAction {
    Ignore,
    /// Remember the press; start recording when the pipeline finishes.
    Remember,
    /// Cancel a previously remembered press. Toggle: two presses during one
    /// busy window net to no-op. Push-to-talk: the key is already back up, so
    /// the remembered press must not fire.
    Forget,
}

fn classify_busy_input(is_pressed: bool, push_to_talk: bool, remembered: bool) -> BusyAction {
    match (push_to_talk, is_pressed) {
        // Toggle: presses alternate remember/forget to preserve parity.
        (false, true) if remembered => BusyAction::Forget,
        (false, true) => BusyAction::Remember,
        // Toggle mode ignores releases.
        (false, false) => BusyAction::Ignore,
        // Push-to-talk: a press while busy means the key is being held, so
        // start as soon as the pipeline drains.
        (true, true) => BusyAction::Remember,
        (true, false) if remembered => BusyAction::Forget,
        (true, false) => BusyAction::Ignore,
    }
}

/// A keyboard, signal, or CLI edge for one transcription intent.
struct InputEvent {
    intent: TranscriptionIntent,
    shortcut_label: String,
    is_pressed: bool,
    push_to_talk: bool,
    /// Signals and CLI toggles rather than physical keys. They fire on every
    /// edge by design and must never be debounced: dropping one desyncs toggle
    /// parity and leaves recording wedged on.
    external: bool,
}

/// Commands processed sequentially by the coordinator thread.
enum Command {
    Input(InputEvent),
    Cancel { recording_was_active: bool },
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

/// A side effect decided by [`CoordinatorState`]. The coordinator thread is
/// the only executor, so every decision stays testable without an `AppHandle`.
enum Effect {
    Start {
        intent: TranscriptionIntent,
        shortcut_label: String,
    },
    Stop {
        intent: TranscriptionIntent,
        shortcut_label: String,
        run_plan: Box<RunPlan>,
    },
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

/// Pure lifecycle state machine: it owns every transition decision (push-to-talk
/// grace, debounce, busy-pipeline remember/forget, cancel, drain) and produces
/// [`Effect`]s instead of touching the app, so tests exercise the production
/// logic rather than a copy of it.
struct CoordinatorState {
    stage: Stage,
    last_press: Option<Instant>,
    pending_release: Option<PendingRelease>,
    pending_press: Option<PendingPress>,
}

impl CoordinatorState {
    fn new() -> Self {
        Self {
            stage: Stage::Idle,
            last_press: None,
            pending_release: None,
            pending_press: None,
        }
    }

    /// Deadline of the deferred release, if any. Drives `recv_timeout`.
    fn grace_deadline(&self) -> Option<Instant> {
        self.pending_release
            .as_ref()
            .map(|pending| pending.deadline)
    }

    fn on_input(&mut self, input: InputEvent, now: Instant) -> Option<Effect> {
        let pending_release_intent = self.pending_release.as_ref().map(|pending| &pending.intent);
        let recording_intent = match &self.stage {
            Stage::Recording { intent, .. } => Some(intent),
            _ => None,
        };

        match classify_ptt_event(
            pending_release_intent,
            input.is_pressed,
            input.push_to_talk,
            &input.intent,
            recording_intent,
        ) {
            PttAction::CancelRelease => {
                self.pending_release = None;
                return None;
            }
            PttAction::DeferRelease => {
                self.pending_release = Some(PendingRelease {
                    intent: input.intent,
                    shortcut_label: input.shortcut_label,
                    deadline: now + RELEASE_GRACE,
                });
                return None;
            }
            PttAction::Passthrough => {}
        }

        // Debounce rapid-fire press events (key repeat / double-tap).
        // Push-to-talk releases may be deferred above to absorb X11 auto-repeat.
        // External triggers are exempt: each one is a deliberate edge from the
        // user's own integration, and dropping it desyncs toggle parity.
        if input.is_pressed && !input.external {
            if self
                .last_press
                .is_some_and(|then| now.duration_since(then) < DEBOUNCE)
            {
                debug!("Debounced transcription intent: {:?}", input.intent);
                return None;
            }
            self.last_press = Some(now);
        }

        if matches!(self.stage, Stage::Processing) {
            self.remember_or_forget(input);
            return None;
        }

        let recording_this_intent =
            matches!(&self.stage, Stage::Recording { intent, .. } if intent == &input.intent);

        if input.push_to_talk {
            if input.is_pressed {
                if matches!(self.stage, Stage::Idle) {
                    return Some(Effect::Start {
                        intent: input.intent,
                        shortcut_label: input.shortcut_label,
                    });
                }
            } else if recording_this_intent {
                return self.stop_recording(&input.intent, input.shortcut_label);
            }
        } else if input.is_pressed {
            if matches!(self.stage, Stage::Idle) {
                return Some(Effect::Start {
                    intent: input.intent,
                    shortcut_label: input.shortcut_label,
                });
            }
            if recording_this_intent {
                return self.stop_recording(&input.intent, input.shortcut_label);
            }
            debug!(
                "Ignoring transcription intent {:?}: another intent is recording",
                input.intent
            );
        }
        None
    }

    /// A busy pipeline cannot change lifecycle now, so classify the input
    /// against any already-remembered press instead of dropping it silently.
    fn remember_or_forget(&mut self, input: InputEvent) {
        // Only one press can be remembered. Once an intent has claimed it,
        // inputs for a different intent are ignored, the same rule as a
        // different intent pressed while recording, rather than replacing the
        // remembered press and breaking its parity.
        if let Some(pending) = &self.pending_press {
            if pending.intent != input.intent {
                debug!(
                    "Ignoring transcription intent {:?}: {:?} is already pending",
                    input.intent, pending.intent
                );
                return;
            }
        }

        match classify_busy_input(
            input.is_pressed,
            input.push_to_talk,
            self.pending_press.is_some(),
        ) {
            BusyAction::Remember => {
                debug!("Remembering press for {:?}: pipeline busy", input.intent);
                self.pending_press = Some(PendingPress {
                    intent: input.intent,
                    shortcut_label: input.shortcut_label,
                });
            }
            BusyAction::Forget => {
                debug!("Forgetting remembered press for {:?}", input.intent);
                self.pending_press = None;
            }
            BusyAction::Ignore => {
                debug!(
                    "Ignoring transcription intent {:?}: pipeline busy",
                    input.intent
                )
            }
        }
    }

    /// The `RELEASE_GRACE` window elapsed with no cancelling press: fire the
    /// deferred release if that intent is still the one recording.
    fn on_grace_expired(&mut self) -> Option<Effect> {
        let pending = self.pending_release.take()?;
        self.stop_recording(&pending.intent, pending.shortcut_label)
    }

    fn on_cancel(&mut self, recording_was_active: bool) {
        self.pending_release = None;
        // An explicit cancel abandons a remembered start too: the user asked
        // for silence, not for a deferred recording.
        self.pending_press = None;
        // Don't reset during processing — wait for the pipeline to finish.
        if !matches!(self.stage, Stage::Processing)
            && (recording_was_active || matches!(self.stage, Stage::Recording { .. }))
        {
            self.stage = Stage::Idle;
        }
    }

    fn on_processing_finished(&mut self) -> Option<Effect> {
        self.stage = Stage::Idle;
        let pending = self.pending_press.take()?;
        debug!(
            "Pipeline drained; starting the press remembered for {:?}",
            pending.intent
        );
        Some(Effect::Start {
            intent: pending.intent,
            shortcut_label: pending.shortcut_label,
        })
    }

    /// Reconcile with the executor: recording began only if it produced a plan.
    fn on_started(&mut self, intent: TranscriptionIntent, run_plan: Option<Box<RunPlan>>) {
        if let Some(run_plan) = run_plan {
            self.stage = Stage::Recording { intent, run_plan };
        }
    }

    /// Hand the active recording's plan to the executor. Returns None when
    /// `intent` is not the intent currently recording.
    fn stop_recording(
        &mut self,
        intent: &TranscriptionIntent,
        shortcut_label: String,
    ) -> Option<Effect> {
        if !matches!(&self.stage, Stage::Recording { intent: active, .. } if active == intent) {
            return None;
        }
        match std::mem::replace(&mut self.stage, Stage::Processing) {
            Stage::Recording { intent, run_plan } => Some(Effect::Stop {
                intent,
                shortcut_label,
                run_plan,
            }),
            other => {
                self.stage = other;
                None
            }
        }
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
                let mut state = CoordinatorState::new();

                loop {
                    let cmd = match state.grace_deadline() {
                        Some(deadline) => {
                            match rx
                                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                            {
                                Ok(cmd) => cmd,
                                Err(mpsc::RecvTimeoutError::Timeout) => {
                                    if let Some(effect) = state.on_grace_expired() {
                                        execute(&app, &mut state, effect);
                                    }
                                    continue;
                                }
                                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                            }
                        }
                        None => match rx.recv() {
                            Ok(cmd) => cmd,
                            Err(_) => break,
                        },
                    };

                    let effect = match cmd {
                        Command::Input(input) => state.on_input(input, Instant::now()),
                        Command::Cancel {
                            recording_was_active,
                        } => {
                            state.on_cancel(recording_was_active);
                            None
                        }
                        Command::ProcessingFinished => state.on_processing_finished(),
                    };

                    if let Some(effect) = effect {
                        execute(&app, &mut state, effect);
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
        self.send(InputEvent {
            intent,
            shortcut_label: shortcut_label.to_string(),
            is_pressed,
            push_to_talk,
            external: false,
        });
    }

    /// Signals, the tray, and CLI toggles are semantic inputs, not hidden
    /// shortcut IDs. They arrive already debounced by whatever produced them,
    /// and each edge flips the toggle, so none of them may be dropped.
    pub fn send_intent(&self, intent: TranscriptionIntent, source: &str) {
        self.send(InputEvent {
            intent,
            shortcut_label: source.to_string(),
            is_pressed: true,
            push_to_talk: false,
            external: true,
        });
    }

    fn send(&self, input: InputEvent) {
        if self.tx.send(Command::Input(input)).is_err() {
            warn!("Transcription coordinator channel closed");
        }
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

/// Run one decision from [`CoordinatorState`] and report a start back, so the
/// machine only ever holds a recording the microphone actually opened.
fn execute(app: &AppHandle, state: &mut CoordinatorState, effect: Effect) {
    match effect {
        Effect::Start {
            intent,
            shortcut_label,
        } => {
            let run_plan = start(app, &intent, &shortcut_label);
            state.on_started(intent, run_plan);
        }
        Effect::Stop {
            intent,
            shortcut_label,
            run_plan,
        } => {
            actions::stop_transcription(app, &intent.recording_id(), &shortcut_label, *run_plan);
        }
    }
}

/// Begin recording for `intent`. Returns the plan it started with, or None
/// when no plan could be built or the microphone never opened.
fn start(
    app: &AppHandle,
    intent: &TranscriptionIntent,
    shortcut_label: &str,
) -> Option<Box<RunPlan>> {
    let settings = crate::settings::get_settings(app);
    let run_plan = match RunPlan::for_intent(&settings, intent) {
        Ok(plan) => plan,
        Err(error) => {
            warn!("Could not build run plan for {intent:?}: {error}");
            return None;
        }
    };
    let recording_id = intent.recording_id();
    actions::start_transcription(app, &recording_id, shortcut_label, &run_plan);
    if app
        .try_state::<Arc<AudioRecordingManager>>()
        .is_some_and(|manager| manager.is_recording())
    {
        Some(Box::new(run_plan))
    } else {
        debug!("Start for {intent:?} did not begin recording; staying idle");
        None
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

    /// Drives the production state machine. The executor is stubbed by
    /// `started`: `Effect::Start` becomes a recording with a real run plan
    /// unless the test says the microphone refused.
    struct Harness {
        state: CoordinatorState,
        clock: Instant,
        starts: u32,
        stops: u32,
        microphone_opens: bool,
    }

    impl Harness {
        fn new() -> Self {
            Self {
                state: CoordinatorState::new(),
                clock: Instant::now(),
                starts: 0,
                stops: 0,
                microphone_opens: true,
            }
        }

        fn run_plan() -> Box<RunPlan> {
            let settings = crate::settings::get_default_settings();
            Box::new(
                RunPlan::for_intent(&settings, &TranscriptionIntent::ActiveMode)
                    .expect("default settings always resolve the active mode"),
            )
        }

        fn apply(&mut self, effect: Option<Effect>) {
            match effect {
                Some(Effect::Start { intent, .. }) => {
                    self.starts += 1;
                    let plan = self.microphone_opens.then(Self::run_plan);
                    self.state.on_started(intent, plan);
                }
                Some(Effect::Stop { .. }) => self.stops += 1,
                None => {}
            }
        }

        fn input(&mut self, intent: TranscriptionIntent, is_pressed: bool, push_to_talk: bool) {
            self.advance(Duration::from_millis(5));
            let effect = self.state.on_input(
                InputEvent {
                    intent,
                    shortcut_label: "test".to_string(),
                    is_pressed,
                    push_to_talk,
                    external: false,
                },
                self.clock,
            );
            self.apply(effect);
        }

        fn external_press(&mut self, intent: TranscriptionIntent) {
            self.advance(Duration::from_millis(5));
            let effect = self.state.on_input(
                InputEvent {
                    intent,
                    shortcut_label: "signal".to_string(),
                    is_pressed: true,
                    push_to_talk: false,
                    external: true,
                },
                self.clock,
            );
            self.apply(effect);
        }

        fn grace_expired(&mut self) {
            let effect = self.state.on_grace_expired();
            self.apply(effect);
        }

        fn processing_finished(&mut self) {
            let effect = self.state.on_processing_finished();
            self.apply(effect);
        }

        fn advance(&mut self, by: Duration) {
            self.clock += by;
        }

        fn is_recording(&self) -> bool {
            matches!(self.state.stage, Stage::Recording { .. })
        }

        fn is_processing(&self) -> bool {
            matches!(self.state.stage, Stage::Processing)
        }

        fn is_idle(&self) -> bool {
            matches!(self.state.stage, Stage::Idle)
        }
    }

    fn press_and_hold(harness: &mut Harness) {
        harness.input(active_mode(), true, true);
    }

    /// X11 auto-repeat delivers release/press pairs while the key is held.
    fn autorepeat_burst(harness: &mut Harness) {
        press_and_hold(harness);
        for _ in 0..6 {
            harness.input(active_mode(), false, true);
            harness.input(active_mode(), true, true);
        }
    }

    #[test]
    fn x11_autorepeat_burst_does_not_toggle_recording() {
        let mut harness = Harness::new();
        autorepeat_burst(&mut harness);
        assert_eq!((harness.starts, harness.stops), (1, 0));
        assert!(harness.is_recording());
    }

    #[test]
    fn genuine_release_after_grace_stops_recording_once() {
        let mut harness = Harness::new();
        autorepeat_burst(&mut harness);
        harness.input(active_mode(), false, true);
        harness.grace_expired();
        assert_eq!((harness.starts, harness.stops), (1, 1));
        assert!(harness.is_processing());
    }

    #[test]
    fn a_failed_start_leaves_the_machine_idle() {
        let mut harness = Harness::new();
        harness.microphone_opens = false;
        harness.input(active_mode(), true, false);
        assert_eq!(harness.starts, 1);
        assert!(
            harness.is_idle(),
            "a start that never recorded must not arm a stop"
        );
    }

    #[test]
    fn busy_toggle_press_is_remembered_and_starts_when_the_pipeline_drains() {
        let mut harness = Harness::new();
        harness.input(active_mode(), true, false);
        harness.advance(DEBOUNCE);
        harness.input(active_mode(), true, false);
        assert!(harness.is_processing());

        // The press that lands mid-pipeline is the user's next recording.
        harness.advance(DEBOUNCE);
        harness.input(active_mode(), true, false);
        assert_eq!(
            harness.starts, 1,
            "nothing starts while the pipeline is busy"
        );

        harness.processing_finished();
        assert_eq!(harness.starts, 2);
        assert!(harness.is_recording());
    }

    #[test]
    fn two_busy_toggle_presses_cancel_out() {
        let mut harness = Harness::new();
        harness.input(active_mode(), true, false);
        harness.advance(DEBOUNCE);
        harness.input(active_mode(), true, false);

        harness.advance(DEBOUNCE);
        harness.input(active_mode(), true, false);
        harness.advance(DEBOUNCE);
        harness.input(active_mode(), true, false);

        harness.processing_finished();
        assert_eq!(
            harness.starts, 1,
            "an even number of busy presses is a no-op"
        );
        assert!(harness.is_idle());
    }

    #[test]
    fn a_push_to_talk_release_during_the_busy_window_forgets_the_press() {
        let mut harness = Harness::new();
        press_and_hold(&mut harness);
        harness.input(active_mode(), false, true);
        harness.grace_expired();
        assert!(harness.is_processing());

        // The user tapped again while the pipeline was busy, then let go before
        // it drained: the tap is over, so nothing should start.
        harness.advance(DEBOUNCE);
        harness.input(active_mode(), true, true);
        harness.input(active_mode(), false, true);

        harness.processing_finished();
        assert_eq!(harness.starts, 1);
        assert!(harness.is_idle());
    }

    #[test]
    fn a_second_intent_never_steals_a_pending_busy_press() {
        let mut harness = Harness::new();
        harness.input(active_mode(), true, false);
        harness.advance(DEBOUNCE);
        harness.input(active_mode(), true, false);

        harness.advance(DEBOUNCE);
        harness.input(active_mode(), true, false);
        harness.advance(DEBOUNCE);
        harness.input(TranscriptionIntent::ActiveModeWithPostProcess, true, false);

        harness.processing_finished();
        assert_eq!(harness.starts, 2);
        assert!(matches!(
            &harness.state.stage,
            Stage::Recording { intent, .. } if intent == &active_mode()
        ));
    }

    #[test]
    fn cancel_drops_a_remembered_press() {
        let mut harness = Harness::new();
        harness.input(active_mode(), true, false);
        harness.advance(DEBOUNCE);
        harness.input(active_mode(), true, false);
        harness.advance(DEBOUNCE);
        harness.input(active_mode(), true, false);

        harness.state.on_cancel(false);
        harness.processing_finished();
        assert_eq!(
            harness.starts, 1,
            "cancel means silence, not a deferred start"
        );
        assert!(harness.is_idle());
    }

    #[test]
    fn external_toggles_keep_parity_inside_the_debounce_window() {
        let mut harness = Harness::new();
        harness.external_press(active_mode());
        assert!(harness.is_recording());

        // 5 ms later, well inside DEBOUNCE: a keyboard repeat would be dropped,
        // but a signal or CLI edge is deliberate and must still toggle.
        harness.external_press(active_mode());
        assert_eq!((harness.starts, harness.stops), (1, 1));
        assert!(harness.is_processing());
    }

    #[test]
    fn keyboard_presses_inside_the_debounce_window_are_dropped() {
        let mut harness = Harness::new();
        harness.input(active_mode(), true, false);
        harness.input(active_mode(), true, false);
        assert_eq!((harness.starts, harness.stops), (1, 0));
        assert!(harness.is_recording());
    }

    #[test]
    fn busy_classification_covers_every_edge() {
        // Toggle: alternate remember/forget, ignore releases.
        assert_eq!(
            classify_busy_input(true, false, false),
            BusyAction::Remember
        );
        assert_eq!(classify_busy_input(true, false, true), BusyAction::Forget);
        assert_eq!(classify_busy_input(false, false, false), BusyAction::Ignore);
        assert_eq!(classify_busy_input(false, false, true), BusyAction::Ignore);
        // Push-to-talk: a held key starts on drain, a release cancels it.
        assert_eq!(classify_busy_input(true, true, false), BusyAction::Remember);
        assert_eq!(classify_busy_input(true, true, true), BusyAction::Remember);
        assert_eq!(classify_busy_input(false, true, true), BusyAction::Forget);
        assert_eq!(classify_busy_input(false, true, false), BusyAction::Ignore);
    }
}
