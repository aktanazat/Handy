#[cfg(not(target_os = "macos"))]
use std::sync::LazyLock;
#[cfg(not(target_os = "macos"))]
use std::time::Instant;

/// Reads the platform host monotonic clock used by native audio APIs. It is
/// persisted only as a session anchor; wall time remains display metadata.
pub fn host_monotonic_now_ns() -> u64 {
    #[cfg(target_os = "macos")]
    {
        // AudioGetCurrentHostTime and AudioConvertHostTimeToNanos share the
        // CoreAudio host-clock domain used by CPAL's macOS StreamInstant.
        // SAFETY: CoreAudio host-clock functions have no pointer or ownership preconditions.
        unsafe { AudioConvertHostTimeToNanos(AudioGetCurrentHostTime()) }
    }

    #[cfg(not(target_os = "macos"))]
    {
        static PROCESS_START: LazyLock<Instant> = LazyLock::new(Instant::now);
        let start = &*PROCESS_START;
        u64::try_from(start.elapsed().as_nanos()).unwrap_or(u64::MAX)
    }
}

#[cfg(target_os = "macos")]
#[link(name = "AudioToolbox", kind = "framework")]
unsafe extern "C" {
    fn AudioGetCurrentHostTime() -> u64;
    fn AudioConvertHostTimeToNanos(in_host_time: u64) -> u64;
}
