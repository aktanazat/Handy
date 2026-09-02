//! AT-SPI2-backed context capture for Linux.
//!
//! AT-SPI2 is a D-Bus service: every read is a round trip to the focused
//! application's own process, exactly like the macOS Accessibility reader, and
//! the same [`super::deadline::CaptureDeadline`] bounds how many of them one
//! capture may start. The budget is spent per read rather than per stage, so a
//! slow application costs the sources it owns instead of the whole capture.
//!
//! One difference from macOS matters and is deliberate. D-Bus has no
//! per-request timeout a client can set, so the deadline bounds the *number* of
//! reads, not the length of a single wedged one. Every entry point that runs on
//! a thread the user is waiting on therefore hands its walk to a short-lived
//! worker and joins under a bound: a wedged peer costs an abandoned worker until
//! the bus gives up on it, never a delayed dictation.
//!
//! Two sources macOS answers have no equivalent here and say so rather than
//! reporting an empty read: AT-SPI2 exposes no clipboard change counter for
//! [`super::clipboard_recency`] to sample, and its document URL is a per-toolkit
//! attribute rather than a property of the focused control.

use super::deadline::CaptureDeadline;
use super::{
    clipboard_recency, AccessibilityAccess, ApplicationCapture, CaptureOptions, ContextPolicy,
    ContextSourceStatus, SelectionCapture, SourceOutcome, StartCapture,
};
use serde::Deserialize;
use std::sync::mpsc;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use zbus::blocking::Connection;
use zbus::zvariant::{DynamicType, OwnedObjectPath, OwnedValue, Type};

const A11Y_BUS_SERVICE: &str = "org.a11y.Bus";
const A11Y_BUS_PATH: &str = "/org/a11y/bus";
const A11Y_BUS_INTERFACE: &str = "org.a11y.Bus";
const A11Y_STATUS_INTERFACE: &str = "org.a11y.Status";
const PROPERTIES_INTERFACE: &str = "org.freedesktop.DBus.Properties";
const REGISTRY_SERVICE: &str = "org.a11y.atspi.Registry";
const REGISTRY_ROOT_PATH: &str = "/org/a11y/atspi/accessible/root";
const ACCESSIBLE_INTERFACE: &str = "org.a11y.atspi.Accessible";
const TEXT_INTERFACE: &str = "org.a11y.atspi.Text";

/// `AtspiStateType` bit indices. These are the published AT-SPI 2 enumeration
/// values; the protocol carries the bitfield, not the names.
const STATE_ACTIVE: u32 = 1;
const STATE_FOCUSED: u32 = 12;
const STATE_SHOWING: u32 = 25;

/// `atspi_role_get_name` for a masked text entry. Role names are the stable
/// wire spelling of the role enumeration, which is why this compares names
/// rather than the numeric role.
const PASSWORD_ROLE_NAME: &str = "password text";

/// Ceiling on the focus search, independent of the clock. A toolkit that
/// publishes a very wide tree must cost a bounded number of round trips even
/// when every one of them answers instantly.
const MAX_VISITED_ACCESSIBLES: usize = 64;

/// Whole-text read of the focused control.
const WHOLE_TEXT: (i32, i32) = (0, -1);

/// One AT-SPI object: the application's bus name and the object's path.
#[derive(Clone, Debug)]
struct Accessible {
    destination: String,
    path: OwnedObjectPath,
}

impl Accessible {
    fn root() -> Self {
        Self {
            destination: REGISTRY_SERVICE.to_string(),
            // PANIC: the registry root is a compile-time constant valid path.
            path: OwnedObjectPath::try_from(REGISTRY_ROOT_PATH)
                .expect("the AT-SPI registry root is a valid object path"),
        }
    }
}

/// What one focus search found: the application that owns the focus, and the
/// control inside it that has it.
struct FocusedTarget {
    application: Accessible,
    element: Accessible,
}

