//! The audio-device dimension: CoreAudio's
//! `kAudioDevicePropertyDeviceIsRunningSomewhere`, read on the default input
//! device for every path and on the default *output* device for the call path.
//!
//! Two properties of this signal shape everything above it, and both are
//! limitations rather than bugs to be engineered away:
//!
//! * **It is device-global, never per-process.** It answers "is some process
//!   holding the input device", so Sona's own dictation run and Sona's own
//!   meeting-capture microphone lane both raise it. The decision table therefore
//!   takes a separate `self_holds_input_device` input and refuses to read the
//!   device state as evidence about anyone else while Sona holds it. There is no
//!   public API that attributes input-device use to a process; pretending
//!   otherwise would mean guessing.
//! * **Bluetooth microphones under-report.** Community reports and Apple's own
//!   forums agree that Bluetooth inputs do not reliably raise this property, so
//!   the ad-hoc path has a known false negative on AirPods-style headsets. That
//!   degradation is silent by construction, which is why the calendar path exists
//!   and why manual start stays the primary entry point.
//!
//! Apple ships no descriptive prose for this constant, only the symbol. The
//! behavior relied on here — that the listener fires on the transition, not
//! continuously — is community-corroborated, not vendor-documented.
//!
//! The output device is watched through the same registration and the same
//! shared level rather than a second thread, because it answers the same
//! question about the same instant. It exists only for call apps: a live call
//! plays the other side out loud, which is a signal Sona's own capture does not
//! raise and a Bluetooth headset cannot swallow. What it cannot tell apart is a
//! call from music, so `machine::call_is_live` — not this module — decides what
//! the level means.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use super::machine::{MicSignal, OutputSignal};

/// The observed level of the devices detection watches, shared between whatever
/// watches them and whatever reads them.
///
/// This exists as its own value so the monitor and the decision loop can be
/// constructed in either order. The alternative — handing the monitor to the
/// runtime and the runtime's observer to the monitor — is a construction cycle,
/// and cycles get resolved with either a lock on the read path or a second
/// half-built object. Shared atomics are neither.
#[derive(Debug, Default)]
pub struct InputDeviceLevel {
    active: AtomicBool,
    output_active: AtomicBool,
}

impl InputDeviceLevel {
    /// Records a new level and reports the previous one, so a caller can tell a
    /// transition from a redundant notification without a second flag.
    pub fn set(&self, active: bool) -> bool {
        self.active.swap(active, Ordering::AcqRel)
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    /// The default output device's level, same contract as `set`.
    pub fn set_output(&self, active: bool) -> bool {
        self.output_active.swap(active, Ordering::AcqRel)
    }

    pub fn is_output_active(&self) -> bool {
        self.output_active.load(Ordering::Acquire)
    }
}

impl InputDeviceState for InputDeviceLevel {
    fn mic_signal(&self) -> MicSignal {
        if self.is_active() {
            MicSignal::Active
        } else {
            MicSignal::Idle
        }
    }

    fn output_signal(&self) -> OutputSignal {
        if self.is_output_active() {
            OutputSignal::Active
        } else {
            OutputSignal::Idle
        }
    }
}

/// Notified on every observed transition of the default input device.
pub trait InputDeviceObserver: Send + Sync {
    fn input_device_changed(&self, signal: MicSignal);

    /// Notified on every observed transition of the default output device.
    /// Carries no level: only the call path reads the output signal, and it
    /// reads it as a level off `InputDeviceState`, never as an edge.
    fn output_device_changed(&self);
}

/// The current device level, readable without waiting for a transition. The
/// decision table needs a level, not just an edge: a calendar event reaching its
/// start instant has to ask "is anybody talking" right then.
pub trait InputDeviceState: Send + Sync {
    fn mic_signal(&self) -> MicSignal;
    fn output_signal(&self) -> OutputSignal;
}

/// Reports the device as permanently idle. Used on non-macOS targets, where
/// detection has no microphone dimension at all.
pub struct UnavailableInputDevice;

impl InputDeviceState for UnavailableInputDevice {
    fn mic_signal(&self) -> MicSignal {
        MicSignal::Idle
    }

