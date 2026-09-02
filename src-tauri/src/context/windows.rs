//! Windows UI Automation-backed context capture.
//!
//! A UIA request crosses into the focused application's process, so this module
//! is called only from a capture worker or from the thread about to consume the
//! context, and every request is bounded twice: by the client's transaction
//! timeout, and by the stage's remaining budget
//! ([`super::deadline::CaptureDeadline`]). An unresponsive target therefore
//! degrades the sources it owns instead of starving the whole capture or
//! delaying the recording hotkey.
//!
//! Two sources macOS answers have no equivalent here and say so rather than
//! reporting an empty read. Windows exposes no page URL through UI Automation —
//! browsers publish the address bar as an ordinary edit control, which is a
//! per-browser guess, not a platform answer — and it exposes no clipboard
//! change timestamp that [`super::clipboard_recency`] samples, so a copy can
//! never be proven to fall inside a run's pre-roll window.

use super::deadline::CaptureDeadline;
use super::{
    clipboard_recency, AccessibilityAccess, ApplicationCapture, CaptureOptions, ContextPolicy,
    ContextSourceStatus, SelectionCapture, SourceOutcome, StartCapture,
};
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, E_ACCESSDENIED};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation8, IUIAutomation2, IUIAutomationElement, IUIAutomationTextPattern,
    IUIAutomationValuePattern, UIA_ComboBoxControlTypeId, UIA_DocumentControlTypeId,
    UIA_EditControlTypeId, UIA_TextControlTypeId, UIA_TextPatternId, UIA_ValuePatternId,
    UIA_CONTROLTYPE_ID,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

/// Longest process image path this reads. Windows paths can exceed `MAX_PATH`
/// when long paths are enabled, and an executable name that does not fit is a
/// worse answer than none.
const MAX_IMAGE_PATH_UNITS: usize = 1024;

/// Control types whose value is text the user is reading or editing. A focused
/// button has a name but no field contents, and passing its label off as the
/// focused field's value would be a lie rather than a capture.
const TEXT_CONTROL_TYPES: [UIA_CONTROLTYPE_ID; 4] = [
    UIA_EditControlTypeId,
    UIA_DocumentControlTypeId,
    UIA_ComboBoxControlTypeId,
    UIA_TextControlTypeId,
];

/// Windows has no per-application accessibility permission: any process may
/// create a UI Automation client. The honest answer is therefore whether the
/// client exists, not whether a user granted something.
pub(crate) fn accessibility_access() -> AccessibilityAccess {
    match automation() {
        Some(_) => AccessibilityAccess::Granted,
        None => AccessibilityAccess::Unsupported,
    }
}

/// Reads the sources whose value is only true at record start: the selection the
/// user is looking at. Clipboard recency has no Windows primitive, so the
/// clipboard is reported unsupported instead of stale.
pub(crate) fn read_start(
    policy: ContextPolicy,
    _options: CaptureOptions,
    _clipboard_generation: clipboard_recency::Generation,
    deadline: CaptureDeadline,
) -> StartCapture {
    let accessibility = accessibility_access();
    let mut start = StartCapture {
        accessibility,
        ..StartCapture::default()
    };

    if policy.wants_clipboard() {
        start.clipboard = SourceOutcome::Unavailable(ContextSourceStatus::Unsupported);
    }

    if !policy.wants_selection() {
        return start;
    }

    start.selected_text = match automation() {
        Some(automation) => match focused_element(&automation, deadline) {
            Ok(element) => read_selection(&automation, &element, deadline),
            Err(status) => SourceOutcome::Unavailable(status),
        },
        None => SourceOutcome::Unavailable(ContextSourceStatus::Unsupported),
    };
    start
}

