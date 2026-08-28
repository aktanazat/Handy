//! macOS Accessibility-backed context capture.
//!
//! AX calls cross into a different application process. This module is called
//! only from the capture worker, and every read is bounded twice: by its own
//! message timeout, and by the capture's remaining budget
//! ([`super::deadline::CaptureDeadline`]). An unresponsive target therefore
//! degrades the sources it owns instead of starving the whole capture or
//! delaying the recording hotkey.

use super::deadline::{CaptureDeadline, ReadBudget};
use super::{
    clipboard_recency, website_host_from_url, AccessibilityAccess, CaptureOptions, ContextPolicy,
    ContextSourceStatus, RawCapture, SourceOutcome, WebsiteHostCapture,
};
use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString, NSWorkspace};
use objc2_application_services::{AXError, AXIsProcessTrusted, AXUIElement};
use objc2_core_foundation::{CFGetTypeID, CFRetained, CFString, CFType, ConcreteType, CFURL};
use std::ptr::{self, NonNull};
use std::time::Duration;

const AX_FOCUSED_APPLICATION: &str = "AXFocusedApplication";
const AX_FOCUSED_UI_ELEMENT: &str = "AXFocusedUIElement";
const AX_FOCUSED_WINDOW: &str = "AXFocusedWindow";
const AX_PARENT: &str = "AXParent";
const AX_ROLE: &str = "AXRole";
const AX_SUBROLE: &str = "AXSubrole";
const AX_TITLE: &str = "AXTitle";
const AX_DESCRIPTION: &str = "AXDescription";
const AX_VALUE: &str = "AXValue";
const AX_SELECTED_TEXT: &str = "AXSelectedText";
const AX_URL: &str = "AXURL";
const AX_SECURE_TEXT_FIELD: &str = "AXSecureTextField";
const MAX_ANCESTORS: usize = 8;

enum AccessibilityAttributeValue {
    Text(CFRetained<CFString>),
    Url(CFRetained<CFURL>),
    Element(CFRetained<AXUIElement>),
    Other,
}

impl AccessibilityAttributeValue {
    fn from_copied(value: CFRetained<CFType>) -> Self {
        let type_id = CFGetTypeID(Some(value.as_ref()));
        if type_id == CFString::type_id() {
            // SAFETY: CFGetTypeID proved that this retained Core Foundation value is exactly a CFString.
            let text: CFRetained<CFString> = unsafe { CFRetained::cast_unchecked(value) };
            return Self::Text(text);
        }
        if type_id == CFURL::type_id() {
            // SAFETY: CFGetTypeID proved that this retained Core Foundation value is exactly a CFURL.
            let url: CFRetained<CFURL> = unsafe { CFRetained::cast_unchecked(value) };
            return Self::Url(url);
        }
        if type_id == AXUIElement::type_id() {
            // SAFETY: CFGetTypeID proved that this retained Core Foundation value is exactly an AXUIElement.
            let element: CFRetained<AXUIElement> = unsafe { CFRetained::cast_unchecked(value) };
            return Self::Element(element);
        }
        Self::Other
    }
}

pub(crate) fn accessibility_access() -> AccessibilityAccess {
    // No options is the documented non-prompting Accessibility check. Permission
    // prompting remains an explicit user action in the existing onboarding UI.
    // SAFETY: AXIsProcessTrusted takes no caller-owned pointers and only reads the process accessibility state.
    if unsafe { AXIsProcessTrusted() } {
        AccessibilityAccess::Granted
    } else {
        AccessibilityAccess::Denied
    }
}

