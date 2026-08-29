//! The microphone dimension: CoreAudio's `kAudioDevicePropertyDeviceIsRunningSomewhere`
//! on the default input device.
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

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use super::machine::MicSignal;

/// The observed level of the default input device, shared between whatever
/// watches the device and whatever reads it.
///
/// This exists as its own value so the monitor and the decision loop can be
/// constructed in either order. The alternative — handing the monitor to the
/// runtime and the runtime's observer to the monitor — is a construction cycle,
/// and cycles get resolved with either a lock on the read path or a second
/// half-built object. A shared atomic is neither.
#[derive(Debug, Default)]
pub struct InputDeviceLevel {
    active: AtomicBool,
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
}

impl InputDeviceState for InputDeviceLevel {
    fn mic_signal(&self) -> MicSignal {
        if self.is_active() {
            MicSignal::Active
        } else {
            MicSignal::Idle
        }
    }
}

/// Notified on every observed transition of the default input device.
pub trait InputDeviceObserver: Send + Sync {
    fn input_device_changed(&self, signal: MicSignal);
}

/// The current device level, readable without waiting for a transition. The
/// decision table needs a level, not just an edge: a calendar event reaching its
/// start instant has to ask "is anybody talking" right then.
pub trait InputDeviceState: Send + Sync {
    fn mic_signal(&self) -> MicSignal;
}

/// Reports the device as permanently idle. Used on non-macOS targets, where
/// detection has no microphone dimension at all.
pub struct UnavailableInputDevice;

impl InputDeviceState for UnavailableInputDevice {
    fn mic_signal(&self) -> MicSignal {
        MicSignal::Idle
    }
}

#[cfg(target_os = "macos")]
pub use macos::{CoreAudioInputMonitor, InputMonitorError};

#[cfg(target_os = "macos")]
mod macos {
    use super::{InputDeviceLevel, InputDeviceObserver, MicSignal};
    use objc2_core_audio::{
        kAudioDevicePropertyDeviceIsRunningSomewhere, kAudioHardwarePropertyDefaultInputDevice,
        kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
        AudioObjectAddPropertyListener, AudioObjectGetPropertyData, AudioObjectID,
        AudioObjectPropertyAddress, AudioObjectRemovePropertyListener,
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
        // SAFETY: `property` and `value` are live stack slots for this call, and
        // `size` states `value`'s exact byte length as CoreAudio requires.
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

    /// Handed to the CoreAudio callback as its client data. Boxed and held by the
    /// monitor, then reclaimed in `Drop` after the listener is removed —
    /// CoreAudio offers no completion callback, so the removal call returning is
    /// the only join point available.
    struct ListenerState {
        level: Arc<InputDeviceLevel>,
        observer: Arc<dyn InputDeviceObserver>,
    }

    /// Owns one property listener on one device. The listener is per-device, so a
    /// user switching from the built-in microphone to a USB interface would
    /// silently stop the ad-hoc path; `device_changed` lets the caller notice.
    pub struct CoreAudioInputMonitor {
        state: *mut ListenerState,
        device_id: AudioObjectID,
    }

    // SAFETY: `state` is only ever dereferenced through shared references to an
    // atomic and two `Arc`s, and it stays valid until `Drop` removes the listener.
    unsafe impl Send for CoreAudioInputMonitor {}
    unsafe impl Sync for CoreAudioInputMonitor {}

    impl CoreAudioInputMonitor {
        /// Registers the listener and seeds `level` with the device's current
        /// state, so the first decision does not have to wait for a transition.
        pub fn start(
            level: Arc<InputDeviceLevel>,
            observer: Arc<dyn InputDeviceObserver>,
        ) -> Result<Self, InputMonitorError> {
            let device_id = default_input_device().ok_or(InputMonitorError::DeviceUnavailable)?;
            level.set(
                read_u32(device_id, kAudioDevicePropertyDeviceIsRunningSomewhere)
                    .is_some_and(|value| value != 0),
            );
            let state = Box::into_raw(Box::new(ListenerState { level, observer }));

            let mut property = address(kAudioDevicePropertyDeviceIsRunningSomewhere);
            // SAFETY: `state` outlives the listener; `Drop` removes the listener
            // before reclaiming the box.
            let status = unsafe {
                AudioObjectAddPropertyListener(
                    device_id,
                    NonNull::from(&mut property),
                    Some(device_running_listener),
                    state.cast::<c_void>(),
                )
            };
            if status != 0 {
                // SAFETY: the listener was never registered, so nothing else can
                // hold this pointer.
                drop(unsafe { Box::from_raw(state) });
                return Err(InputMonitorError::ListenerUnavailable);
            }

            Ok(Self { state, device_id })
        }

        /// True when the default input device is no longer the one this listener
        /// is registered on. Polled rather than watched with a second listener:
        /// one owner for the "which device" question, and a device swap does not
        /// need sub-second latency.
        pub fn device_changed(&self) -> bool {
            default_input_device().is_some_and(|device_id| device_id != self.device_id)
        }
    }

    impl Drop for CoreAudioInputMonitor {
        fn drop(&mut self) {
            let mut property = address(kAudioDevicePropertyDeviceIsRunningSomewhere);
            // SAFETY: removing the same listener and context registered in
            // `start`. CoreAudio guarantees no further callbacks once this
            // returns, which is what makes reclaiming the box below sound.
            unsafe {
                AudioObjectRemovePropertyListener(
                    self.device_id,
                    NonNull::from(&mut property),
                    Some(device_running_listener),
                    self.state.cast::<c_void>(),
                );
            }
            // SAFETY: the listener is gone, so this is the last live pointer.
            drop(unsafe { Box::from_raw(self.state) });
        }
    }

    /// Called on a CoreAudio-owned thread. Does the minimum: reads the property,
    /// records the level, and hands an edge to the observer. Anything expensive
    /// here would run on an audio-adjacent thread.
    unsafe extern "C-unwind" fn device_running_listener(
        object_id: AudioObjectID,
        _address_count: u32,
        _addresses: NonNull<AudioObjectPropertyAddress>,
        client_data: *mut c_void,
    ) -> i32 {
        if client_data.is_null() {
            return 0;
        }
        // SAFETY: `CoreAudioInputMonitor` keeps this box alive until after the
        // listener is removed.
        let state = unsafe { &*client_data.cast::<ListenerState>() };
        let active = read_u32(object_id, kAudioDevicePropertyDeviceIsRunningSomewhere)
            .is_some_and(|value| value != 0);
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
    fn an_unavailable_device_reports_idle() {
        assert_eq!(UnavailableInputDevice.mic_signal(), MicSignal::Idle);
    }
}
