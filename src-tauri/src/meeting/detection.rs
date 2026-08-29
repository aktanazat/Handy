//! Automatic meeting detection: signals in, one prompt decision out.
//!
//! # Layering
//!
//! | Layer | Owner | Invariant it owns |
//! |---|---|---|
//! | Signals | `apps`, `calendar`, `input_device` | What the platform actually reports, including what it cannot report |
//! | Decision | `machine` | Whether a prompt is warranted, and which one |
//! | Delivery | `notify` | How a prompt reaches the operator, and what a click means |
//! | Capture | `MeetingSessionManager` | Consent, the capture lease, and persistence |
//!
//! The runtime here is glue between those four and owns nothing else. In
//! particular it never starts a capture: the strongest thing an affirmative
//! click does is create a preflight and put the existing consent screen in
//! front of the operator, which is byte-for-byte the tray's own
//! `start_meeting_notes` path. `MeetingSessionManager::start` persists a
//! per-attempt consent receipt naming the microphone and system-audio
//! acknowledgements, and detection has no authority to forge one.
//!
//! # What it does not observe
//!
//! * **Per-process microphone use.** CoreAudio's device-in-use property is
//!   device-global. Sona's own dictation raises it, which is why
//!   `self_holds_input_device` exists and why an active Sona microphone
//!   suppresses the ad-hoc path outright.
//! * **Bluetooth microphones.** They under-report through that property, so
//!   AirPods-style headsets are a known false negative on the ad-hoc path.
//! * **Live voiced audio.** Meeting transcription runs after capture, so nothing
//!   publishes "someone spoke just now"; the §5.5 silence stop is therefore
//!   inapplicable rather than approximated. See `machine::StopInputs`.

pub mod apps;
pub mod calendar;
pub mod input_device;
pub mod machine;
pub mod notify;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::meeting::session::{MeetingSessionManager, MeetingTitleSetRequest};
use crate::meeting::types::{
    MeetingNavigationDestination, MeetingOperationId, MeetingPhase, MeetingSessionId,
    MeetingSessionSnapshot,
};
use crate::settings::AppSettings;

use apps::{RunningApp, RunningAppsSource};
use calendar::{CalendarAccess, CalendarSource};
use input_device::{InputDeviceLevel, InputDeviceObserver, InputDeviceState, SelfInputDeviceLease};
use machine::{
    evaluate, evaluate_stop, CalendarSignal, DetectionInputs, DetectionOutcome, DetectionPolicy,
    MicSignal, PromptKind, RecentCapture, ScreenRecordingPermission, StopInputs, StopPolicy,
    StopTrigger, SuppressReason,
};
use notify::{NotificationAccess, PromptPresenter, PromptResponder, PromptResponse};

/// Schema marker on both detection events, matching the meeting events' shape.
pub const DETECTION_EVENT_SCHEMA_VERSION: u32 = 1;

/// Tick interval. Chosen so the T-60s calendar prompt lands between T-60 and
/// T-45: tight enough to be useful, loose enough that the idle path costs a
/// settings read, an atomic load, and one in-process application list — and no
/// database read at all.
const TICK: Duration = Duration::from_secs(15);

/// A wall-clock jump this much larger than the monotonic clock's advance means
/// the host slept. Both clocks are read on the same tick, so the only source of
/// a gap this size is suspend.
const SLEEP_DETECTION_SLACK: Duration = Duration::from_secs(60);

/// Emitted when detection wants an answer. The frontend renders localized copy
/// from these fields; the native notification carries §5.4's English pattern.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DetectionPromptEvent {
    pub event_schema_version: u32,
    /// Opaque handle. Echo it back through `detection_prompt_respond`.
    pub prompt_id: String,
    pub prompt: PromptKind,
    /// §5.4's English copy, exactly as the notification shows it.
    pub notification_title: String,
    /// True when this prompt was also delivered as a native notification. False
    /// means notifications are denied or unavailable and the in-app card is the
    /// only surface.
    pub notified: bool,
}

/// The countdown half of §5.3 case 1.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DetectionCountdown {
    pub event_key: String,
    pub event_title: String,
    pub seconds_to_start: i64,
}

/// The operator-editable half of detection, read and written as one unit.
///
/// One value rather than six independent setters: these fields only make sense
/// together — turning the calendar path on while detection itself is off is not
/// a state the UI should be able to produce halfway through.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DetectionSettings {
    pub enabled: bool,
    pub calendar_enabled: bool,
    pub any_mic_activity: bool,
    pub auto_start_on_open_pane: bool,
    pub silence_stop_minutes: u32,
    pub meeting_apps: Vec<String>,
}

impl DetectionSettings {
    fn from_app_settings(settings: &AppSettings) -> Self {
        Self {
            enabled: settings.detection_enabled,
            calendar_enabled: settings.detection_calendar_enabled,
            any_mic_activity: settings.detection_any_mic_activity,
            auto_start_on_open_pane: settings.detection_auto_start_on_open_pane,
            silence_stop_minutes: settings.detection_silence_stop_minutes,
            meeting_apps: settings.detection_meeting_apps.clone(),
        }
    }
}