pub(crate) fn read(
    policy: ContextPolicy,
    options: CaptureOptions,
    clipboard_generation: clipboard_recency::Generation,
    deadline: CaptureDeadline,
) -> RawCapture {
    let (application_name, application_identifier) = frontmost_application();
    let target = SourceOutcome::read(
        application_identifier
            .clone()
            .or_else(|| application_name.clone()),
    );
    let accessibility = accessibility_access();
    let mut raw = RawCapture {
        accessibility,
        application_name,
        application_identifier,
        target,
        ..RawCapture::default()
    };

    if policy.wants_clipboard() {
        raw.clipboard = read_recent_clipboard(clipboard_generation);
    }

    if !policy.wants_selection() && !policy.wants_focused_field() && !options.url_capture_enabled {
        return raw;
    }

    if accessibility != AccessibilityAccess::Granted {
        assign_ax_unavailable(
            &mut raw,
            policy,
            options,
            ContextSourceStatus::PermissionDenied,
        );
        return raw;
    }

    let focused_application = match focused_application(deadline) {
        Ok(application) => application,
        Err(status) => {
            assign_ax_unavailable(&mut raw, policy, options, status);
            return raw;
        }
    };
    let focused_element =
        match attribute_element(&focused_application, AX_FOCUSED_UI_ELEMENT, deadline) {
            Ok(element) => element,
            Err(status) => {
                assign_ax_unavailable(&mut raw, policy, options, status);
                return raw;
            }
        };

    let secure_field = is_secure_field(&focused_element, deadline);
    if secure_field {
        // Do not ask a secure control for its value or selection. Accessibility
        // can expose those values to a trusted client, but Sona never does.
        if policy.wants_focused_field() {
            raw.focused_field = SourceOutcome::Unavailable(ContextSourceStatus::SecureField);
        }
        if policy.wants_selection() {
            raw.selected_text = SourceOutcome::Unavailable(ContextSourceStatus::SecureField);
        }
    } else {
        if policy.wants_focused_field() {
            raw.focused_field_name = attribute_string(&focused_element, AX_TITLE, deadline)
                .ok()
                .flatten()
                .or_else(|| {
                    attribute_string(&focused_element, AX_DESCRIPTION, deadline)
                        .ok()
                        .flatten()
                });
            raw.focused_field = attribute_string(&focused_element, AX_VALUE, deadline)
                .map(SourceOutcome::read)
                .unwrap_or_else(SourceOutcome::Unavailable);
        }
        if policy.wants_selection() {
            raw.selected_text = attribute_string(&focused_element, AX_SELECTED_TEXT, deadline)
                .map(SourceOutcome::read)
                .unwrap_or_else(SourceOutcome::Unavailable);
        }
    }

    raw.browser_url = if policy.wants_target() {
        if !options.url_capture_enabled {
            SourceOutcome::Unavailable(ContextSourceStatus::Disabled)
        } else if secure_field {
            // A browser URL identifies the same private interaction as the
            // focused secure control, so it is excluded with that control.
            SourceOutcome::Unavailable(ContextSourceStatus::SecureField)
        } else {
            find_url(&focused_element, &focused_application, deadline)
        }
    } else {
        SourceOutcome::Unavailable(ContextSourceStatus::NotRequested)
    };

    raw
}

pub(crate) fn frontmost_application_identifier() -> Option<String> {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .as_ref()
        .and_then(|application| application.bundleIdentifier())
        .map(|identifier| identifier.to_string())
}

/// Reads just the browser host needed to select a local mode. The captured URL
/// stays inside this function and is discarded after parsing.
pub(crate) fn frontmost_website_host() -> WebsiteHostCapture {
    if accessibility_access() != AccessibilityAccess::Granted {
        return WebsiteHostCapture::Unavailable;
    }

    let deadline = CaptureDeadline::starting_now();
    let focused_application = match focused_application(deadline) {
        Ok(application) => application,
        Err(_) => return WebsiteHostCapture::Unavailable,
    };
    let focused_element =
        match attribute_element(&focused_application, AX_FOCUSED_UI_ELEMENT, deadline) {
            Ok(element) => element,
            Err(_) => return WebsiteHostCapture::Unavailable,
        };
    if is_secure_field(&focused_element, deadline) {
        return WebsiteHostCapture::SecureField;
    }

    match find_url(&focused_element, &focused_application, deadline) {
        SourceOutcome::Captured(url) => website_host_from_url(&url)
            .map(WebsiteHostCapture::Captured)
            .unwrap_or(WebsiteHostCapture::Unavailable),
        SourceOutcome::Unavailable(_) => WebsiteHostCapture::Unavailable,
    }
}

fn frontmost_application() -> (Option<String>, Option<String>) {
    let application = NSWorkspace::sharedWorkspace().frontmostApplication();
    let name = application
        .as_ref()
        .and_then(|application| application.localizedName())
        .map(|name| name.to_string());
    let identifier = application
        .as_ref()
        .and_then(|application| application.bundleIdentifier())
        .map(|identifier| identifier.to_string());
    (name, identifier)
}

fn read_recent_clipboard(generation: clipboard_recency::Generation) -> SourceOutcome {
    if !generation.is_fresh(super::now_ms()) || !generation.matches_current() {
        return SourceOutcome::Unavailable(ContextSourceStatus::Stale);
    }
    // This runs on the per-run capture worker, a thread with no pool of its own.
    // Without one, every autoreleased AppKit return value here would live until
    // the thread exits.
    let text = objc2::rc::autoreleasepool(|_| {
        let pasteboard = NSPasteboard::generalPasteboard();
        // SAFETY: NSPasteboardTypeString is a read-only AppKit framework static.
        let pasteboard_type = unsafe { NSPasteboardTypeString };
        pasteboard
            .stringForType(pasteboard_type)
            .map(|text| text.to_string())
    });
    // Never race a later copy into a context snapshot frozen at run start.
    if !generation.matches_current() {
        return SourceOutcome::Unavailable(ContextSourceStatus::Stale);
    }
    SourceOutcome::read(text)
}