/// Whether the accessibility stack is running at all. This is a property read
/// on the session bus, not a permission prompt: Linux has no per-application
/// accessibility grant, and an application that has not opted in simply
/// publishes no accessibles.
pub(crate) fn accessibility_access() -> AccessibilityAccess {
    let Ok(session) = Connection::session() else {
        return AccessibilityAccess::Unsupported;
    };
    match property::<bool>(
        &session,
        A11Y_BUS_SERVICE,
        A11Y_BUS_PATH,
        A11Y_STATUS_INTERFACE,
        "IsEnabled",
    ) {
        Ok(true) => AccessibilityAccess::Granted,
        Ok(false) => AccessibilityAccess::Denied,
        Err(_) => AccessibilityAccess::Unsupported,
    }
}

/// Reads the sources whose value is only true at record start: the selection the
/// user is looking at. Clipboard recency has no AT-SPI primitive, so the
/// clipboard is reported unsupported instead of stale.
///
/// This already runs on the capture worker, so it walks inline; the caller's
/// join is the bound.
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

    if accessibility != AccessibilityAccess::Granted {
        start.selected_text = SourceOutcome::Unavailable(ContextSourceStatus::PermissionDenied);
        return start;
    }

    start.selected_text = match connection().and_then(|connection| {
        focused_target(&connection, deadline).map(|target| (connection, target))
    }) {
        Ok((connection, target)) => read_selection(&connection, &target.element, deadline),
        Err(status) => SourceOutcome::Unavailable(status),
    };
    start
}

/// Reads the focused application and the control the text is about to land in.
/// Called immediately before the step that consumes the context, on the thread
/// that renders the prompt, so the whole walk is handed to a bounded worker.
pub(crate) fn read_application(
    policy: ContextPolicy,
    options: CaptureOptions,
    captured_at_ms: u64,
    deadline: CaptureDeadline,
) -> ApplicationCapture {
    let wants_focused_field = policy.wants_focused_field();
    bounded(
        "sona-context-atspi",
        super::CAPTURE_JOIN_TIMEOUT,
        move || read_application_now(wants_focused_field, options, captured_at_ms, deadline),
    )
    .unwrap_or_else(|| ApplicationCapture {
        captured_at_ms: Some(captured_at_ms),
        target: SourceOutcome::Unavailable(ContextSourceStatus::Failed),
        focused_field: unavailable_when(wants_focused_field, ContextSourceStatus::Failed),
        browser_url: SourceOutcome::Unavailable(url_status(options)),
        ..ApplicationCapture::default()
    })
}

/// Reads the current selection for an explicit user action. Independent of the
/// ambient policy: the caller's shortcut is the request.
pub(crate) fn capture_selected_text() -> SelectionCapture {
    if accessibility_access() != AccessibilityAccess::Granted {
        return SelectionCapture::Unavailable(ContextSourceStatus::PermissionDenied);
    }
    let outcome = bounded(
        "sona-selection-atspi",
        super::CAPTURE_JOIN_TIMEOUT,
        move || {
            let deadline = CaptureDeadline::starting_now();
            match connection().and_then(|connection| {
                focused_target(&connection, deadline).map(|target| (connection, target))
            }) {
                Ok((connection, target)) => read_selection(&connection, &target.element, deadline),
                Err(status) => SourceOutcome::Unavailable(status),
            }
        },
    );
    match outcome {
        Some(SourceOutcome::Captured(text)) => SelectionCapture::Captured(text),
        Some(SourceOutcome::Unavailable(status)) => SelectionCapture::Unavailable(status),
        None => SelectionCapture::Unavailable(ContextSourceStatus::Failed),
    }
}

/// The focused application's accessible name, lowercased. AT-SPI publishes no
/// bundle identifier, and this name is what every toolkit registers itself
/// under, so it is the stable identity mode rules can match.
///
/// Mode activation calls this on the keypress path, so the walk runs on a worker
/// under a join short enough that a wedged desktop costs a missed rule rather
/// than a late recording.
pub(crate) fn frontmost_application_identifier() -> Option<String> {
    /// Shorter than a capture's join: a rule that cannot be resolved this
    /// quickly must fall back to the active mode instead of delaying the start.
    const IDENTITY_JOIN_TIMEOUT: Duration = Duration::from_millis(120);

    if accessibility_access() != AccessibilityAccess::Granted {
        return None;
    }
    bounded("sona-identity-atspi", IDENTITY_JOIN_TIMEOUT, || {
        let deadline = CaptureDeadline::starting_now();
        let connection = connection().ok()?;
        let target = focused_target(&connection, deadline).ok()?;
        application_name(&connection, &target.application, deadline)
    })
    .flatten()
    .map(|name| name.to_lowercase())
}