    fn output_signal(&self) -> OutputSignal {
        OutputSignal::Idle
    }
}

#[cfg(target_os = "macos")]
pub use macos::{CoreAudioInputMonitor, InputMonitorError};

#[cfg(target_os = "macos")]
mod macos {
    use super::{InputDeviceLevel, InputDeviceObserver, MicSignal};
    use objc2_core_audio::{
        kAudioDevicePropertyDeviceIsRunningSomewhere, kAudioHardwarePropertyDefaultInputDevice,
        kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyElementMain,
        kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject, AudioObjectAddPropertyListener,
        AudioObjectGetPropertyData, AudioObjectID, AudioObjectPropertyAddress,
        AudioObjectRemovePropertyListener,
    };
    use std::ffi::c_void;
    use std::ptr::NonNull;
    use std::sync::Arc;

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum InputMonitorError {
        /// No default input device, or CoreAudio refused the query.
        DeviceUnavailable,
        /// CoreAudio refused to register the property listener.
        ListenerUnavailable,
    }

    fn address(selector: u32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        }
    }

    fn read_u32(object_id: AudioObjectID, selector: u32) -> Option<u32> {
        let mut property = address(selector);
        let mut value: u32 = 0;
        let mut size = u32::try_from(std::mem::size_of::<u32>()).ok()?;
        // `size` states `value`'s exact byte length, as CoreAudio requires.
        // SAFETY: `property` and `value` are live stack slots for this call.
        let status = unsafe {
            AudioObjectGetPropertyData(
                object_id,
                NonNull::from(&mut property),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
                NonNull::from(&mut value).cast(),
            )
        };
        (status == 0).then_some(value)
    }

    fn default_input_device() -> Option<AudioObjectID> {
        let object_id = u32::try_from(kAudioObjectSystemObject).ok()?;
        let device = read_u32(object_id, kAudioHardwarePropertyDefaultInputDevice)?;
        // Zero is CoreAudio's "no device" sentinel, not a valid object.
        (device != 0).then_some(device)
    }

    fn default_output_device() -> Option<AudioObjectID> {
        let object_id = u32::try_from(kAudioObjectSystemObject).ok()?;
        let device = read_u32(object_id, kAudioHardwarePropertyDefaultOutputDevice)?;
        (device != 0).then_some(device)
    }

    /// Registers one `IsRunningSomewhere` listener on `device_id`, seeding
    /// nothing: the caller decides what a successful registration means for the
    /// level it shares.
    fn add_running_listener(
        device_id: AudioObjectID,
        listener: unsafe extern "C-unwind" fn(
            AudioObjectID,
            u32,
            NonNull<AudioObjectPropertyAddress>,
            *mut c_void,
        ) -> i32,
        state: *mut ListenerState,
    ) -> bool {
        let mut property = address(kAudioDevicePropertyDeviceIsRunningSomewhere);
        // `Drop` removes every listener before reclaiming the box.
        // SAFETY: `state` therefore outlives every callback that reads it.
        let status = unsafe {
            AudioObjectAddPropertyListener(
                device_id,
                NonNull::from(&mut property),
                Some(listener),
                state.cast::<c_void>(),
            )
        };
        status == 0
    }

    fn remove_running_listener(
        device_id: AudioObjectID,
        listener: unsafe extern "C-unwind" fn(
            AudioObjectID,
            u32,
            NonNull<AudioObjectPropertyAddress>,
            *mut c_void,
        ) -> i32,
        state: *mut ListenerState,
    ) {
        let mut property = address(kAudioDevicePropertyDeviceIsRunningSomewhere);
        // CoreAudio guarantees no further callbacks once this returns, which is
        // what makes reclaiming the box sound.
        // SAFETY: removes the same listener and context `start` registered.
        unsafe {
            AudioObjectRemovePropertyListener(
                device_id,
                NonNull::from(&mut property),
                Some(listener),
                state.cast::<c_void>(),
            );
        }
    }

    fn device_is_running(device_id: AudioObjectID) -> bool {
        read_u32(device_id, kAudioDevicePropertyDeviceIsRunningSomewhere)
            .is_some_and(|value| value != 0)
    }

    /// Handed to the CoreAudio callback as its client data. Boxed and held by the
    /// monitor, then reclaimed in `Drop` after the listener is removed —
    /// CoreAudio offers no completion callback, so the removal call returning is
    /// the only join point available.
    struct ListenerState {
        level: Arc<InputDeviceLevel>,
        observer: Arc<dyn InputDeviceObserver>,
    }