/// Reads the foreground application and the control the text is about to land
/// in. Called immediately before the step that consumes the context: switching
/// windows between record start and this read deliberately changes the answer.
pub(crate) fn read_application(
    policy: ContextPolicy,
    options: CaptureOptions,
    captured_at_ms: u64,
    deadline: CaptureDeadline,
) -> ApplicationCapture {
    let application_identifier = frontmost_application_identifier();
    let mut capture = ApplicationCapture {
        captured_at_ms: Some(captured_at_ms),
        application_name: application_identifier.clone(),
        application_identifier: application_identifier.clone(),
        target: SourceOutcome::read(application_identifier),
        // Opting out of URL capture is a user setting, not an absent source, and
        // an opted-in user is told the platform cannot answer instead.
        browser_url: SourceOutcome::Unavailable(if options.url_capture_enabled {
            ContextSourceStatus::Unsupported
        } else {
            ContextSourceStatus::Disabled
        }),
        ..ApplicationCapture::default()
    };

    if !policy.wants_focused_field() {
        return capture;
    }

    let Some(automation) = automation() else {
        capture.focused_field = SourceOutcome::Unavailable(ContextSourceStatus::Unsupported);
        return capture;
    };
    let element = match focused_element(&automation, deadline) {
        Ok(element) => element,
        Err(status) => {
            capture.focused_field = SourceOutcome::Unavailable(status);
            return capture;
        }
    };

    if is_secure_field(&automation, &element, deadline) {
        // Do not ask a secure control for its value. UI Automation would hand
        // that value to any client; Sona never asks for it.
        capture.focused_field = SourceOutcome::Unavailable(ContextSourceStatus::SecureField);
        return capture;
    }

    capture.focused_field_name = element_name(&automation, &element, deadline);
    capture.focused_field = match is_text_control(&automation, &element, deadline) {
        Ok(true) => element_value(&automation, &element, deadline),
        // A focused control that holds no text is a successful read of nothing.
        Ok(false) => SourceOutcome::Unavailable(ContextSourceStatus::Empty),
        Err(status) => SourceOutcome::Unavailable(status),
    };
    capture
}

/// Reads the current selection for an explicit user action. Independent of the
/// ambient policy: the caller's shortcut is the request.
pub(crate) fn capture_selected_text() -> SelectionCapture {
    let Some(automation) = automation() else {
        return SelectionCapture::Unavailable(ContextSourceStatus::Unsupported);
    };
    let deadline = CaptureDeadline::starting_now();
    match focused_element(&automation, deadline)
        .map(|element| read_selection(&automation, &element, deadline))
    {
        Ok(SourceOutcome::Captured(text)) => SelectionCapture::Captured(text),
        Ok(SourceOutcome::Unavailable(status)) => SelectionCapture::Unavailable(status),
        Err(status) => SelectionCapture::Unavailable(status),
    }
}

/// The foreground window's executable file name, lowercased. This is Windows'
/// stable application identity: unlike a window title it does not change with
/// the document, and unlike a display name it is not localized. Reading it is
/// two local syscalls, so mode activation can call it off the capture path.
pub(crate) fn frontmost_application_identifier() -> Option<String> {
    let path = foreground_process_image()?;
    let name = path.rsplit(['\\', '/']).next()?.trim();
    (!name.is_empty()).then(|| name.to_ascii_lowercase())
}

/// The UI Automation client. Created per stage: a client carries the
/// transaction timeout this module rewrites for every read, and COM objects
/// must not be shared across apartments.
fn automation() -> Option<IUIAutomation2> {
    // UI Automation is an in-process COM client, so the calling thread needs an
    // apartment. The process usually already has one and this module never owns
    // it, which is why the result is ignored and the apartment is never torn
    // down here: an existing single-threaded apartment answers
    // `RPC_E_CHANGED_MODE` and keeps working.
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    // SAFETY: CUIAutomation8 is an in-process class and takes no caller-owned pointer input.
    unsafe { CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER).ok() }
}

/// The one place a cross-process read starts, and therefore the one place the
/// capture's budget is spent. The transaction timeout applies to every request
/// the client makes after it, so it is rewritten before each read rather than
/// set once.
fn arm(automation: &IUIAutomation2, deadline: CaptureDeadline) -> Result<(), ContextSourceStatus> {
    let Some(millis) = deadline.next_read_millis() else {
        // Out of budget. Failed is the status for a source that did not answer
        // in time, whether the target stalled or an earlier source spent the
        // time. Every remaining read lands here too, so the capture returns what
        // it already has.
        return Err(ContextSourceStatus::Failed);
    };
    // SAFETY: `automation` is a live in-process COM object for this call.
    unsafe { automation.SetTransactionTimeout(millis) }.map_err(status_for_error)
}

fn focused_element(
    automation: &IUIAutomation2,
    deadline: CaptureDeadline,
) -> Result<IUIAutomationElement, ContextSourceStatus> {
    arm(automation, deadline)?;
    // SAFETY: `automation` is a live in-process COM object for this call.
    unsafe { automation.GetFocusedElement() }.map_err(status_for_error)
}