fn read_application_now(
    wants_focused_field: bool,
    options: CaptureOptions,
    captured_at_ms: u64,
    deadline: CaptureDeadline,
) -> ApplicationCapture {
    let mut capture = ApplicationCapture {
        captured_at_ms: Some(captured_at_ms),
        // Opting out of URL capture is a user setting, not an absent source, and
        // an opted-in user is told the platform cannot answer instead.
        browser_url: SourceOutcome::Unavailable(url_status(options)),
        ..ApplicationCapture::default()
    };

    let found = connection()
        .and_then(|connection| focused_target(&connection, deadline).map(|t| (connection, t)));
    let (connection, target) = match found {
        Ok(found) => found,
        Err(status) => {
            capture.target = SourceOutcome::Unavailable(status);
            capture.focused_field = unavailable_when(wants_focused_field, status);
            return capture;
        }
    };

    let name = application_name(&connection, &target.application, deadline);
    capture.application_identifier = name.as_deref().map(str::to_lowercase);
    capture.application_name = name;
    capture.target = SourceOutcome::read(capture.application_identifier.clone());

    if !wants_focused_field {
        return capture;
    }

    if is_secure_field(&connection, &target.element, deadline) {
        // Do not ask a masked control for its text. AT-SPI would hand it to any
        // client on the accessibility bus; Sona never asks for it.
        capture.focused_field = SourceOutcome::Unavailable(ContextSourceStatus::SecureField);
        return capture;
    }

    capture.focused_field_name = accessible_name(&connection, &target.element, deadline);
    capture.focused_field = match call::<String>(
        &connection,
        &target.element,
        TEXT_INTERFACE,
        "GetText",
        &WHOLE_TEXT,
        deadline,
    ) {
        Ok(text) => SourceOutcome::read(Some(text)),
        // A control with no Text interface answers the D-Bus call with an
        // error. That is the platform saying "this holds no text", which is a
        // successful read of nothing rather than a failure.
        Err(ContextSourceStatus::Failed) => SourceOutcome::Unavailable(ContextSourceStatus::Empty),
        Err(status) => SourceOutcome::Unavailable(status),
    };
    capture
}

/// The AT-SPI2 bus connection, kept for the process once one succeeds. A failed
/// attempt is not cached: the accessibility bus can start after Sona did.
fn connection() -> Result<Connection, ContextSourceStatus> {
    static A11Y_BUS: OnceLock<Connection> = OnceLock::new();

    if let Some(connection) = A11Y_BUS.get() {
        return Ok(connection.clone());
    }
    let session = Connection::session().map_err(|_| ContextSourceStatus::Unsupported)?;
    let address: String = session
        .call_method(
            Some(A11Y_BUS_SERVICE),
            A11Y_BUS_PATH,
            Some(A11Y_BUS_INTERFACE),
            "GetAddress",
            &(),
        )
        .and_then(|reply| reply.body().deserialize())
        .map_err(|_| ContextSourceStatus::Unsupported)?;
    let connection = zbus::blocking::connection::Builder::address(address.as_str())
        .and_then(|builder| builder.build())
        .map_err(|_| ContextSourceStatus::Unsupported)?;
    Ok(A11Y_BUS.get_or_init(|| connection).clone())
}