/// Everything the operator can see about what detection is doing. Emitted on
/// change, and readable on demand through `detection_status_get`.
///
/// This exists because silent detection is indistinguishable from broken
/// detection. Every suppression reason and every unavailable signal is named
/// here so the failure modes above are visible rather than inferred.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DetectionStatus {
    pub event_schema_version: u32,
    pub settings: DetectionSettings,
    pub calendar_access: CalendarAccess,
    pub notification_access: NotificationAccess,
    /// True when some process holds the default input device.
    pub input_device_active: bool,
    /// True when that process is Sona itself.
    pub sona_holds_input_device: bool,
    /// Why detection is quiet, when it is.
    pub suppress_reason: Option<SuppressReason>,
    pub countdown: Option<DetectionCountdown>,
    /// Allowlisted bundle IDs whose application is running right now. Empty is a
    /// legitimate answer and the settings UI shows it as such.
    pub running_meeting_apps: Vec<String>,
    /// Which auto-stop triggers can actually fire, given what is observable.
    pub available_stop_triggers: Vec<StopTrigger>,
    /// True when the Bluetooth-microphone false negative applies: nothing is
    /// reported as holding the input device while a meeting app is frontmost.
    pub input_device_reporting_suspect: bool,
}

/// A prompt awaiting an answer.
#[derive(Clone, Debug)]
struct PendingPrompt {
    prompt: PromptKind,
    /// Calendar event this prompt belongs to, for the auto-stop event-end rule.
    event_end_utc_ms: Option<i64>,
}

/// A capture detection started, and what stops it.
#[derive(Clone, Debug)]
struct TrackedCapture {
    session_id: MeetingSessionId,
    trigger_bundle_id: Option<String>,
    event_end_utc_ms: Option<i64>,
}

#[derive(Default)]
struct RuntimeState {
    pending: HashMap<String, PendingPrompt>,
    /// Calendar event keys already prompted for. Without this the 15s tick would
    /// re-notify for the same event every tick until it ended — the most likely
    /// new failure this subsystem introduces, and the cheapest to block.
    prompted_events: HashSet<String>,
    /// Bundle IDs already prompted for during the current input-device episode.
    /// Cleared when the device goes idle, so a second meeting in the same app
    /// prompts again.
    prompted_apps: HashSet<String>,
    /// Last emitted status, so the event fires on change rather than on a timer.
    last_status: Option<DetectionStatus>,
    tracked: Option<TrackedCapture>,
    recent: Option<RecentCapture>,
    /// Set when a tick observes a sleep boundary.
    slept: bool,
}

/// Wakes the tick thread early. The ad-hoc path must fire on the input-device
/// transition itself, not on the next scheduled tick.
#[derive(Default)]
struct Wakeup {
    flagged: Mutex<bool>,
    signal: Condvar,
}

impl Wakeup {
    fn wake(&self) {
        let mut flagged = self
            .flagged
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *flagged = true;
        self.signal.notify_all();
    }

    /// Waits up to `timeout` for a wake, then clears the flag.
    ///
    /// The pre-check is load-bearing, not an optimization: an input-device edge
    /// arriving while the loop is inside `tick` sets the flag with nobody
    /// waiting, and `Condvar::wait_timeout` does not consult a predicate. Without
    /// it, that edge is lost until the next scheduled tick — up to a full
    /// interval late for the one path §5.4 requires to be immediate.
    fn wait(&self, timeout: Duration) {
        let mut flagged = self
            .flagged
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *flagged {
            *flagged = false;
            return;
        }
        let (mut flagged, _) = self
            .signal
            .wait_timeout(flagged, timeout)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *flagged = false;
    }
}

/// Owns the detection loop and the platform observers it drives.
pub struct DetectionRuntime {
    app: AppHandle,
    meetings: Arc<MeetingSessionManager>,
    self_lease: Arc<SelfInputDeviceLease>,
    calendar: Arc<dyn CalendarSource>,
    running_apps: Arc<dyn RunningAppsSource>,
    input: Arc<dyn InputDeviceState>,
    prompts: Arc<dyn PromptPresenter>,
    state: Mutex<RuntimeState>,
    wakeup: Arc<Wakeup>,
    stop: Arc<AtomicBool>,
    /// Probes Screen Recording lazily, and caches the answer.
    ///
    /// A function rather than a value because the probe is a ScreenCaptureKit
    /// query and must not run during `setup`, alongside the rest of this
    /// module's platform work. Cached because the probe is far too heavy for a
    /// 15s tick and the answer cannot go stale within a run: macOS requires an
    /// app restart after the grant changes.
    screen_recording_probe: fn() -> ScreenRecordingPermission,
    screen_recording: OnceLock<ScreenRecordingPermission>,
}