fn focused_application(
    deadline: CaptureDeadline,
) -> Result<CFRetained<AXUIElement>, ContextSourceStatus> {
    // SAFETY: the system-wide AX element has no caller-owned pointer input.
    let system = unsafe { AXUIElement::new_system_wide() };
    attribute_element(&system, AX_FOCUSED_APPLICATION, deadline)
}

fn find_url(
    focused: &AXUIElement,
    application: &AXUIElement,
    deadline: CaptureDeadline,
) -> SourceOutcome {
    if let Some(url) = ancestor_url(focused, deadline) {
        return SourceOutcome::read(Some(url));
    }
    match attribute_element(application, AX_FOCUSED_WINDOW, deadline) {
        Ok(window) => ancestor_url(&window, deadline)
            .map(|url| SourceOutcome::read(Some(url)))
            .unwrap_or_else(|| SourceOutcome::Unavailable(ContextSourceStatus::Empty)),
        Err(status) => SourceOutcome::Unavailable(status),
    }
}

/// The walk needs no deadline check of its own: once the budget is spent every
/// read below returns an error, so the loop stops on the first one.
fn ancestor_url(element: &AXUIElement, deadline: CaptureDeadline) -> Option<String> {
    if let Ok(Some(url)) = attribute_string(element, AX_URL, deadline) {
        return Some(url);
    }
    let mut current = attribute_element(element, AX_PARENT, deadline).ok()?;
    for _ in 0..MAX_ANCESTORS {
        if let Ok(Some(url)) = attribute_string(&current, AX_URL, deadline) {
            return Some(url);
        }
        current = attribute_element(&current, AX_PARENT, deadline).ok()?;
    }
    None
}

fn is_secure_field(element: &AXUIElement, deadline: CaptureDeadline) -> bool {
    [AX_ROLE, AX_SUBROLE].into_iter().any(|attribute| {
        attribute_string(element, attribute, deadline)
            .ok()
            .flatten()
            .is_some_and(|value| value == AX_SECURE_TEXT_FIELD)
    })
}

fn assign_ax_unavailable(
    raw: &mut RawCapture,
    policy: ContextPolicy,
    options: CaptureOptions,
    status: ContextSourceStatus,
) {
    if policy.wants_focused_field() {
        raw.focused_field = SourceOutcome::Unavailable(status);
    }
    if policy.wants_selection() {
        raw.selected_text = SourceOutcome::Unavailable(status);
    }
    if policy.wants_target() {
        raw.browser_url = SourceOutcome::Unavailable(if options.url_capture_enabled {
            status
        } else {
            ContextSourceStatus::Disabled
        });
    }
}

fn set_timeout(element: &AXUIElement, timeout: Duration) -> Result<(), ContextSourceStatus> {
    // Do not start a read with AppKit's default timeout. If the element rejects
    // the bounded timeout, the source failed rather than silently escaping the
    // capture deadline.
    // SAFETY: `element` is a live AXUIElement reference for this call.
    let error = unsafe { element.set_messaging_timeout(timeout.as_secs_f32()) };
    if error == AXError::Success {
        Ok(())
    } else {
        Err(status_for_error(error))
    }
}

fn attribute_string(
    element: &AXUIElement,
    attribute: &str,
    deadline: CaptureDeadline,
) -> Result<Option<String>, ContextSourceStatus> {
    match attribute_value(element, attribute, deadline)? {
        Some(AccessibilityAttributeValue::Text(text)) => Ok(Some(text.to_string())),
        Some(AccessibilityAttributeValue::Url(url)) => Ok(Some(url.string().to_string())),
        Some(AccessibilityAttributeValue::Element(_))
        | Some(AccessibilityAttributeValue::Other)
        | None => Ok(None),
    }
}

fn attribute_element(
    element: &AXUIElement,
    attribute: &str,
    deadline: CaptureDeadline,
) -> Result<CFRetained<AXUIElement>, ContextSourceStatus> {
    match attribute_value(element, attribute, deadline)? {
        Some(AccessibilityAttributeValue::Element(element)) => Ok(element),
        None => Err(ContextSourceStatus::Empty),
        Some(_) => Err(ContextSourceStatus::Failed),
    }
}

