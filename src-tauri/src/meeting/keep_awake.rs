/// One session-owned macOS idle-sleep assertion pair.
///
/// The opaque IOKit assertion identifiers are plain integers, so
/// `MeetingSessionManager` remains safe to hold in Tauri's `Send + Sync` state.
/// This guard is the only owner that creates and releases these assertions.
pub struct MeetingKeepAwake {
    #[cfg(target_os = "macos")]
    assertions: Option<[u32; 2]>,
}

impl Default for MeetingKeepAwake {
    fn default() -> Self {
        Self::new()
    }
}

impl MeetingKeepAwake {
    pub const fn new() -> Self {
        Self {
            #[cfg(target_os = "macos")]
            assertions: None,
        }
    }

    pub fn acquire(&mut self) {
        #[cfg(target_os = "macos")]
        {
            if self.assertions.is_some() {
                return;
            }
            let display = create_assertion(b"NoDisplaySleepAssertion\0");
            let system = create_assertion(b"NoIdleSleepAssertion\0");
            match (display, system) {
                (Some(display), Some(system)) => self.assertions = Some([display, system]),
                (Some(display), None) => release_assertion(display),
                (None, Some(system)) => release_assertion(system),
                (None, None) => {}
            }
        }
    }

    pub fn release(&mut self) {
        #[cfg(target_os = "macos")]
        if let Some(assertions) = self.assertions.take() {
            for assertion in assertions {
                release_assertion(assertion);
            }
        }
    }

    pub const fn is_held(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            self.assertions.is_some()
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }
}

impl Drop for MeetingKeepAwake {
    fn drop(&mut self) {
        self.release();
    }
}

#[cfg(target_os = "macos")]
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
#[cfg(target_os = "macos")]
const K_IOPM_ASSERTION_LEVEL_ON: u32 = 255;

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFStringCreateWithCString(
        allocator: *const core::ffi::c_void,
        c_str: *const core::ffi::c_char,
        encoding: u32,
    ) -> *const core::ffi::c_void;
    fn CFRelease(cf: *const core::ffi::c_void);
}

#[cfg(target_os = "macos")]
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOPMAssertionCreateWithName(
        assertion_type: *const core::ffi::c_void,
        level: u32,
        name: *const core::ffi::c_void,
        assertion_id: *mut u32,
    ) -> i32;
    fn IOPMAssertionRelease(assertion_id: u32) -> i32;
}

#[cfg(target_os = "macos")]
fn create_assertion(assertion_type: &'static [u8]) -> Option<u32> {
    let reason = b"Sona is capturing a meeting\0";
    // SAFETY: Static NUL-terminated UTF-8 strings and locally released CF objects uphold both FFI contracts.
    unsafe {
        let assertion_type = CFStringCreateWithCString(
            core::ptr::null(),
            assertion_type.as_ptr().cast(),
            K_CF_STRING_ENCODING_UTF8,
        );
        let reason = CFStringCreateWithCString(
            core::ptr::null(),
            reason.as_ptr().cast(),
            K_CF_STRING_ENCODING_UTF8,
        );
        if assertion_type.is_null() || reason.is_null() {
            if !assertion_type.is_null() {
                CFRelease(assertion_type);
            }
            if !reason.is_null() {
                CFRelease(reason);
            }
            return None;
        }
        let mut assertion_id = 0_u32;
        let status = IOPMAssertionCreateWithName(
            assertion_type,
            K_IOPM_ASSERTION_LEVEL_ON,
            reason,
            &mut assertion_id,
        );
        CFRelease(assertion_type);
        CFRelease(reason);
        (status == 0).then_some(assertion_id)
    }
}

#[cfg(target_os = "macos")]
fn release_assertion(assertion_id: u32) {
    // SAFETY: This guard owns each IOKit identifier and clears it before any second release.
    unsafe {
        let _ = IOPMAssertionRelease(assertion_id);
    }
}

#[cfg(test)]
mod tests {
    use super::MeetingKeepAwake;

    #[test]
    fn release_is_idempotent() {
        let mut assertion = MeetingKeepAwake::new();
        assertion.release();
        assertion.acquire();
        assertion.release();
        assert!(!assertion.is_held());
    }
}