impl DetectionRuntime {
    /// Assembles a runtime from explicit collaborators. The platform-backed
    /// wiring lives in `start`.
    ///
    /// The long argument list is the point: every platform dependency is named
    /// and substitutable, which is what lets the decision table be tested
    /// without a calendar, a microphone, or a notification center.
    #[allow(clippy::too_many_arguments)]
    pub fn with_parts(
        app: AppHandle,
        meetings: Arc<MeetingSessionManager>,
        self_lease: Arc<SelfInputDeviceLease>,
        calendar: Arc<dyn CalendarSource>,
        running_apps: Arc<dyn RunningAppsSource>,
        input: Arc<dyn InputDeviceState>,
        prompts: Arc<dyn PromptPresenter>,
        screen_recording_probe: fn() -> ScreenRecordingPermission,
    ) -> Self {
        Self {
            app,
            meetings,
            self_lease,
            calendar,
            running_apps,
            input,
            prompts,
            state: Mutex::new(RuntimeState::default()),
            wakeup: Arc::new(Wakeup::default()),
            stop: Arc::new(AtomicBool::new(false)),
            screen_recording_probe,
            screen_recording: OnceLock::new(),
        }
    }

    /// Starts the tick thread. Returns immediately; nothing here blocks startup,
    /// and nothing here touches a platform framework.
    ///
    /// `level` is handed over rather than read back off `self`, which stores it
    /// coerced to `Arc<dyn InputDeviceState>`: the CoreAudio monitor needs the
    /// concrete type, and a trait object cannot be downcast to it. The thread
    /// owns the monitor for exactly as long as the loop runs.
    pub fn spawn_loop(self: &Arc<Self>, level: Arc<InputDeviceLevel>) {
        let runtime = Arc::clone(self);
        thread::Builder::new()
            .name("sona-meeting-detection".to_string())
            .spawn(move || runtime.run(level))
            .map(|_| ())
            .unwrap_or_else(|error| {
                log::warn!("Meeting detection loop is unavailable: {error}");
            });
    }

    pub fn shutdown(&self) {
        self.stop.store(true, Ordering::Release);
        self.wakeup.wake();
    }

    pub fn self_lease(&self) -> Arc<SelfInputDeviceLease> {
        Arc::clone(&self.self_lease)
    }

    /// The observer handed to the CoreAudio monitor.
    pub fn input_observer(self: &Arc<Self>) -> Arc<dyn InputDeviceObserver> {
        Arc::new(WakeOnInputChange {
            wakeup: Arc::clone(&self.wakeup),
            state: Arc::clone(self),
        })
    }

    /// The responder handed to the notification presenter.
    pub fn prompt_responder(self: &Arc<Self>) -> Arc<dyn PromptResponder> {
        Arc::new(RuntimeResponder {
            runtime: Arc::clone(self),
        })
    }

    fn run(self: Arc<Self>, level: Arc<InputDeviceLevel>) {
        // Registered here, on this thread, before the first wait — not during
        // `setup`. Creating it instantiates the CoreAudio HAL client in-process
        // and opens a coreaudiod connection, which is the heaviest platform
        // work this slice does and the last of it to leave app launch.
        //
        // Before the first `wait` specifically: `start` seeds `level` with the
        // device's current state, so a meeting already under way at launch is
        // visible on the first tick instead of a full interval later.
        let mut monitor = self.start_input_monitor(&level);
        let mut previous_wall = utc_now_ms();
        let mut previous_monotonic = Instant::now();
        while !self.stop.load(Ordering::Acquire) {
            self.wakeup.wait(TICK);
            if self.stop.load(Ordering::Acquire) {
                return;
            }
            let wall = utc_now_ms();
            let monotonic = Instant::now();
            if slept_between(previous_wall, wall, previous_monotonic, monotonic) {
                self.lock().slept = true;
            }
            previous_wall = wall;
            previous_monotonic = monotonic;
            // The property listener is per-device, so switching from the
            // built-in microphone to a USB interface would silently end the
            // ad-hoc path. Re-registering on the new device is what keeps the
            // microphone dimension alive across a device change.
            self.refresh_input_monitor(&mut monitor, &level);
            self.tick(wall);
        }
    }

    /// Registers the CoreAudio listener, or reports why the microphone
    /// dimension is unavailable. A missing monitor degrades detection to the
    /// calendar path and manual start rather than failing the loop.
    #[cfg(target_os = "macos")]
    fn start_input_monitor(
        self: &Arc<Self>,
        level: &Arc<InputDeviceLevel>,
    ) -> Option<input_device::CoreAudioInputMonitor> {
        match input_device::CoreAudioInputMonitor::start(Arc::clone(level), self.input_observer()) {
            Ok(monitor) => Some(monitor),
            Err(error) => {
                log::warn!(
                    "Meeting detection has no microphone signal: {error:?}. The calendar path \
                     and manual start are unaffected."
                );
                None
            }
        }
    }