/// Walks from the registry root to the control that holds the focus.
///
/// AT-SPI publishes focus as an event, not as a queryable property, so a
/// one-shot read has to find it: the active window of each running application,
/// then the focused descendant inside it. Both the deadline and
/// [`MAX_VISITED_ACCESSIBLES`] bound the walk.
fn focused_target(
    connection: &Connection,
    deadline: CaptureDeadline,
) -> Result<FocusedTarget, ContextSourceStatus> {
    let mut visits = 0;
    let applications = children(connection, &Accessible::root(), deadline, &mut visits)?;

    for application in applications {
        for window in children(connection, &application, deadline, &mut visits)? {
            if !has_state(connection, &window, STATE_ACTIVE, deadline)? {
                continue;
            }
            if let Some(element) = focused_descendant(connection, &window, deadline, &mut visits)? {
                return Ok(FocusedTarget {
                    application,
                    element,
                });
            }
            // The active window is the right application even when no
            // descendant claims the focus, so the window itself answers.
            return Ok(FocusedTarget {
                application,
                element: window,
            });
        }
    }
    Err(ContextSourceStatus::Empty)
}

/// Depth-first search for the focused control under an active window. Only
/// showing subtrees are entered: a hidden tab's widgets cannot hold the focus,
/// and skipping them is what keeps the walk inside its budget.
fn focused_descendant(
    connection: &Connection,
    window: &Accessible,
    deadline: CaptureDeadline,
    visits: &mut usize,
) -> Result<Option<Accessible>, ContextSourceStatus> {
    let mut pending = children(connection, window, deadline, visits)?;
    while let Some(candidate) = pending.pop() {
        if has_state(connection, &candidate, STATE_FOCUSED, deadline)? {
            return Ok(Some(candidate));
        }
        if !has_state(connection, &candidate, STATE_SHOWING, deadline)? {
            continue;
        }
        pending.extend(children(connection, &candidate, deadline, visits)?);
    }
    Ok(None)
}

fn children(
    connection: &Connection,
    accessible: &Accessible,
    deadline: CaptureDeadline,
    visits: &mut usize,
) -> Result<Vec<Accessible>, ContextSourceStatus> {
    if *visits >= MAX_VISITED_ACCESSIBLES {
        return Err(ContextSourceStatus::Failed);
    }
    *visits += 1;
    let children: Vec<(String, OwnedObjectPath)> = call(
        connection,
        accessible,
        ACCESSIBLE_INTERFACE,
        "GetChildren",
        &(),
        deadline,
    )?;
    Ok(children
        .into_iter()
        .map(|(destination, path)| Accessible { destination, path })
        .collect())
}

fn has_state(
    connection: &Connection,
    accessible: &Accessible,
    state: u32,
    deadline: CaptureDeadline,
) -> Result<bool, ContextSourceStatus> {
    let states: Vec<u32> = call(
        connection,
        accessible,
        ACCESSIBLE_INTERFACE,
        "GetState",
        &(),
        deadline,
    )?;
    // The state set is a bitfield split across 32-bit words, low word first.
    let word = usize::try_from(state / 32).unwrap_or(usize::MAX);
    Ok(states
        .get(word)
        .is_some_and(|bits| bits & (1 << (state % 32)) != 0))
}

/// Any failure counts as secure: reading a control that cannot say whether it
/// masks its text is exactly what this gate exists to prevent.
fn is_secure_field(
    connection: &Connection,
    accessible: &Accessible,
    deadline: CaptureDeadline,
) -> bool {
    call::<String>(
        connection,
        accessible,
        ACCESSIBLE_INTERFACE,
        "GetRoleName",
        &(),
        deadline,
    )
    .map_or(true, |role| role == PASSWORD_ROLE_NAME)
}