/// A secure control's selection is never read, even though UI Automation would
/// hand it over.
fn read_selection(
    automation: &IUIAutomation2,
    element: &IUIAutomationElement,
    deadline: CaptureDeadline,
) -> SourceOutcome {
    if is_secure_field(automation, element, deadline) {
        return SourceOutcome::Unavailable(ContextSourceStatus::SecureField);
    }
    if let Err(status) = arm(automation, deadline) {
        return SourceOutcome::Unavailable(status);
    }
    // SAFETY: `element` is a live UI Automation element for these calls.
    let selected = unsafe {
        element
            .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            .and_then(|pattern| pattern.GetSelection())
            .and_then(|ranges| {
                if ranges.Length()? > 0 {
                    ranges
                        .GetElement(0)?
                        .GetText(max_text_units())
                        .map(|text| text.to_string())
                } else {
                    Ok(String::new())
                }
            })
    };
    match selected {
        Ok(text) => SourceOutcome::read(Some(text)),
        // A control with no text pattern has no selection to report.
        Err(error) => SourceOutcome::Unavailable(status_for_error(error)),
    }
}

fn element_name(
    automation: &IUIAutomation2,
    element: &IUIAutomationElement,
    deadline: CaptureDeadline,
) -> Option<String> {
    arm(automation, deadline).ok()?;
    // SAFETY: `element` is a live UI Automation element for this call.
    let name = unsafe { element.CurrentName() }.ok()?.to_string();
    (!name.trim().is_empty()).then_some(name)
}

fn element_value(
    automation: &IUIAutomation2,
    element: &IUIAutomationElement,
    deadline: CaptureDeadline,
) -> SourceOutcome {
    if let Err(status) = arm(automation, deadline) {
        return SourceOutcome::Unavailable(status);
    }
    // SAFETY: `element` is a live UI Automation element for these calls.
    let value = unsafe {
        element
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            .and_then(|pattern| pattern.CurrentValue())
    };
    match value {
        Ok(text) => SourceOutcome::read(Some(text.to_string())),
        Err(error) => SourceOutcome::Unavailable(status_for_error(error)),
    }
}

fn is_text_control(
    automation: &IUIAutomation2,
    element: &IUIAutomationElement,
    deadline: CaptureDeadline,
) -> Result<bool, ContextSourceStatus> {
    arm(automation, deadline)?;
    // SAFETY: `element` is a live UI Automation element for this call.
    let control_type = unsafe { element.CurrentControlType() }.map_err(status_for_error)?;
    Ok(TEXT_CONTROL_TYPES.contains(&control_type))
}

/// Any failure counts as secure: reading a control that cannot say whether it
/// holds a password is exactly what this gate exists to prevent.
fn is_secure_field(
    automation: &IUIAutomation2,
    element: &IUIAutomationElement,
    deadline: CaptureDeadline,
) -> bool {
    if arm(automation, deadline).is_err() {
        return true;
    }
    // SAFETY: `element` is a live UI Automation element for this call.
    unsafe { element.CurrentIsPassword() }.map_or(true, |secure| secure.as_bool())
}

fn foreground_process_image() -> Option<String> {
    // SAFETY: GetForegroundWindow takes no arguments and returns a borrowed handle.
    let window = unsafe { GetForegroundWindow() };
    if window.is_invalid() {
        return None;
    }

    let mut process_id = 0u32;
    // SAFETY: `process_id` is a live stack slot for the whole call.
    unsafe { GetWindowThreadProcessId(window, Some(&mut process_id)) };
    if process_id == 0 {
        return None;
    }

    // Query-limited access is the least this needs and the most a protected
    // process will grant, so an elevated foreground app degrades to no
    // identity rather than to an error the user cannot act on.
    // SAFETY: OpenProcess takes no caller-owned pointers; the handle is closed below.
    let process =
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }.ok()?;
    let mut buffer = [0u16; MAX_IMAGE_PATH_UNITS];
    let mut units = buffer.len() as u32;
    // SAFETY: `process` is open, and buffer/units are live for the whole call.
    let read = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut units,
        )
    };
    // SAFETY: `process` came from OpenProcess above and is not used afterwards.
    let _ = unsafe { CloseHandle(process) };
    read.ok()?;

    let units = usize::try_from(units).ok()?.min(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..units]))
}

/// `GetText` counts UTF-16 units, and the shared byte cap is the smaller bound
/// for every string, so asking for more than the cap only copies text the
/// caller is about to discard.
fn max_text_units() -> i32 {
    i32::try_from(super::MAX_SOURCE_BYTES).unwrap_or(i32::MAX)
}

fn status_for_error(error: windows::core::Error) -> ContextSourceStatus {
    if error.code() == E_ACCESSDENIED {
        ContextSourceStatus::PermissionDenied
    } else {
        ContextSourceStatus::Failed
    }
}