    /// Owns the `IsRunningSomewhere` listeners on the default input device and,
    /// when there is one, the default output device. Both listeners are
    /// per-device, so a user switching from the built-in microphone to a USB
    /// interface or from speakers to AirPods would silently stop the path that
    /// reads it; `device_changed` lets the caller notice and re-register.
    ///
    /// The output listener is optional and its absence is not an error: the
    /// call path degrades to the input signal, which is exactly what every
    /// non-call app already runs on.
    pub struct CoreAudioInputMonitor {
        state: *mut ListenerState,
        device_id: AudioObjectID,
        /// The default output device at registration time, whether or not its
        /// listener registered. `device_changed` compares against this, so a
        /// device whose listener CoreAudio refused reads as unchanged rather
        /// than as a fresh device on every poll.
        output_device_id: Option<AudioObjectID>,
        /// The output device whose listener did register, and so must be
        /// removed on drop.
        output_listener_device_id: Option<AudioObjectID>,
    }

    // SAFETY: `state` is only ever dereferenced through shared references to an
    // atomic and two `Arc`s, and it stays valid until `Drop` removes the listeners.
    unsafe impl Send for CoreAudioInputMonitor {}
    unsafe impl Sync for CoreAudioInputMonitor {}

    impl CoreAudioInputMonitor {
        /// Registers the listeners and seeds `level` with each device's current
        /// state, so the first decision does not have to wait for a transition.
        pub fn start(
            level: Arc<InputDeviceLevel>,
            observer: Arc<dyn InputDeviceObserver>,
        ) -> Result<Self, InputMonitorError> {
            let device_id = default_input_device().ok_or(InputMonitorError::DeviceUnavailable)?;
            level.set(device_is_running(device_id));
            // Cleared up front so a failed or absent output registration leaves
            // the call path reading "no output audio" rather than whatever the
            // last device reported before it went away.
            level.set_output(false);
            let shared_level = Arc::clone(&level);
            let state = Box::into_raw(Box::new(ListenerState { level, observer }));

            if !add_running_listener(device_id, input_running_listener, state) {
                // SAFETY: the listener was never registered, so nothing else can
                // hold this pointer.
                drop(unsafe { Box::from_raw(state) });
                return Err(InputMonitorError::ListenerUnavailable);
            }

            let output_device_id = default_output_device();
            let output_listener_device_id = output_device_id
                .filter(|device| add_running_listener(*device, output_running_listener, state));
            match output_listener_device_id {
                Some(output_device_id) => {
                    shared_level.set_output(device_is_running(output_device_id));
                }
                None => log::info!(
                    "Meeting detection has no output-device signal: call apps fall back to the \
                     microphone signal alone"
                ),
            }

            Ok(Self {
                state,
                device_id,
                output_device_id,
                output_listener_device_id,
            })
        }

        /// True when either default device is no longer the one this monitor is
        /// registered on. Polled rather than watched with a third listener: one
        /// owner for the "which device" question, and a device swap does not
        /// need sub-second latency.
        ///
        /// The output comparison includes appearing and disappearing, because
        /// an output device going away leaves a stale `Active` level that only
        /// re-registration clears.
        pub fn device_changed(&self) -> bool {
            default_input_device().is_some_and(|device_id| device_id != self.device_id)
                || default_output_device() != self.output_device_id
        }
    }

    impl Drop for CoreAudioInputMonitor {
        fn drop(&mut self) {
            remove_running_listener(self.device_id, input_running_listener, self.state);
            if let Some(output_device_id) = self.output_listener_device_id {
                remove_running_listener(output_device_id, output_running_listener, self.state);
            }
            // SAFETY: the listeners are gone, so this is the last live pointer.
            drop(unsafe { Box::from_raw(self.state) });
        }
    }