fn read_selection(
    connection: &Connection,
    accessible: &Accessible,
    deadline: CaptureDeadline,
) -> SourceOutcome {
    if is_secure_field(connection, accessible, deadline) {
        return SourceOutcome::Unavailable(ContextSourceStatus::SecureField);
    }
    let selections: i32 = match call(
        connection,
        accessible,
        TEXT_INTERFACE,
        "GetNSelections",
        &(),
        deadline,
    ) {
        Ok(selections) => selections,
        // No Text interface, so there is nothing selected to read.
        Err(ContextSourceStatus::Failed) => return SourceOutcome::read(None),
        Err(status) => return SourceOutcome::Unavailable(status),
    };
    if selections <= 0 {
        return SourceOutcome::read(None);
    }

    let range: (i32, i32) = match call(
        connection,
        accessible,
        TEXT_INTERFACE,
        "GetSelection",
        &0i32,
        deadline,
    ) {
        Ok(range) => range,
        Err(status) => return SourceOutcome::Unavailable(status),
    };
    match call::<String>(
        connection,
        accessible,
        TEXT_INTERFACE,
        "GetText",
        &range,
        deadline,
    ) {
        Ok(text) => SourceOutcome::read(Some(text)),
        Err(status) => SourceOutcome::Unavailable(status),
    }
}

fn accessible_name(
    connection: &Connection,
    accessible: &Accessible,
    deadline: CaptureDeadline,
) -> Option<String> {
    if !deadline.may_start_read() {
        return None;
    }
    let name = property::<String>(
        connection,
        &accessible.destination,
        accessible.path.as_str(),
        ACCESSIBLE_INTERFACE,
        "Name",
    )
    .ok()?;
    (!name.trim().is_empty()).then_some(name)
}

fn application_name(
    connection: &Connection,
    application: &Accessible,
    deadline: CaptureDeadline,
) -> Option<String> {
    accessible_name(connection, application, deadline)
}

/// The one place a cross-process read starts, and therefore the one place the
/// capture's budget is spent. D-Bus offers no per-request timeout, so the
/// remaining time is a permission to start another read rather than a bound on
/// this one; the caller's join bounds the group.
fn call<T>(
    connection: &Connection,
    accessible: &Accessible,
    interface: &str,
    method: &str,
    body: &(impl serde::Serialize + DynamicType),
    deadline: CaptureDeadline,
) -> Result<T, ContextSourceStatus>
where
    T: for<'a> Deserialize<'a> + Type,
{
    if !deadline.may_start_read() {
        // Out of budget. Failed is the status for a source that did not answer
        // in time, whether the target stalled or an earlier source spent the
        // time. Every remaining read lands here too, so the capture returns
        // what it already has.
        return Err(ContextSourceStatus::Failed);
    }
    connection
        .call_method(
            Some(accessible.destination.as_str()),
            accessible.path.as_str(),
            Some(interface),
            method,
            body,
        )
        .and_then(|reply| reply.body().deserialize())
        .map_err(|_| ContextSourceStatus::Failed)
}

fn property<T>(
    connection: &Connection,
    destination: &str,
    path: &str,
    interface: &str,
    name: &str,
) -> Result<T, ContextSourceStatus>
where
    T: TryFrom<OwnedValue>,
{
    let reply = connection
        .call_method(
            Some(destination),
            path,
            Some(PROPERTIES_INTERFACE),
            "Get",
            &(interface, name),
        )
        .map_err(|_| ContextSourceStatus::Failed)?;
    let value: OwnedValue = reply
        .body()
        .deserialize()
        .map_err(|_| ContextSourceStatus::Failed)?;
    T::try_from(value).map_err(|_| ContextSourceStatus::Failed)
}

fn url_status(options: CaptureOptions) -> ContextSourceStatus {
    if options.url_capture_enabled {
        ContextSourceStatus::Unsupported
    } else {
        ContextSourceStatus::Disabled
    }
}

fn unavailable_when(requested: bool, status: ContextSourceStatus) -> SourceOutcome {
    SourceOutcome::Unavailable(if requested {
        status
    } else {
        ContextSourceStatus::NotRequested
    })
}

/// Runs one AT-SPI walk on a short-lived worker and joins under a bound. A
/// wedged accessibility peer abandons the worker instead of holding the thread
/// the user is waiting on.
fn bounded<T: Send + 'static>(
    name: &str,
    join: Duration,
    work: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::Builder::new()
        .name(name.to_string())
        .spawn(move || {
            let _ = sender.send(work());
        })
        .ok()?;
    receiver.recv_timeout(join).ok()
}