/// The one place a cross-process read starts, and therefore the one place the
/// capture's budget is spent. Each element gets its own timeout because
/// attribute_element returns a fresh AXUIElement and messaging timeouts are
/// per element.
fn attribute_value(
    element: &AXUIElement,
    attribute: &str,
    deadline: CaptureDeadline,
) -> Result<Option<AccessibilityAttributeValue>, ContextSourceStatus> {
    let ReadBudget::Remaining(timeout) = deadline.next_read() else {
        // Out of budget. Failed is the status for a source that did not answer
        // in time, whether the target stalled or an earlier source spent the
        // time. Every remaining read lands here too, so the capture returns what
        // it already has instead of the join dropping all of it.
        return Err(ContextSourceStatus::Failed);
    };
    set_timeout(element, timeout)?;
    let attribute = CFString::from_str(attribute);
    let mut raw: *const CFType = ptr::null();
    // The Copy API returns either null or one retained CFType owned by this call.
    // SAFETY: raw is a live null-initialized output slot.
    let error = unsafe { element.copy_attribute_value(&attribute, NonNull::from(&mut raw)) };
    if error != AXError::Success {
        return Err(status_for_error(error));
    }
    let Some(raw) = NonNull::new(raw.cast_mut()) else {
        return Ok(None);
    };
    // SAFETY: CopyAttributeValue returned this pointer under the Create/Copy rule, so this call owns one retain.
    let value = unsafe { CFRetained::from_raw(raw) };
    Ok(Some(AccessibilityAttributeValue::from_copied(value)))
}

fn status_for_error(error: AXError) -> ContextSourceStatus {
    match error {
        AXError::NoValue => ContextSourceStatus::Empty,
        AXError::AttributeUnsupported | AXError::NotImplemented => ContextSourceStatus::Unsupported,
        AXError::APIDisabled => ContextSourceStatus::PermissionDenied,
        AXError::CannotComplete | AXError::Failure | AXError::InvalidUIElement => {
            ContextSourceStatus::Failed
        }
        _ => ContextSourceStatus::Failed,
    }
}

/// Result of one Accessibility insertion attempt. It deliberately separates an
/// unsupported target (safe to fall back) from a timeout/transport failure
/// (possibly dispatched, never retry).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AccessibilityInsertion {
    Delivered,
    NotDispatched,
    DispatchedButUnconfirmed,
}

/// Replaces the focused editable control's selection (or inserts at its caret)
/// without changing the clipboard. This does not read a control's value.
///
/// Insertion reads the same out-of-process elements as capture, so it takes the
/// same budget: a wedged target costs one bounded attempt and then the caller's
/// existing clipboard fallback, instead of holding delivery for one timeout per
/// element read.
pub(crate) fn insert_into_focused_editable(text: &str) -> AccessibilityInsertion {
    if accessibility_access() != AccessibilityAccess::Granted {
        return AccessibilityInsertion::NotDispatched;
    }
    let deadline = CaptureDeadline::starting_now();
    let Ok(application) = focused_application(deadline) else {
        return AccessibilityInsertion::NotDispatched;
    };
    let Ok(element) = attribute_element(&application, AX_FOCUSED_UI_ELEMENT, deadline) else {
        return AccessibilityInsertion::NotDispatched;
    };
    if is_secure_field(&element, deadline) || !is_editable_role(&element, deadline) {
        return AccessibilityInsertion::NotDispatched;
    }
    let ReadBudget::Remaining(timeout) = deadline.next_read() else {
        // Nothing was dispatched, so the caller's fallback is still safe.
        return AccessibilityInsertion::NotDispatched;
    };

    if set_timeout(&element, timeout).is_err() {
        return AccessibilityInsertion::NotDispatched;
    }
    let attribute = CFString::from_static_str(AX_SELECTED_TEXT);
    let replacement = CFString::from_str(text);
    // SAFETY: element is the currently focused editable AX element, and both attribute values remain valid for this call.
    match unsafe { element.set_attribute_value(&attribute, &replacement) } {
        AXError::Success => AccessibilityInsertion::Delivered,
        // The request may have reached a wedged target before the AX client
        // timed out. Treat it as unknown and do not emit a second event.
        AXError::CannotComplete | AXError::Failure => {
            AccessibilityInsertion::DispatchedButUnconfirmed
        }
        _ => AccessibilityInsertion::NotDispatched,
    }
}

fn is_editable_role(element: &AXUIElement, deadline: CaptureDeadline) -> bool {
    matches!(
        attribute_string(element, AX_ROLE, deadline)
            .ok()
            .flatten()
            .as_deref(),
        Some("AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField")
    )
}