    /// Re-registers the listener when the default input device changed.
    ///
    /// Owned by the loop rather than by `app_handle.manage`, which is what held
    /// the monitor before: state managed by the app handle lives until process
    /// exit and its `Drop` may never run, so the listener was never removed.
    /// Thread-owned gives deterministic teardown on `shutdown`.
    #[cfg(target_os = "macos")]
    fn refresh_input_monitor(
        self: &Arc<Self>,
        monitor: &mut Option<input_device::CoreAudioInputMonitor>,
        level: &Arc<InputDeviceLevel>,
    ) {
        let changed = monitor
            .as_ref()
            .is_some_and(input_device::CoreAudioInputMonitor::device_changed);
        if !changed {
            return;
        }
        // Dropped before the replacement is created: `Drop` removes the listener
        // from the old device, and registering the new one first would briefly
        // leave two listeners writing the same level.
        *monitor = None;
        *monitor = self.start_input_monitor(level);
    }

    #[cfg(not(target_os = "macos"))]
    fn start_input_monitor(self: &Arc<Self>, _level: &Arc<InputDeviceLevel>) {}

    #[cfg(not(target_os = "macos"))]
    fn refresh_input_monitor(self: &Arc<Self>, _monitor: &mut (), _level: &Arc<InputDeviceLevel>) {}

    /// Screen Recording state, probed once on first use.
    fn screen_recording(&self) -> ScreenRecordingPermission {
        *self
            .screen_recording
            .get_or_init(self.screen_recording_probe)
    }

    fn tick(self: &Arc<Self>, now_utc_ms: i64) {
        let settings = crate::settings::get_settings(&self.app);
        let policy = policy_from_settings(&settings);
        let mic = self.input.mic_signal();
        let sona_holds = self.self_lease.is_held();

        // The calendar query only runs when the sub-toggle is on, so an operator
        // who never enabled it pays nothing and is never prompted for access.
        let calendar = if policy.enabled && policy.calendar_enabled {
            calendar::calendar_signal(
                self.calendar
                    .next_event(now_utc_ms, calendar::lookahead_ms()),
                now_utc_ms,
            )
        } else {
            CalendarSignal::Absent
        };

        let tracked = self.lock().tracked.clone();
        // Level 1 of the retreat path is meant literally: with the master
        // toggle off there is no calendar query, no application enumeration,
        // and no store read. The single exception is a capture detection itself
        // started — its stop triggers need to see whether the triggering app is
        // still alive, and dropping that would leave a capture running that
        // nothing is watching. `evaluate` short-circuits on `!enabled` before it
        // reads any signal, so an empty list here cannot change an outcome.
        let running = if policy.enabled || tracked.is_some() {
            self.running_apps.running_apps()
        } else {
            Vec::new()
        };
        let allowlist = apps::normalize_allowlist(&settings.detection_meeting_apps);
        let running_allowlisted = running
            .iter()
            .filter(|app| {
                allowlist
                    .iter()
                    .any(|bundle_id| bundle_id == &app.bundle_id)
            })
            .map(|app| app.bundle_id.clone())
            .collect::<Vec<_>>();

        // Nothing to decide: skip the store reads entirely — the capture
        // snapshot, the suggestion list, and the decision table. This is the
        // overwhelmingly common path, and it is the SQLCipher reads that cost
        // something, not the in-process application list.
        //
        // The application list is enumerated *before* this return on purpose.
        // `running_meeting_apps` is how the operator checks that a bundle ID
        // they typed is real; reporting an empty list here because detection
        // had nothing to decide would tell an operator with a meeting app open
        // and an idle microphone that their allowlist entry is dead. "I did not
        // look" is not "nothing is running", and this field is load-bearing
        // precisely on the idle path — as is
        // `input_device_reporting_suspect`, which is derived from it and was
        // therefore never able to fire here either.
        let inert = mic == MicSignal::Idle && calendar == CalendarSignal::Absent;
        if inert && tracked.is_none() {
            self.publish_status(&settings, mic, sona_holds, None, None, running_allowlisted);
            return;
        }

        // The tick thread's one entry into the async runtime, and detection's
        // only one. `active_capture` is `async`, so a caller that already runs
        // on the runtime — a notification click, a command — awaits it instead
        // of nesting a `block_on` and hanging the very path the operator asked
        // for. This thread is not a runtime thread, so blocking here is a plain
        // wait. One read serves both the stop evaluation and the decision
        // table, so the two cannot disagree about whether a capture is live.
        let active = tauri::async_runtime::block_on(self.active_capture());

        if let Some(tracked) = tracked {
            self.evaluate_running_capture(
                &settings,
                &tracked,
                active.as_ref(),
                &running,
                mic,
                sona_holds,
            );
        }

        let app_signal = apps::app_signal(&running, &allowlist);
        let browser_title = match &app_signal {
            machine::AppSignal::Browser { bundle_id, .. } => apps::browser_title_evidence(
                &self
                    .meetings
                    .suggestions_list(crate::meeting::clock::host_monotonic_now_ns()),
                bundle_id,
            ),
            _ => machine::BrowserTitleEvidence::NoMatch,
        };
        let (event_key, event_end_utc_ms) = match &calendar {
            CalendarSignal::Upcoming { event, .. } | CalendarSignal::Started { event } => {
                (Some(event.event_key.clone()), Some(event.end_utc_ms))
            }
            CalendarSignal::Absent => (None, None),
        };
        let pane_open = event_key
            .as_deref()
            .is_some_and(|event_key| self.countdown_shown_for(event_key));

        let inputs = DetectionInputs {
            now_utc_ms,
            calendar,
            app: app_signal,
            mic,
            screen_recording: self.screen_recording(),
            browser_title,
            pre_meeting_pane_open: pane_open,
            recent_capture: self.lock().recent.clone(),
            self_holds_input_device: sona_holds,
            capture_active: active.is_some(),
        };

        let outcome = evaluate(&inputs, &policy);
        let (suppress_reason, countdown) = self.apply(outcome, event_end_utc_ms, now_utc_ms);
        self.publish_status(
            &settings,
            mic,
            sona_holds,
            suppress_reason,
            countdown,
            running_allowlisted,
        );
    }

