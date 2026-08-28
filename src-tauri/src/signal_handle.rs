use crate::modes::TranscriptionIntent;
use crate::TranscriptionCoordinator;
use log::{debug, warn};
#[cfg(target_os = "macos")]
use signal_hook::consts::SIGUSR1;
#[cfg(unix)]
use signal_hook::consts::SIGUSR2;
#[cfg(unix)]
use signal_hook::iterator::Signals;
#[cfg(unix)]
use std::thread;
use tauri::{AppHandle, Manager};

/// Used by signal handlers, CLI flags, and any other external trigger.
///
/// External sources express their run meaning directly. They never depend on a
/// persisted shortcut record that can be renamed or removed by schema migration.
pub fn send_transcription_intent(app: &AppHandle, intent: TranscriptionIntent, source: &str) {
    if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        coordinator.send_intent(intent, source);
    } else {
        warn!("TranscriptionCoordinator not initialized");
    }
}

#[cfg(unix)]
fn intent_for_signal(signal: i32) -> Option<(TranscriptionIntent, &'static str)> {
    match signal {
        #[cfg(target_os = "macos")]
        SIGUSR1 => Some((TranscriptionIntent::ActiveModeWithPostProcess, "SIGUSR1")),
        SIGUSR2 => Some((TranscriptionIntent::ActiveMode, "SIGUSR2")),
        _ => None,
    }
}

/// SIGUSR2 toggles the active mode on all Unix platforms. SIGUSR1 retains its
/// legacy macOS force-post-process behavior through a typed intent. Linux leaves
/// SIGUSR1 to WebKitGTK's garbage collector.
#[cfg(unix)]
fn registered_signals() -> Result<Signals, std::io::Error> {
    #[cfg(target_os = "macos")]
    {
        Signals::new([SIGUSR1, SIGUSR2])
    }
    #[cfg(not(target_os = "macos"))]
    {
        Signals::new([SIGUSR2])
    }
}

#[cfg(unix)]
pub fn setup_signal_handler(app_handle: AppHandle) {
    let mut signals = match registered_signals() {
        Ok(signals) => signals,
        Err(error) => {
            warn!("Failed to register transcription signal handlers: {error}");
            return;
        }
    };
    #[cfg(target_os = "macos")]
    debug!("Signal handlers registered (SIGUSR1, SIGUSR2)");
    #[cfg(not(target_os = "macos"))]
    debug!("Signal handler registered (SIGUSR2; SIGUSR1 is left to WebKitGTK)");
    thread::spawn(move || {
        for signal in signals.forever() {
            let Some((intent, signal_name)) = intent_for_signal(signal) else {
                continue;
            };
            debug!("Received {signal_name}");
            send_transcription_intent(&app_handle, intent, signal_name);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn sigusr2_targets_the_active_mode() {
        assert_eq!(
            intent_for_signal(SIGUSR2),
            Some((TranscriptionIntent::ActiveMode, "SIGUSR2"))
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sigusr1_preserves_force_post_process_without_a_shortcut_id() {
        assert_eq!(
            intent_for_signal(SIGUSR1),
            Some((TranscriptionIntent::ActiveModeWithPostProcess, "SIGUSR1"))
        );
    }
}
