use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub const FIRST_DOM_PAINT_EVENT: &str = "launch:first-dom-paint";
pub const FIRST_VISIBLE_FRAME_EVENT: &str = "launch:first-visible-frame";
pub const SHELL_VISIBLE_EVENT: &str = "launch:shell-visible";
pub const BACKEND_READY_EVENT: &str = "launch:backend-ready";

struct LaunchClock {
    started: Instant,
    started_epoch_ms: f64,
}

static CLOCK: OnceLock<LaunchClock> = OnceLock::new();
static NATIVE_WINDOW_CREATED: AtomicBool = AtomicBool::new(false);
static WEBVIEW_NAVIGATION_STARTED: AtomicBool = AtomicBool::new(false);
static FIRST_DOM_PAINT: AtomicBool = AtomicBool::new(false);
static FIRST_VISIBLE_FRAME: AtomicBool = AtomicBool::new(false);
static WINDOW_FOCUS: AtomicBool = AtomicBool::new(false);
static WINDOW_PROMOTION: AtomicBool = AtomicBool::new(false);
static SHELL_SHOWN: AtomicBool = AtomicBool::new(false);
static KEYRING: AtomicU8 = AtomicU8::new(0);
static UPDATE_CHECK: AtomicU8 = AtomicU8::new(0);

pub fn start() {
    let _ = CLOCK.set(LaunchClock {
        started: Instant::now(),
        started_epoch_ms: epoch_ms(),
    });
}

pub fn span(name: &'static str) -> LaunchSpan {
    LaunchSpan::new(name, None)
}

pub fn keyring_span() -> LaunchSpan {
    LaunchSpan::new("keyring", Some(&KEYRING))
}

pub fn update_check_span() -> LaunchSpan {
    LaunchSpan::new("update_check", Some(&UPDATE_CHECK))
}

pub fn mark_native_window_created() {
    mark_point(
        "native_window_created",
        &NATIVE_WINDOW_CREATED,
        elapsed_ms(),
    );
}

pub fn mark_webview_navigation_started() {
    mark_point(
        "webview_navigation_start",
        &WEBVIEW_NAVIGATION_STARTED,
        elapsed_ms(),
    );
}

pub fn mark_first_dom_paint(epoch_ms: f64) {
    mark_webview_point("first_dom_paint", &FIRST_DOM_PAINT, epoch_ms);
}

pub fn mark_first_visible_frame(epoch_ms: f64) {
    mark_webview_point("first_visible_frame", &FIRST_VISIBLE_FRAME, epoch_ms);
}

pub fn mark_window_focus() {
    mark_point("window_focus", &WINDOW_FOCUS, elapsed_ms());
}

pub fn mark_window_promotion() {
    mark_point("window_promotion", &WINDOW_PROMOTION, elapsed_ms());
}

pub fn mark_shell_shown() {
    SHELL_SHOWN.store(true, Ordering::Release);
}

pub fn shell_shown() -> bool {
    SHELL_SHOWN.load(Ordering::Acquire)
}

pub fn first_visible_frame_recorded() -> bool {
    FIRST_VISIBLE_FRAME.load(Ordering::Acquire)
}

fn mark_webview_point(name: &'static str, once: &'static AtomicBool, epoch_ms: f64) {
    let Some(clock) = CLOCK.get() else {
        return;
    };
    mark_point(name, once, (epoch_ms - clock.started_epoch_ms).max(0.0));
}

fn mark_point(name: &'static str, once: &'static AtomicBool, end_ms: f64) {
    if CLOCK.get().is_none() || once.swap(true, Ordering::AcqRel) {
        return;
    }
    log_span(name, 0.0, end_ms);
}

fn elapsed_ms() -> f64 {
    CLOCK
        .get()
        .map(|clock| clock.started.elapsed().as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn epoch_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
        * 1000.0
}

fn log_span(name: &'static str, start_ms: f64, end_ms: f64) {
    log::info!(
        target: "sona::launch",
        "launch_span name={name} start_ms={start_ms:.3} end_ms={end_ms:.3} duration_ms={:.3}",
        end_ms - start_ms,
    );
}

pub struct LaunchSpan {
    name: &'static str,
    started: Option<(Instant, f64)>,
    once: Option<&'static AtomicU8>,
}

impl LaunchSpan {
    fn new(name: &'static str, once: Option<&'static AtomicU8>) -> Self {
        let enabled = CLOCK.get().is_some()
            && once.is_none_or(|state| {
                state
                    .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
            });
        Self {
            name,
            started: enabled.then(|| (Instant::now(), elapsed_ms())),
            once,
        }
    }
}

impl Drop for LaunchSpan {
    fn drop(&mut self) {
        let Some((started, start_ms)) = self.started else {
            return;
        };
        log_span(
            self.name,
            start_ms,
            start_ms + started.elapsed().as_secs_f64() * 1000.0,
        );
        if let Some(state) = self.once {
            state.store(2, Ordering::Release);
        }
    }
}