    /// Turns one outcome into the action it names. Returns what the status event
    /// should report.
    fn apply(
        self: &Arc<Self>,
        outcome: DetectionOutcome,
        event_end_utc_ms: Option<i64>,
        now_utc_ms: i64,
    ) -> (Option<SuppressReason>, Option<DetectionCountdown>) {
        match outcome {
            DetectionOutcome::Suppress(reason) => (Some(reason), None),
            DetectionOutcome::Countdown {
                event_key,
                event_title,
                seconds_to_start,
            } => (
                None,
                Some(DetectionCountdown {
                    event_key,
                    event_title,
                    seconds_to_start,
                }),
            ),
            DetectionOutcome::AutoStart {
                event_key,
                event_title,
            } => {
                // The carve-out skips the notification, not the consent screen.
                if self.claim_event(&event_key) {
                    // Spawned rather than awaited: `apply` runs on the tick
                    // thread, and the preflight is two store writes behind a
                    // lock. A tick that waited on them would delay the next
                    // microphone edge.
                    let runtime = Arc::clone(self);
                    let prompt = PromptKind::CalendarEvent {
                        event_key,
                        event_title,
                    };
                    tauri::async_runtime::spawn(async move {
                        runtime
                            .open_capture(&prompt, event_end_utc_ms, now_utc_ms)
                            .await;
                    });
                }
                (None, None)
            }
            DetectionOutcome::Prompt(prompt) => {
                if self.claim_prompt(&prompt) {
                    self.raise(prompt, event_end_utc_ms);
                }
                (None, None)
            }
            DetectionOutcome::CrossLink { session_id } => {
                log::info!(
                    "Meeting detection attached new activity to session {session_id} \
                     inside the cross-link window"
                );
                (None, None)
            }
        }
    }

    /// One prompt per calendar event, and one per app per input-device episode.
    /// A 15s tick without this becomes a notification storm.
    fn claim_prompt(&self, prompt: &PromptKind) -> bool {
        match prompt {
            PromptKind::CalendarEvent { event_key, .. } => self.claim_event(event_key),
            PromptKind::AppMeeting { bundle_id, .. }
            | PromptKind::AppHuddle { bundle_id, .. }
            | PromptKind::BrowserCall { bundle_id, .. } => {
                self.lock().prompted_apps.insert(bundle_id.clone())
            }
            PromptKind::UnknownMicSource => {
                self.lock().prompted_apps.insert("__unknown__".to_string())
            }
        }
    }

    fn claim_event(&self, event_key: &str) -> bool {
        self.lock().prompted_events.insert(event_key.to_string())
    }

    fn countdown_shown_for(&self, event_key: &str) -> bool {
        self.lock()
            .last_status
            .as_ref()
            .and_then(|status| status.countdown.as_ref())
            .is_some_and(|countdown| countdown.event_key == event_key)
    }

    fn raise(&self, prompt: PromptKind, event_end_utc_ms: Option<i64>) {
        let prompt_id = Uuid::new_v4().to_string();
        let notified = self.prompts.present(&prompt_id, &prompt);
        self.lock().pending.insert(
            prompt_id.clone(),
            PendingPrompt {
                prompt: prompt.clone(),
                event_end_utc_ms,
            },
        );
        let _ = self.app.emit(
            "detection-prompt",
            DetectionPromptEvent {
                event_schema_version: DETECTION_EVENT_SCHEMA_VERSION,
                prompt_id,
                notification_title: prompt.notification_title(),
                prompt,
                notified,
            },
        );
    }