    /// Called on a CoreAudio-owned thread. Does the minimum: reads the property,
    /// records the level, and hands an edge to the observer. Anything expensive
    /// here would run on an audio-adjacent thread.
    unsafe extern "C-unwind" fn input_running_listener(
        object_id: AudioObjectID,
        _address_count: u32,
        _addresses: NonNull<AudioObjectPropertyAddress>,
        client_data: *mut c_void,
    ) -> i32 {
        if client_data.is_null() {
            return 0;
        }
        // `CoreAudioInputMonitor` removes the listener before reclaiming the box.
        // SAFETY: this pointer is therefore live for the whole callback.
        let state = unsafe { &*client_data.cast::<ListenerState>() };
        let active = device_is_running(object_id);
        if state.level.set(active) == active {
            return 0;
        }
        state.observer.input_device_changed(if active {
            MicSignal::Active
        } else {
            MicSignal::Idle
        });
        0
    }

    /// The output device's half. Same contract as the input listener, and the
    /// same thread discipline.
    unsafe extern "C-unwind" fn output_running_listener(
        object_id: AudioObjectID,
        _address_count: u32,
        _addresses: NonNull<AudioObjectPropertyAddress>,
        client_data: *mut c_void,
    ) -> i32 {
        if client_data.is_null() {
            return 0;
        }
        // SAFETY: as above — the box outlives every callback that reads it.
        let state = unsafe { &*client_data.cast::<ListenerState>() };
        let active = device_is_running(object_id);
        if state.level.set_output(active) == active {
            return 0;
        }
        state.observer.output_device_changed();
        0
    }
}

/// Tracks whether Sona itself is the process holding the input device, which the
/// decision table needs in order to discount its own microphone.
///
/// A counter rather than a flag, because it has two independent raisers: a
/// dictation run ending while a meeting capture is still recording must not
/// clear it.
#[derive(Debug, Default)]
pub struct SelfInputDeviceLease {
    holders: Mutex<usize>,
    held: AtomicBool,
}

impl SelfInputDeviceLease {
    pub fn acquire(&self) {
        let mut holders = self.lock();
        *holders = holders.saturating_add(1);
        self.held.store(true, Ordering::Release);
    }

    pub fn release(&self) {
        let mut holders = self.lock();
        *holders = holders.saturating_sub(1);
        self.held.store(*holders > 0, Ordering::Release);
    }

    pub fn is_held(&self) -> bool {
        self.held.load(Ordering::Acquire)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, usize> {
        self.holders
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// A lease held for as long as this guard lives.
pub struct SelfInputDeviceGuard {
    lease: Arc<SelfInputDeviceLease>,
}

impl SelfInputDeviceGuard {
    pub fn new(lease: Arc<SelfInputDeviceLease>) -> Self {
        lease.acquire();
        Self { lease }
    }
}

impl Drop for SelfInputDeviceGuard {
    fn drop(&mut self) {
        self.lease.release();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_idle_lease_is_not_held() {
        let lease = SelfInputDeviceLease::default();

        assert!(!lease.is_held());
    }

    #[test]
    fn overlapping_holders_keep_the_lease_raised() {
        let lease = Arc::new(SelfInputDeviceLease::default());
        let dictation = SelfInputDeviceGuard::new(Arc::clone(&lease));
        let capture = SelfInputDeviceGuard::new(Arc::clone(&lease));

        assert!(lease.is_held());
        drop(dictation);
        assert!(
            lease.is_held(),
            "a meeting capture still holds the microphone"
        );
        drop(capture);
        assert!(!lease.is_held());
    }

    #[test]
    fn a_level_reports_the_previous_state_so_edges_are_distinguishable() {
        let level = InputDeviceLevel::default();

        assert_eq!(level.mic_signal(), MicSignal::Idle);
        assert!(!level.set(true), "the first raise is a transition");
        assert_eq!(level.mic_signal(), MicSignal::Active);
        assert!(level.set(true), "a repeat notification is not a transition");
    }

    #[test]
    fn the_two_device_levels_are_independent() {
        let level = InputDeviceLevel::default();

        assert_eq!(level.output_signal(), OutputSignal::Idle);
        assert!(!level.set_output(true), "the first raise is a transition");
        assert_eq!(level.output_signal(), OutputSignal::Active);
        assert_eq!(
            level.mic_signal(),
            MicSignal::Idle,
            "a call playing out loud is not the microphone being held"
        );
    }

    #[test]
    fn an_unavailable_device_reports_idle() {
        assert_eq!(UnavailableInputDevice.mic_signal(), MicSignal::Idle);
        assert_eq!(UnavailableInputDevice.output_signal(), OutputSignal::Idle);
    }
}