    /// Resolves an answered prompt. Called from the notification delegate and
    /// from the in-app card, which must behave identically.
    pub fn respond(self: &Arc<Self>, prompt_id: &str, accepted: bool) {
        let Some(pending) = self.lock().pending.remove(prompt_id) else {
            return;
        };
        if !accepted {
            return;
        }
        let runtime = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            runtime
                .open_capture(&pending.prompt, pending.event_end_utc_ms, utc_now_ms())
                .await;
        });
    }

    /// The one place detection touches capture, and it touches only the entry
    /// point the tray already uses: create a preflight, name it, put the consent
    /// screen in front of the operator. `MeetingSessionManager::start` is never
    /// called from here.
    ///
    /// `async` rather than blocking: this is reached from a notification click,
    /// which lands on the async runtime. A `block_on` there would be a nested
    /// runtime entry — a hang on the one path the operator explicitly asked for.
    async fn open_capture(
        &self,
        prompt: &PromptKind,
        event_end_utc_ms: Option<i64>,
        now_utc_ms: i64,
    ) {
        let title = prompt.proposed_meeting_title();
        let trigger_bundle_id = prompt.bundle_id().map(str::to_string);
        // Re-read rather than trusting the tick's snapshot: an operator can take
        // a while to answer a notification, and opening a meeting for an app that
        // has since quit is a note nobody asked for.
        let trigger_running = trigger_bundle_id.as_deref().is_none_or(|bundle_id| {
            apps::is_app_running(&self.running_apps.running_apps(), bundle_id)
        });
        if !trigger_running {
            log::info!("Meeting detection dropped a prompt whose application had already quit");
            return;
        }
        let snapshot = match self.meetings.create_manual_preflight_from_tray().await {
            Ok(snapshot) => snapshot,
            Err(error) => {
                log::warn!("Meeting detection could not open a preflight: {error:?}");
                return;
            }
        };
        // A failed rename leaves the meeting under the tray's default title,
        // which is a cosmetic loss, not a reason to abandon the capture.
        let snapshot = match self
            .meetings
            .title_set(MeetingTitleSetRequest {
                operation_id: MeetingOperationId::new(),
                session_id: snapshot.session_id,
                expected_revision: snapshot.revision,
                title,
            })
            .await
        {
            Ok(result) => result.snapshot,
            Err(error) => {
                log::info!("Meeting detection kept the default meeting title: {error:?}");
                snapshot
            }
        };
        {
            let mut state = self.lock();
            state.tracked = Some(TrackedCapture {
                session_id: snapshot.session_id,
                trigger_bundle_id: trigger_bundle_id.clone(),
                event_end_utc_ms,
            });
            state.recent = Some(RecentCapture {
                session_id: snapshot.session_id.uuid().to_string(),
                trigger_bundle_id,
                started_utc_ms: now_utc_ms,
            });
        }
        crate::tray::set_meeting_tray_snapshot(&self.app, Some(&snapshot));
        crate::show_meeting_destination(
            &self.app,
            MeetingNavigationDestination::Preflight,
            Some(&snapshot),
        );
    }

    /// §5.5, for the capture detection opened. Manual stop stays primary: this
    /// only fires on the triggers the platform actually reports.
    fn evaluate_running_capture(
        &self,
        settings: &AppSettings,
        tracked: &TrackedCapture,
        active: Option<&MeetingSessionSnapshot>,
        running: &[RunningApp],
        mic: MicSignal,
        sona_holds: bool,
    ) {
        let Some(active) = active else {
            // The capture ended by some other route. Stop tracking it, but keep
            // `recent` so the cross-link and merge windows still apply.
            self.lock().tracked = None;
            return;
        };
        if active.session_id != tracked.session_id {
            self.lock().tracked = None;
            return;
        }
        let slept = self.lock().slept;
        let inputs = StopInputs {
            now_utc_ms: utc_now_ms(),
            linked_event_end_utc_ms: tracked.event_end_utc_ms,
            // No live voiced-activity clock exists in this codebase; see
            // `machine::StopInputs`. `None` keeps the silence rule inapplicable
            // rather than stopping a live meeting on a lookalike signal.
            last_voiced_utc_ms: None,
            self_holds_input_device: sona_holds,
            device_running_somewhere: mic == MicSignal::Active,
            trigger_app_running: tracked
                .trigger_bundle_id
                .as_deref()
                .is_none_or(|bundle_id| apps::is_app_running(running, bundle_id)),
            slept_since_start: slept,
        };
        let policy = StopPolicy {
            silence_stop_minutes: settings.detection_silence_stop_minutes,
        };
        let Some(trigger) = evaluate_stop(&inputs, &policy) else {
            return;
        };
        log::info!("Meeting detection is stopping capture on {trigger:?}");
        {
            let mut state = self.lock();
            state.tracked = None;
            state.slept = false;
        }
        let meetings = Arc::clone(&self.meetings);
        let request = crate::meeting::session::MeetingMutationRequest {
            operation_id: MeetingOperationId::new(),
            session_id: active.session_id,
            expected_revision: active.revision,
        };
        tauri::async_runtime::spawn(async move {
            if let Err(error) = meetings.stop(request).await {
                log::warn!("Meeting detection could not stop the capture: {error:?}");
            }
        });
    }

    /// The active capture, or `None`. Reads through the session manager because
    /// the capture lease is its invariant, not detection's.
    ///
    /// `async` on purpose: a sync wrapper around `block_on` is a landmine for
    /// the next caller that happens to be a notification click or a command,
    /// both of which already run on the async runtime. Nesting a runtime entry
    /// there deadlocks. The tick thread does the one permitted blocking read,
    /// at the boundary in `tick` that says so.
    async fn active_capture(&self) -> Option<MeetingSessionSnapshot> {
        self.meetings
            .tray_snapshot()
            .await
            .ok()
            .flatten()
            .filter(|snapshot| {
                matches!(
                    snapshot.phase,
                    MeetingPhase::CapturingRecording
                        | MeetingPhase::CapturingPausing
                        | MeetingPhase::CapturingPaused
                        | MeetingPhase::CapturingResuming
                )
            })
    }

    fn publish_status(
        &self,
        settings: &AppSettings,
        mic: MicSignal,
        sona_holds: bool,
        suppress_reason: Option<SuppressReason>,
        countdown: Option<DetectionCountdown>,
        running_meeting_apps: Vec<String>,
    ) {
        let input_device_active = mic == MicSignal::Active;
        // A meeting app is running and nothing claims the input device. That is
        // either nobody talking or the Bluetooth false negative; the operator
        // deserves to see which possibilities are live rather than assume
        // detection is broken.
        let input_device_reporting_suspect =
            !input_device_active && !running_meeting_apps.is_empty();
        let status = DetectionStatus {
            event_schema_version: DETECTION_EVENT_SCHEMA_VERSION,
            settings: DetectionSettings::from_app_settings(settings),
            calendar_access: self.calendar.access(),
            notification_access: self.prompts.access(),
            input_device_active,
            sona_holds_input_device: sona_holds,
            suppress_reason,
            countdown,
            running_meeting_apps,
            available_stop_triggers: available_stop_triggers(),
            input_device_reporting_suspect,
        };
        {
            let mut state = self.lock();
            if state.last_status.as_ref() == Some(&status) {
                return;
            }
            // An input-device episode ending clears the per-app prompt claims, so
            // the next meeting in the same app prompts again.
            if !input_device_active {
                state.prompted_apps.clear();
            }
            state.last_status = Some(status.clone());
        }
        let _ = self.app.emit("detection-status", status);
    }

    /// The status the frontend reads on mount, before any tick has fired.
    pub fn status(&self) -> DetectionStatus {
        let settings = crate::settings::get_settings(&self.app);
        self.lock()
            .last_status
            .clone()
            .unwrap_or_else(|| DetectionStatus {
                event_schema_version: DETECTION_EVENT_SCHEMA_VERSION,
                settings: DetectionSettings::from_app_settings(&settings),
                calendar_access: self.calendar.access(),
                notification_access: self.prompts.access(),
                input_device_active: self.input.mic_signal() == MicSignal::Active,
                sona_holds_input_device: self.self_lease.is_held(),
                suppress_reason: None,
                countdown: None,
                running_meeting_apps: Vec::new(),
                available_stop_triggers: available_stop_triggers(),
                input_device_reporting_suspect: false,
            })
    }

    /// Writes the operator's detection policy and returns the status it produces.
    ///
    /// The allowlist is normalized on the way in — lowercased, trimmed,
    /// deduplicated — because a typo in a settings-editable list is otherwise a
    /// silently dead entry.
    pub fn write_settings(&self, requested: DetectionSettings) -> DetectionStatus {
        crate::settings::update_settings(&self.app, |settings| {
            settings.detection_enabled = requested.enabled;
            settings.detection_calendar_enabled = requested.calendar_enabled;
            settings.detection_any_mic_activity = requested.any_mic_activity;
            settings.detection_auto_start_on_open_pane = requested.auto_start_on_open_pane;
            settings.detection_silence_stop_minutes = requested.silence_stop_minutes;
            settings.detection_meeting_apps = apps::normalize_allowlist(&requested.meeting_apps);
        });
        // Wake the loop so the next status reflects the write immediately rather
        // than at the end of the current interval.
        self.wakeup.wake();
        self.status()
    }

    /// Requests calendar full access. Only reached from the settings sub-toggle,
    /// never from the tick — the whole point of the lazy request.
    pub fn request_calendar_access(&self) -> CalendarAccess {
        let access = self.calendar.request_access();
        self.wakeup.wake();
        access
    }

    pub fn request_notification_access(&self) -> NotificationAccess {
        self.prompts.request_access()
    }

    /// Allowlisted bundle IDs whose application is running, so the settings UI
    /// can show an operator that an entry they typed is or is not real.
    pub fn running_meeting_apps(&self) -> Vec<String> {
        let settings = crate::settings::get_settings(&self.app);
        let allowlist = apps::normalize_allowlist(&settings.detection_meeting_apps);
        self.running_apps
            .running_apps()
            .into_iter()
            .filter(|app| {
                allowlist
                    .iter()
                    .any(|bundle_id| bundle_id == &app.bundle_id)
            })
            .map(|app| app.bundle_id)
            .collect()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, RuntimeState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The four §5.5 triggers whose evidence this build actually observes. `Silence`
/// is absent because nothing publishes live voiced activity; naming the gap here
/// is what keeps it from looking like a bug.
fn available_stop_triggers() -> Vec<StopTrigger> {
    vec![
        StopTrigger::SleepBoundary,
        StopTrigger::EventEnd,
        StopTrigger::TriggerAppExited,
        StopTrigger::InputDeviceIdle,
    ]
}

/// Reads the operator's settings into the decision table's policy. The timing
/// constants are fixed by the brief and are not settings.
pub fn policy_from_settings(settings: &AppSettings) -> DetectionPolicy {
    DetectionPolicy {
        enabled: settings.detection_enabled,
        calendar_enabled: settings.detection_calendar_enabled,
        any_mic_activity: settings.detection_any_mic_activity,
        auto_start_on_open_pane: settings.detection_auto_start_on_open_pane,
        lead_seconds: machine::CALENDAR_LEAD_SECONDS,
        attendee_floor: machine::ATTENDEE_FLOOR,
        cross_link_window_ms: machine::CROSS_LINK_WINDOW_MS,
    }
}

/// True when the wall clock advanced far more than the monotonic clock, which on
/// Apple platforms means the host suspended: `Instant` excludes sleep.
fn slept_between(
    previous_wall_ms: i64,
    wall_ms: i64,
    previous_monotonic: Instant,
    monotonic: Instant,
) -> bool {
    let wall_delta = wall_ms.saturating_sub(previous_wall_ms);
    if wall_delta <= 0 {
        return false;
    }
    let monotonic_delta = monotonic
        .saturating_duration_since(previous_monotonic)
        .as_millis();
    let Ok(monotonic_delta) = i64::try_from(monotonic_delta) else {
        return false;
    };
    let slack = i64::try_from(SLEEP_DETECTION_SLACK.as_millis()).unwrap_or(i64::MAX);
    wall_delta.saturating_sub(monotonic_delta) > slack
}

pub fn utc_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// Bridges the CoreAudio callback into the tick loop.
struct WakeOnInputChange {
    wakeup: Arc<Wakeup>,
    state: Arc<DetectionRuntime>,
}

impl InputDeviceObserver for WakeOnInputChange {
    fn input_device_changed(&self, signal: MicSignal) {
        if signal == MicSignal::Idle {
            // The episode is over: forget which apps were prompted for so the
            // next meeting in the same app is a fresh decision.
            self.state.lock().prompted_apps.clear();
        }
        self.wakeup.wake();
    }
}

/// Bridges a notification action click into the runtime.
struct RuntimeResponder {
    runtime: Arc<DetectionRuntime>,
}

impl PromptResponder for RuntimeResponder {
    fn prompt_answered(&self, response: PromptResponse) {
        match response {
            PromptResponse::Start { prompt_id } => self.runtime.respond(&prompt_id, true),
            PromptResponse::Dismiss { prompt_id } => self.runtime.respond(&prompt_id, false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_normal_tick_is_never_read_as_sleep() {
        let start = Instant::now();
        let slept = slept_between(1_000, 16_000, start, start + Duration::from_secs(15));

        assert!(!slept);
    }

    #[test]
    fn a_wall_clock_jump_the_monotonic_clock_did_not_see_is_sleep() {
        let start = Instant::now();
        // Ten minutes of wall time, fifteen seconds of uptime: the host suspended.
        let slept = slept_between(
            1_000,
            1_000 + 10 * 60_000,
            start,
            start + Duration::from_secs(15),
        );

        assert!(slept);
    }

    #[test]
    fn a_backwards_wall_clock_is_not_sleep() {
        let start = Instant::now();
        let slept = slept_between(60_000, 1_000, start, start + Duration::from_secs(15));

        assert!(!slept);
    }

    #[test]
    fn the_silence_trigger_is_not_advertised_as_available() {
        assert!(
            !available_stop_triggers().contains(&StopTrigger::Silence),
            "no live voiced-activity clock exists, so the operator must not be \
             told the silence stop will fire"
        );
    }

    #[test]
    fn an_early_wake_clears_the_flag_without_blocking_the_next_wait() {
        let wakeup = Wakeup::default();
        wakeup.wake();

        let started = Instant::now();
        wakeup.wait(Duration::from_secs(30));

        assert!(
            started.elapsed() < Duration::from_secs(5),
            "a flagged wakeup must return immediately"
        );
    }
}
