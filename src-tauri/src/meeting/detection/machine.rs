//! The whole decision authority for automatic meeting detection.
//!
//! Every rule from the detection brief's §5.3 decision table, §5.4 prompt copy,
//! and §5.5 auto-stop heuristic lives here as pure functions over owned inputs.
//! Nothing in this module reads the clock, the calendar, the audio device, or
//! settings; the runtime in the parent module collects those and hands them in.
//! That split is deliberate: the platform observers are untestable in CI, and
//! the policy they feed is the part that decides whether Sona records a user's
//! meeting, so the policy is the part that must be exhaustively tested.
//!
//! Two invariants this module owns, and no other layer may re-decide:
//!
//! 1. **A detection outcome is never a capture grant.** The strongest outcome is
//!    `AutoStart`, which still routes through the preflight consent screen. The
//!    session layer owns the consent receipt; detection has no authority to
//!    forge one.
//! 2. **Sona's own microphone is never meeting evidence.** The CoreAudio
//!    device-in-use property is device-global, so dictation and Sona's own
//!    meeting capture both raise it. Reading that as a meeting would make every
//!    push-to-talk run prompt "meeting detected".

use serde::{Deserialize, Serialize};
use specta::Type;

/// Calendar lead time for the pre-meeting prompt. The brief fixes this at T-60s.
pub const CALENDAR_LEAD_SECONDS: i64 = 60;

/// Attendee floor for the calendar path. An event with fewer participants is a
/// personal blocked-time entry, not a meeting.
pub const ATTENDEE_FLOOR: usize = 2;

/// How long a just-started capture keeps absorbing new ad-hoc activity instead
/// of spawning a second note (§5.3 case 8).
pub const CROSS_LINK_WINDOW_MS: i64 = 15 * 60 * 1000;

/// How close two captures of the same app must be before Sona offers to merge
/// them. Outside this window a microphone gap is a meeting boundary, full stop —
/// the deliberate inversion of Granola's auto-merge default (§5.5).
pub const MERGE_PROMPT_WINDOW_MS: i64 = 2 * 60 * 1000;

/// Default silence window before auto-stop, in minutes (§5.5 condition 2).
pub const DEFAULT_SILENCE_STOP_MINUTES: u32 = 15;

/// How one participant answered the invitation, as EventKit reports it.
///
/// `EKParticipantStatus` also carries `Delegated`, `Completed` and
/// `InProcess`, which describe reminders and task assignments rather than an
/// answer to a meeting invitation. They collapse into `Unknown` here: the card
/// renders "no answer", which is the true statement, instead of inventing an
/// attendance claim from a task state.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ParticipationStatus {
    /// EventKit has no answer for this participant.
    #[default]
    Unknown,
    Pending,
    Accepted,
    Declined,
    Tentative,
}

/// One named participant on a calendar event.
///
/// Only participants EventKit names reach this type. An unnamed participant is
/// a row that could say nothing but "someone", so it is dropped at the
/// EventKit boundary and counted in `attendee_count` alone.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalendarAttendee {
    pub name: String,
    pub status: ParticipationStatus,
    /// Normalized address from EventKit's `mailto:` participant URL.
    #[serde(default)]
    pub email: Option<String>,
    /// True for the account that owns the calendar this event lives on.
    pub is_self: bool,
}

/// One calendar event, reduced to the fields the pre-meeting surfaces read.
///
/// A qualifying detection durably records these facts in the encrypted
/// workflow-event store before its briefing runs. Accepting the event also
/// copies the same facts onto the meeting session.
/// The decision table reads only `attendee_count` and the two instants.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventSummary {
    /// Identity for this occurrence. Recurring events share `series_key`, but
    /// every start instant gets its own claim and prompt.
    pub event_key: String,
    /// EventKit's calendar-item identifier, used only for standing series
    /// consent and continuity priming.
    #[serde(default)]
    pub series_key: String,
    pub title: String,
    /// Participant count including the organizer, and including participants
    /// EventKit refused to name. Zero means the event carries no attendee list
    /// at all, which §5.3 case 9 treats the same as solo.
    pub attendee_count: usize,
    pub start_utc_ms: i64,
    pub end_utc_ms: i64,
    /// The participants EventKit named. Shorter than `attendee_count` when the
    /// event carries anonymous participants, and empty when it names none.
    #[serde(default)]
    pub attendees: Vec<CalendarAttendee>,
    /// The event's own notes, trimmed. `None` when the event carries none.
    #[serde(default)]
    pub notes: Option<String>,
    /// Title of the calendar the event sits on. `None` when EventKit does not
    /// report one.
    #[serde(default)]
    pub calendar_name: Option<String>,
    /// The URL attached to the event, which for a scheduled call is the join
    /// link. `None` when the event carries none.
    #[serde(default)]
    pub url: Option<String>,
}

/// Where the nearest calendar event sits relative to now.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CalendarSignal {
    /// No event is near, or the calendar path is disabled or unauthorized.
    Absent,
    /// The event has not started yet.
    Upcoming {
        event: CalendarEventSummary,
        seconds_to_start: i64,
    },
    /// The event's start instant has passed and its end has not.
    Started { event: CalendarEventSummary },
}

/// Which application, if any, could own the current microphone activity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AppSignal {
    /// Neither an allowlisted meeting app nor a browser is a candidate.
    Absent,
    /// An allowlisted meeting application is running.
    Known {
        bundle_id: String,
        display_name: String,
        /// True when this app currently receives key events. Not required by any
        /// rule; carried so the prompt can name the app the user is looking at.
        frontmost: bool,
    },
    /// A browser is frontmost and no allowlisted native meeting app is running.
    Browser {
        bundle_id: String,
        display_name: String,
    },
}

/// State of the default input device, as reported by CoreAudio's
/// `kAudioDevicePropertyDeviceIsRunningSomewhere`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MicSignal {
    Idle,
    Active,
}

/// Screen Recording authorization. Only §5.3 case 7 depends on it, and only to
/// gain precision — case 10 requires that it never gate cases 1-5.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScreenRecordingPermission {
    Granted,
    NotGranted,
}

/// What a browser window title says about the tab in front. `Unreadable` is the
/// honest state when Screen Recording is missing: macOS returns window
/// dictionaries with the name field omitted rather than failing the call.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BrowserTitleEvidence {
    MeetingMatch,
    NoMatch,
    Unreadable,
}

/// A capture Sona started recently. Feeds §5.3 case 8 cross-linking and §5.5
/// boundary classification.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecentCapture {
    pub session_id: String,
    /// Bundle ID of the app that triggered it, absent for a manual start.
    pub trigger_bundle_id: Option<String>,
    pub started_utc_ms: i64,
}

/// Everything the decision table reads, collected at one instant.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DetectionInputs {
    pub now_utc_ms: i64,
    pub calendar: CalendarSignal,
    pub app: AppSignal,
    pub mic: MicSignal,
    pub screen_recording: ScreenRecordingPermission,
    pub browser_title: BrowserTitleEvidence,
    /// True only when the session layer found a live standing grant for this
    /// event's series. A visible countdown is context, never consent.
    pub standing_series_consent: bool,
    pub recent_capture: Option<RecentCapture>,
    /// True when Sona itself holds the default input device — its own dictation
    /// run or the microphone lane of its own meeting capture.
    pub self_holds_input_device: bool,
    /// True when a Sona meeting capture is already running.
    pub capture_active: bool,
}

/// Operator-controlled detection behavior. Timing constants live here rather
/// than being read from the consts directly so tests can state them explicitly.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DetectionPolicy {
    pub enabled: bool,
    pub calendar_enabled: bool,
    pub any_mic_activity: bool,
    pub auto_start_on_open_pane: bool,
    pub lead_seconds: i64,
    pub attendee_floor: usize,
    pub cross_link_window_ms: i64,
}

impl Default for DetectionPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            calendar_enabled: false,
            any_mic_activity: false,
            auto_start_on_open_pane: false,
            lead_seconds: CALENDAR_LEAD_SECONDS,
            attendee_floor: ATTENDEE_FLOOR,
            cross_link_window_ms: CROSS_LINK_WINDOW_MS,
        }
    }
}

/// Which prompt to raise, carrying the fields the copy pattern interpolates.
/// The frontend localizes from these fields; the native notification uses the
/// English copy pattern from §5.4 verbatim.
///
/// Exported to TypeScript as `DetectionPromptKind`: bare `PromptKind` would
/// land in bindings.ts beside `PromptPreset` and read as an LLM prompt, which
/// this is not. The rename is specta-only — serde never sees it, so it cannot
/// reach the wire.
///
/// The `rename_all` sits on each variant rather than on the enum. On an enum,
/// a container-level `rename_all` renames the *variants* and leaves their
/// fields alone — so writing it there emitted `{"kind":"appMeeting",
/// "app_name":…}` while the frontend read `{"kind":"AppMeeting","appName":…}`,
/// matched no arm, and rendered a prompt card with no title on it. Per-variant
/// is the placement that renames fields, which is what the rest of this
/// module's camelCase wire shape needs. Pinned by
/// `the_prompt_wire_shape_names_variants_and_camelcases_fields`; specta reads
/// the same per-variant attribute, so the generated union carries the same
/// camelCase fields the wire does.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(tag = "kind")]
#[specta(rename = "DetectionPromptKind")]
pub enum PromptKind {
    /// §5.3 case 3 — "{Event title} starting".
    #[serde(rename_all = "camelCase")]
    CalendarEvent {
        event_key: String,
        event_title: String,
    },
    /// §5.3 case 5 — "{App} meeting detected".
    #[serde(rename_all = "camelCase")]
    AppMeeting { bundle_id: String, app_name: String },
    /// §5.3 case 5, Slack flavor — "{App} huddle detected".
    #[serde(rename_all = "camelCase")]
    AppHuddle { bundle_id: String, app_name: String },
    /// §5.3 case 7 — "Call detected in {Browser}".
    #[serde(rename_all = "camelCase")]
    BrowserCall { bundle_id: String, app_name: String },
    /// §5.3 case 6, behind the opt-in toggle — no app identity to name.
    UnknownMicSource,
}

impl PromptKind {
    /// The §5.4 copy pattern, in English. Native notifications are delivered by
    /// the OS from a Rust string, so they cannot go through the frontend's
    /// i18next catalog; the in-app pane renders localized copy from the fields.
    pub fn notification_title(&self) -> String {
        match self {
            Self::CalendarEvent { event_title, .. } => format!("{event_title} starting"),
            Self::AppMeeting { app_name, .. } => format!("{app_name} meeting detected"),
            Self::AppHuddle { app_name, .. } => format!("{app_name} huddle detected"),
            Self::BrowserCall { app_name, .. } => format!("Call detected in {app_name}"),
            Self::UnknownMicSource => "Microphone activity detected".to_string(),
        }
    }

    /// Title proposed for the meeting the prompt would create.
    pub fn proposed_meeting_title(&self) -> String {
        match self {
            Self::CalendarEvent { event_title, .. } => event_title.clone(),
            Self::AppMeeting { app_name, .. } | Self::AppHuddle { app_name, .. } => {
                format!("{app_name} meeting")
            }
            Self::BrowserCall { app_name, .. } => format!("Call in {app_name}"),
            Self::UnknownMicSource => crate::meeting::types::MANUAL_DEFAULT_TITLE.to_string(),
        }
    }

    /// Bundle ID of the app the prompt is about, when there is one.
    pub fn bundle_id(&self) -> Option<&str> {
        match self {
            Self::AppMeeting { bundle_id, .. }
            | Self::AppHuddle { bundle_id, .. }
            | Self::BrowserCall { bundle_id, .. } => Some(bundle_id),
            Self::CalendarEvent { .. } | Self::UnknownMicSource => None,
        }
    }
}

/// Why detection stayed quiet. Carried into the status event so the operator can
/// see what detection is doing instead of guessing at silence.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SuppressReason {
    /// Master toggle is off.
    DetectionDisabled,
    /// Sona's own microphone is what went active.
    SonaHoldsInputDevice,
    /// A capture is already running and nothing needs cross-linking.
    CaptureAlreadyActive,
    /// §5.3 case 4 — an app is open but nothing is listening yet.
    NoQualifyingSignal,
    /// §5.3 case 9 — solo focus block, or an event with no attendee list.
    AttendeeFloorNotMet,
    /// §5.3 case 6 — mic active with no identifiable meeting app.
    UnknownMicSource,
    /// §5.3 case 7b — a browser is in front but its title cannot be read.
    BrowserTitleUnreadable,
    /// §5.3 case 7 — a browser is in front and its title is not a meeting.
    BrowserTitleNotMeeting,
}

/// The decision table's output. Exactly one of these per evaluation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DetectionOutcome {
    Suppress(SuppressReason),
    /// §5.3 case 1 — countdown only, no capture and no notification.
    ///
    /// Carries the whole event rather than a copy of two of its fields: the
    /// pre-meeting card renders every fact the calendar supplied, and a
    /// flattened copy here would be a second place for those facts to drift.
    Countdown {
        event: CalendarEventSummary,
        seconds_to_start: i64,
    },
    /// §5.3 case 2 — a live standing series grant authorizes this occurrence.
    /// The session layer revalidates that grant atomically with the start.
    AutoStart {
        event_key: String,
        event_title: String,
    },
    /// §5.3 cases 3, 5, 6, 7 — raise a notification and wait for a click.
    Prompt(PromptKind),
    /// §5.3 case 8 — attach this activity to the capture already open.
    CrossLink {
        session_id: String,
    },
}

/// The one entry point. Applies §5.3 in the table's own order.
pub fn evaluate(inputs: &DetectionInputs, policy: &DetectionPolicy) -> DetectionOutcome {
    if !policy.enabled {
        return DetectionOutcome::Suppress(SuppressReason::DetectionDisabled);
    }

    // Invariant 2. A capture in progress legitimately holds the device, so this
    // only fires for a dictation run or a stale lease — never mistake either for
    // someone else's meeting.
    if inputs.self_holds_input_device && !inputs.capture_active {
        return DetectionOutcome::Suppress(SuppressReason::SonaHoldsInputDevice);
    }

    if inputs.capture_active {
        return cross_link_or_suppress(inputs, policy);
    }

    // The calendar path runs first because a scheduled event is stronger
    // evidence than an app being open, and because case 1's countdown must win
    // over any ad-hoc prompt for the same moment.
    let calendar_reason = match calendar_path(inputs, policy) {
        CalendarPath::Decided(outcome) => return outcome,
        CalendarPath::Ineligible(reason) => reason,
    };

    let ad_hoc = ad_hoc_path(inputs, policy);
    // When the calendar actively declined and the ad-hoc path also stayed quiet,
    // report the calendar's reason. It is the one the operator cannot infer: an
    // event is what they expect detection to catch, and "solo event" explains the
    // silence where a generic ad-hoc reason does not.
    match (calendar_reason, ad_hoc) {
        (Some(reason), DetectionOutcome::Suppress(_)) => DetectionOutcome::Suppress(reason),
        (_, outcome) => outcome,
    }
}

/// Outcome of consulting the calendar half of the table.
enum CalendarPath {
    Decided(DetectionOutcome),
    /// The calendar had nothing to say. `Some(reason)` when it actively declined
    /// and that reason is more informative than the ad-hoc path's silence.
    Ineligible(Option<SuppressReason>),
}

/// §5.3 cases 1, 2, 3, and 9.
fn calendar_path(inputs: &DetectionInputs, policy: &DetectionPolicy) -> CalendarPath {
    if !policy.calendar_enabled {
        return CalendarPath::Ineligible(None);
    }

    let (event, seconds_to_start) = match &inputs.calendar {
        CalendarSignal::Absent => return CalendarPath::Ineligible(None),
        CalendarSignal::Upcoming {
            event,
            seconds_to_start,
        } => (event, Some(*seconds_to_start)),
        CalendarSignal::Started { event } => (event, None),
    };

    // Case 9. A solo block never prompts from the calendar path, but it must not
    // shadow the ad-hoc path: a one-attendee event with Zoom open and the mic
    // live is still a meeting case 5 should catch.
    if event.attendee_count < policy.attendee_floor {
        return CalendarPath::Ineligible(Some(SuppressReason::AttendeeFloorNotMet));
    }

    match seconds_to_start {
        // Case 1. Countdown only, no capture.
        Some(seconds) if seconds <= policy.lead_seconds => {
            CalendarPath::Decided(DetectionOutcome::Countdown {
                event: event.clone(),
                seconds_to_start: seconds,
            })
        }
        // Further out than the lead window: nothing to show yet.
        Some(_) => CalendarPath::Ineligible(None),
        None => CalendarPath::Decided(started_event_outcome(inputs, policy, event)),
    }
}

/// §5.3 cases 2 and 3, for an event whose start instant has passed.
fn started_event_outcome(
    inputs: &DetectionInputs,
    _policy: &DetectionPolicy,
    event: &CalendarEventSummary,
) -> DetectionOutcome {
    if inputs.mic != MicSignal::Active {
        // Scheduled but nobody is talking yet. The countdown already told the
        // operator; a second prompt for an event that may not happen is noise.
        return DetectionOutcome::Suppress(SuppressReason::NoQualifyingSignal);
    }

    // Case 2. Detection can cite a standing series grant, but cannot construct
    // consent itself. The session manager revalidates the grant when it writes
    // the per-attempt receipt.
    if inputs.standing_series_consent {
        return DetectionOutcome::AutoStart {
            event_key: event.event_key.clone(),
            event_title: event.title.clone(),
        };
    }

    // Case 3. No standing grant: prompt, never silent-start.
    DetectionOutcome::Prompt(PromptKind::CalendarEvent {
        event_key: event.event_key.clone(),
        event_title: event.title.clone(),
    })
}

/// §5.3 cases 4, 5, 6, 7, and 7b, for activity with no matching event.
fn ad_hoc_path(inputs: &DetectionInputs, policy: &DetectionPolicy) -> DetectionOutcome {
    // Case 4. An open meeting app is not evidence on its own — otherwise every
    // trip to Zoom's settings raises a prompt.
    if inputs.mic != MicSignal::Active {
        return DetectionOutcome::Suppress(SuppressReason::NoQualifyingSignal);
    }

    match &inputs.app {
        // Case 5.
        AppSignal::Known {
            bundle_id,
            display_name,
            ..
        } => DetectionOutcome::Prompt(known_app_prompt(bundle_id, display_name)),
        // Cases 7 and 7b.
        AppSignal::Browser {
            bundle_id,
            display_name,
        } => browser_outcome(inputs, policy, bundle_id, display_name),
        // Case 6.
        AppSignal::Absent => any_mic_outcome(policy, SuppressReason::UnknownMicSource),
    }
}

/// Slack's huddle is a mode inside the app rather than a separate process, so
/// the copy follows the bundle ID rather than any huddle-specific API.
fn known_app_prompt(bundle_id: &str, display_name: &str) -> PromptKind {
    if bundle_id.eq_ignore_ascii_case(SLACK_BUNDLE_ID) {
        return PromptKind::AppHuddle {
            bundle_id: bundle_id.to_string(),
            app_name: display_name.to_string(),
        };
    }
    PromptKind::AppMeeting {
        bundle_id: bundle_id.to_string(),
        app_name: display_name.to_string(),
    }
}

pub(crate) const SLACK_BUNDLE_ID: &str = "com.tinyspeck.slackmacgap";

/// §5.3 cases 7 and 7b. Both non-matching outcomes fall through to case 6's
/// opt-in toggle rather than hard-suppressing, which is what 7b prescribes: the
/// browser case degrades to "any mic activity" instead of blocking on a
/// Screen Recording request the core feature must never depend on.
fn browser_outcome(
    inputs: &DetectionInputs,
    policy: &DetectionPolicy,
    bundle_id: &str,
    display_name: &str,
) -> DetectionOutcome {
    let title_readable = inputs.screen_recording == ScreenRecordingPermission::Granted;
    match (title_readable, inputs.browser_title) {
        (true, BrowserTitleEvidence::MeetingMatch) => {
            DetectionOutcome::Prompt(PromptKind::BrowserCall {
                bundle_id: bundle_id.to_string(),
                app_name: display_name.to_string(),
            })
        }
        (true, BrowserTitleEvidence::NoMatch) => {
            any_mic_outcome(policy, SuppressReason::BrowserTitleNotMeeting)
        }
        // Permission missing, or present but the title came back empty anyway.
        (_, _) => any_mic_outcome(policy, SuppressReason::BrowserTitleUnreadable),
    }
}

/// The opt-in escape hatch. Off by default because voice memos, music
/// production, and every other audio app land here.
fn any_mic_outcome(policy: &DetectionPolicy, reason: SuppressReason) -> DetectionOutcome {
    if policy.any_mic_activity {
        return DetectionOutcome::Prompt(PromptKind::UnknownMicSource);
    }
    DetectionOutcome::Suppress(reason)
}

/// §5.3 case 8. New activity during a still-open capture joins that capture
/// rather than starting a second note.
fn cross_link_or_suppress(inputs: &DetectionInputs, policy: &DetectionPolicy) -> DetectionOutcome {
    if inputs.mic != MicSignal::Active {
        return DetectionOutcome::Suppress(SuppressReason::CaptureAlreadyActive);
    }
    let Some(recent) = &inputs.recent_capture else {
        return DetectionOutcome::Suppress(SuppressReason::CaptureAlreadyActive);
    };
    let elapsed = inputs.now_utc_ms.saturating_sub(recent.started_utc_ms);
    if !(0..=policy.cross_link_window_ms).contains(&elapsed) {
        return DetectionOutcome::Suppress(SuppressReason::CaptureAlreadyActive);
    }
    DetectionOutcome::CrossLink {
        session_id: recent.session_id.clone(),
    }
}

/// Everything §5.5's auto-stop heuristic reads.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StopInputs {
    pub now_utc_ms: i64,
    /// Scheduled end of the calendar event this capture is linked to.
    pub linked_event_end_utc_ms: Option<i64>,
    /// Last instant transcript-worthy audio was observed, or `None` when no
    /// voiced-activity clock is available.
    ///
    /// This is `Option` rather than a defaulted timestamp on purpose. Meeting
    /// transcription in this codebase runs after capture ends, so during a
    /// capture nothing publishes "someone spoke just now". Substituting a proxy
    /// that only looks like voice — packet flow, elapsed time, an app becoming
    /// frontmost — would auto-stop a live meeting at minute N, which is a far
    /// worse failure than never auto-stopping. `None` makes the silence rule
    /// inapplicable instead of wrong, and the operator's status says so.
    pub last_voiced_utc_ms: Option<i64>,
    /// True while Sona's own capture holds the default input device. When it is
    /// true, the device-in-use property says nothing about the meeting app: Sona
    /// is the process keeping it raised.
    pub self_holds_input_device: bool,
    pub device_running_somewhere: bool,
    /// True while the process that triggered this capture is still running.
    pub trigger_app_running: bool,
    /// Set once the host crossed a sleep boundary during this capture.
    pub slept_since_start: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StopPolicy {
    /// Zero disables the silence stop, leaving manual stop as the only timer.
    /// Only consulted when a voiced-activity clock exists.
    pub silence_stop_minutes: u32,
}

impl Default for StopPolicy {
    fn default() -> Self {
        Self {
            silence_stop_minutes: DEFAULT_SILENCE_STOP_MINUTES,
        }
    }
}

/// Why a capture ended by itself. Manual stop is not in this list: it stays the
/// primary path and does not go through the heuristic at all.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum StopTrigger {
    /// §5.5 condition 4.
    SleepBoundary,
    /// §5.5 condition 1.
    EventEnd,
    /// §5.5 condition 3, observable variant: the triggering app quit.
    TriggerAppExited,
    /// §5.5 condition 3 proper: the input device went idle. Only meaningful when
    /// Sona is not itself the process holding the device.
    InputDeviceIdle,
    /// §5.5 condition 2.
    Silence,
}

impl StopTrigger {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SleepBoundary => "sleep_boundary",
            Self::EventEnd => "event_end",
            Self::TriggerAppExited => "trigger_app_exited",
            Self::InputDeviceIdle => "input_device_idle",
            Self::Silence => "silence",
        }
    }
}

/// Definitive causes first, the silence timer last. A sleep boundary or a
/// scheduled end is a fact; silence is an inference that a long pause is over.
pub fn evaluate_stop(inputs: &StopInputs, policy: &StopPolicy) -> Option<StopTrigger> {
    if inputs.slept_since_start {
        return Some(StopTrigger::SleepBoundary);
    }
    if inputs
        .linked_event_end_utc_ms
        .is_some_and(|end| inputs.now_utc_ms >= end)
    {
        return Some(StopTrigger::EventEnd);
    }
    if !inputs.trigger_app_running {
        return Some(StopTrigger::TriggerAppExited);
    }
    if !inputs.self_holds_input_device && !inputs.device_running_somewhere {
        return Some(StopTrigger::InputDeviceIdle);
    }
    if let (true, Some(last_voiced_utc_ms)) =
        (policy.silence_stop_minutes > 0, inputs.last_voiced_utc_ms)
    {
        let window_ms = i64::from(policy.silence_stop_minutes) * 60_000;
        if inputs.now_utc_ms.saturating_sub(last_voiced_utc_ms) >= window_ms {
            return Some(StopTrigger::Silence);
        }
    }
    None
}

/// What a microphone gap means for the next capture (§5.5's inversion of
/// Granola's auto-merge default).
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReactivationBoundary {
    /// The default. A gap ends the previous meeting.
    NewMeeting,
    /// Close in time and the same app: offer a merge, never perform one.
    MergePrompt { previous_session_id: String },
}

/// Auto-merge is never an outcome here. Granola's own docs call its auto-merge a
/// bug users work around by splitting notes afterwards; splitting a transcript
/// after the fact is strictly harder than joining two, so the cheap error is the
/// one to make.
pub fn classify_reactivation(
    previous: &RecentCapture,
    now_utc_ms: i64,
    trigger_bundle_id: Option<&str>,
) -> ReactivationBoundary {
    let gap = now_utc_ms.saturating_sub(previous.started_utc_ms);
    let same_app = match (&previous.trigger_bundle_id, trigger_bundle_id) {
        (Some(previous_id), Some(current_id)) => previous_id.eq_ignore_ascii_case(current_id),
        _ => false,
    };
    if same_app && (0..=MERGE_PROMPT_WINDOW_MS).contains(&gap) {
        return ReactivationBoundary::MergePrompt {
            previous_session_id: previous.session_id.clone(),
        };
    }
    ReactivationBoundary::NewMeeting
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_700_000_000_000;

    fn event(attendee_count: usize) -> CalendarEventSummary {
        CalendarEventSummary {
            event_key: "event-1".to_string(),
            series_key: "series-1".to_string(),
            title: "Quarterly planning".to_string(),
            attendee_count,
            start_utc_ms: NOW,
            end_utc_ms: NOW + 30 * 60_000,
            attendees: Vec::new(),
            notes: None,
            calendar_name: None,
            url: None,
        }
    }

    fn inputs() -> DetectionInputs {
        DetectionInputs {
            now_utc_ms: NOW,
            calendar: CalendarSignal::Absent,
            app: AppSignal::Absent,
            mic: MicSignal::Idle,
            screen_recording: ScreenRecordingPermission::NotGranted,
            browser_title: BrowserTitleEvidence::Unreadable,
            standing_series_consent: false,
            recent_capture: None,
            self_holds_input_device: false,
            capture_active: false,
        }
    }

    fn calendar_policy() -> DetectionPolicy {
        DetectionPolicy {
            calendar_enabled: true,
            ..DetectionPolicy::default()
        }
    }

    fn zoom() -> AppSignal {
        AppSignal::Known {
            bundle_id: "us.zoom.xos".to_string(),
            display_name: "Zoom".to_string(),
            frontmost: true,
        }
    }

    fn chrome() -> AppSignal {
        AppSignal::Browser {
            bundle_id: "com.google.chrome".to_string(),
            display_name: "Chrome".to_string(),
        }
    }

    /* The frontend mirrors this enum by hand in
     * src/components/settings/meetings/detectionStore.ts, because the prompt
     * leaves through a raw `app.emit` rather than a tauri_specta Event and so
     * never reaches bindings.ts. That hand mirror is only as good as this
     * shape, and when the two drifted the pane rendered prompt cards with no
     * title on them — a card offering to record something it could not name.
     * Pinning the bytes is what makes the next drift a test failure. */
    #[test]
    fn the_prompt_wire_shape_names_variants_and_camelcases_fields() {
        let wire = |prompt: &PromptKind| serde_json::to_value(prompt).expect("prompt serializes");

        assert_eq!(
            wire(&PromptKind::CalendarEvent {
                event_key: "event-1".to_string(),
                event_title: "Quarterly planning".to_string(),
            }),
            serde_json::json!({
                "kind": "CalendarEvent",
                "eventKey": "event-1",
                "eventTitle": "Quarterly planning",
            })
        );
        assert_eq!(
            wire(&PromptKind::AppMeeting {
                bundle_id: "us.zoom.xos".to_string(),
                app_name: "Zoom".to_string(),
            }),
            serde_json::json!({
                "kind": "AppMeeting",
                "bundleId": "us.zoom.xos",
                "appName": "Zoom",
            })
        );
        assert_eq!(
            wire(&PromptKind::AppHuddle {
                bundle_id: "com.tinyspeck.slackmacgap".to_string(),
                app_name: "Slack".to_string(),
            }),
            serde_json::json!({
                "kind": "AppHuddle",
                "bundleId": "com.tinyspeck.slackmacgap",
                "appName": "Slack",
            })
        );
        assert_eq!(
            wire(&PromptKind::BrowserCall {
                bundle_id: "com.google.chrome".to_string(),
                app_name: "Chrome".to_string(),
            }),
            serde_json::json!({
                "kind": "BrowserCall",
                "bundleId": "com.google.chrome",
                "appName": "Chrome",
            })
        );
        assert_eq!(
            wire(&PromptKind::UnknownMicSource),
            serde_json::json!({ "kind": "UnknownMicSource" })
        );
    }

    /* §5.3 case 1 — event within T-60s, >=2 attendees: countdown, no capture. */
    #[test]
    fn case_1_upcoming_event_shows_countdown_without_capture() {
        let outcome = evaluate(
            &DetectionInputs {
                calendar: CalendarSignal::Upcoming {
                    event: event(4),
                    seconds_to_start: 45,
                },
                ..inputs()
            },
            &calendar_policy(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Countdown {
                event: event(4),
                seconds_to_start: 45,
            }
        );
    }

    #[test]
    fn case_1_event_beyond_lead_window_stays_quiet() {
        let outcome = evaluate(
            &DetectionInputs {
                calendar: CalendarSignal::Upcoming {
                    event: event(4),
                    seconds_to_start: 61,
                },
                ..inputs()
            },
            &calendar_policy(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Suppress(SuppressReason::NoQualifyingSignal)
        );
    }

    /* §5.3 case 2 — a live standing grant, not a visible pane or setting,
     * authorizes the recurring occurrence. */
    #[test]
    fn case_2_standing_series_consent_auto_starts() {
        let outcome = evaluate(
            &DetectionInputs {
                calendar: CalendarSignal::Started { event: event(3) },
                mic: MicSignal::Active,
                standing_series_consent: true,
                ..inputs()
            },
            &calendar_policy(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::AutoStart {
                event_key: "event-1".to_string(),
                event_title: "Quarterly planning".to_string(),
            }
        );
    }

    #[test]
    fn open_pane_setting_without_standing_consent_still_prompts() {
        let outcome = evaluate(
            &DetectionInputs {
                calendar: CalendarSignal::Started { event: event(3) },
                mic: MicSignal::Active,
                ..inputs()
            },
            &DetectionPolicy {
                auto_start_on_open_pane: true,
                ..calendar_policy()
            },
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Prompt(PromptKind::CalendarEvent {
                event_key: "event-1".to_string(),
                event_title: "Quarterly planning".to_string(),
            })
        );
    }

    /* §5.3 case 3 — start reached, pane not open, mic live: prompt. */
    #[test]
    fn case_3_started_event_without_open_pane_prompts() {
        let outcome = evaluate(
            &DetectionInputs {
                calendar: CalendarSignal::Started { event: event(2) },
                app: zoom(),
                mic: MicSignal::Active,
                ..inputs()
            },
            &calendar_policy(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Prompt(PromptKind::CalendarEvent {
                event_key: "event-1".to_string(),
                event_title: "Quarterly planning".to_string(),
            })
        );
    }

    #[test]
    fn case_3_prompt_title_uses_the_event_copy_pattern() {
        let prompt = PromptKind::CalendarEvent {
            event_key: "event-1".to_string(),
            event_title: "Quarterly planning".to_string(),
        };

        assert_eq!(prompt.notification_title(), "Quarterly planning starting");
    }

    /* §5.3 case 4 — meeting app open, microphone idle: nothing. */
    #[test]
    fn case_4_app_open_without_mic_activity_never_prompts() {
        let outcome = evaluate(
            &DetectionInputs {
                app: zoom(),
                ..inputs()
            },
            &DetectionPolicy::default(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Suppress(SuppressReason::NoQualifyingSignal)
        );
    }

    /* §5.3 case 5 — allowlisted app plus live mic, no event: ad-hoc prompt. */
    #[test]
    fn case_5_known_app_with_live_mic_prompts_with_app_copy() {
        let outcome = evaluate(
            &DetectionInputs {
                app: zoom(),
                mic: MicSignal::Active,
                ..inputs()
            },
            &DetectionPolicy::default(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Prompt(PromptKind::AppMeeting {
                bundle_id: "us.zoom.xos".to_string(),
                app_name: "Zoom".to_string(),
            })
        );
        assert_eq!(
            PromptKind::AppMeeting {
                bundle_id: "us.zoom.xos".to_string(),
                app_name: "Zoom".to_string(),
            }
            .notification_title(),
            "Zoom meeting detected"
        );
    }

    #[test]
    fn case_5_slack_takes_the_huddle_copy() {
        let outcome = evaluate(
            &DetectionInputs {
                app: AppSignal::Known {
                    bundle_id: SLACK_BUNDLE_ID.to_string(),
                    display_name: "Slack".to_string(),
                    frontmost: true,
                },
                mic: MicSignal::Active,
                ..inputs()
            },
            &DetectionPolicy::default(),
        );

        let DetectionOutcome::Prompt(prompt) = outcome else {
            panic!("Slack with a live mic should prompt");
        };
        assert_eq!(prompt.notification_title(), "Slack huddle detected");
    }

    /* §5.3 case 6 — live mic, no identifiable app: suppressed unless opted in. */
    #[test]
    fn case_6_unknown_mic_source_is_suppressed_by_default() {
        assert!(!DetectionPolicy::default().any_mic_activity);

        let outcome = evaluate(
            &DetectionInputs {
                mic: MicSignal::Active,
                ..inputs()
            },
            &DetectionPolicy::default(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Suppress(SuppressReason::UnknownMicSource)
        );
    }

    #[test]
    fn case_6_any_mic_activity_toggle_opens_the_unknown_path() {
        let outcome = evaluate(
            &DetectionInputs {
                mic: MicSignal::Active,
                ..inputs()
            },
            &DetectionPolicy {
                any_mic_activity: true,
                ..DetectionPolicy::default()
            },
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Prompt(PromptKind::UnknownMicSource)
        );
    }

    /* §5.3 case 7 — browser plus readable meeting title plus permission. */
    #[test]
    fn case_7_browser_meeting_title_prompts_scoped_to_the_browser() {
        let outcome = evaluate(
            &DetectionInputs {
                app: chrome(),
                mic: MicSignal::Active,
                screen_recording: ScreenRecordingPermission::Granted,
                browser_title: BrowserTitleEvidence::MeetingMatch,
                ..inputs()
            },
            &DetectionPolicy::default(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Prompt(PromptKind::BrowserCall {
                bundle_id: "com.google.chrome".to_string(),
                app_name: "Chrome".to_string(),
            })
        );
        assert_eq!(
            PromptKind::BrowserCall {
                bundle_id: "com.google.chrome".to_string(),
                app_name: "Chrome".to_string(),
            }
            .notification_title(),
            "Call detected in Chrome"
        );
    }

    #[test]
    fn case_7_browser_without_a_meeting_title_is_suppressed() {
        let outcome = evaluate(
            &DetectionInputs {
                app: chrome(),
                mic: MicSignal::Active,
                screen_recording: ScreenRecordingPermission::Granted,
                browser_title: BrowserTitleEvidence::NoMatch,
                ..inputs()
            },
            &DetectionPolicy::default(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Suppress(SuppressReason::BrowserTitleNotMeeting)
        );
    }

    /* §5.3 case 7b — same as 7 with no Screen Recording grant. */
    #[test]
    fn case_7b_unreadable_browser_title_suppresses_instead_of_guessing() {
        let outcome = evaluate(
            &DetectionInputs {
                app: chrome(),
                mic: MicSignal::Active,
                screen_recording: ScreenRecordingPermission::NotGranted,
                browser_title: BrowserTitleEvidence::Unreadable,
                ..inputs()
            },
            &DetectionPolicy::default(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Suppress(SuppressReason::BrowserTitleUnreadable)
        );
    }

    #[test]
    fn case_7b_falls_back_to_the_any_mic_toggle_rather_than_a_permission_request() {
        let outcome = evaluate(
            &DetectionInputs {
                app: chrome(),
                mic: MicSignal::Active,
                screen_recording: ScreenRecordingPermission::NotGranted,
                browser_title: BrowserTitleEvidence::Unreadable,
                ..inputs()
            },
            &DetectionPolicy {
                any_mic_activity: true,
                ..DetectionPolicy::default()
            },
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Prompt(PromptKind::UnknownMicSource)
        );
    }

    /* §5.3 case 8 — new activity inside the cross-link window joins the open note. */
    #[test]
    fn case_8_activity_during_an_open_capture_cross_links() {
        let outcome = evaluate(
            &DetectionInputs {
                mic: MicSignal::Active,
                capture_active: true,
                self_holds_input_device: true,
                recent_capture: Some(RecentCapture {
                    session_id: "session-1".to_string(),
                    trigger_bundle_id: Some("us.zoom.xos".to_string()),
                    started_utc_ms: NOW - 5 * 60_000,
                }),
                ..inputs()
            },
            &DetectionPolicy::default(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::CrossLink {
                session_id: "session-1".to_string(),
            }
        );
    }

    #[test]
    fn case_8_expires_after_the_cross_link_window() {
        let outcome = evaluate(
            &DetectionInputs {
                mic: MicSignal::Active,
                capture_active: true,
                recent_capture: Some(RecentCapture {
                    session_id: "session-1".to_string(),
                    trigger_bundle_id: Some("us.zoom.xos".to_string()),
                    started_utc_ms: NOW - CROSS_LINK_WINDOW_MS - 1,
                }),
                ..inputs()
            },
            &DetectionPolicy::default(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Suppress(SuppressReason::CaptureAlreadyActive)
        );
    }

    /* §5.3 case 9 — the attendee floor. */
    #[test]
    fn case_9_solo_event_never_prompts_from_the_calendar_path() {
        for attendee_count in [0, 1] {
            let outcome = evaluate(
                &DetectionInputs {
                    calendar: CalendarSignal::Started {
                        event: event(attendee_count),
                    },
                    mic: MicSignal::Active,
                    ..inputs()
                },
                &calendar_policy(),
            );

            assert_eq!(
                outcome,
                DetectionOutcome::Suppress(SuppressReason::AttendeeFloorNotMet),
                "an event with {attendee_count} attendees must not prompt"
            );
        }
    }

    #[test]
    fn case_9_solo_event_does_not_shadow_the_ad_hoc_path() {
        let outcome = evaluate(
            &DetectionInputs {
                calendar: CalendarSignal::Started { event: event(1) },
                app: zoom(),
                mic: MicSignal::Active,
                ..inputs()
            },
            &calendar_policy(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Prompt(PromptKind::AppMeeting {
                bundle_id: "us.zoom.xos".to_string(),
                app_name: "Zoom".to_string(),
            })
        );
    }

    #[test]
    fn case_9_upcoming_solo_event_shows_no_countdown() {
        let outcome = evaluate(
            &DetectionInputs {
                calendar: CalendarSignal::Upcoming {
                    event: event(1),
                    seconds_to_start: 30,
                },
                ..inputs()
            },
            &calendar_policy(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Suppress(SuppressReason::AttendeeFloorNotMet)
        );
    }

    /* §5.3 case 10 — missing Screen Recording must not gate cases 1-5. */
    #[test]
    fn case_10_cases_1_through_5_are_identical_without_screen_recording() {
        let scenarios: [(&str, DetectionInputs, DetectionPolicy); 4] = [
            (
                "case 1",
                DetectionInputs {
                    calendar: CalendarSignal::Upcoming {
                        event: event(3),
                        seconds_to_start: 30,
                    },
                    ..inputs()
                },
                calendar_policy(),
            ),
            (
                "case 2",
                DetectionInputs {
                    calendar: CalendarSignal::Started { event: event(3) },
                    mic: MicSignal::Active,
                    standing_series_consent: true,
                    ..inputs()
                },
                DetectionPolicy {
                    auto_start_on_open_pane: true,
                    ..calendar_policy()
                },
            ),
            (
                "case 3",
                DetectionInputs {
                    calendar: CalendarSignal::Started { event: event(3) },
                    mic: MicSignal::Active,
                    ..inputs()
                },
                calendar_policy(),
            ),
            (
                "case 5",
                DetectionInputs {
                    app: zoom(),
                    mic: MicSignal::Active,
                    ..inputs()
                },
                DetectionPolicy::default(),
            ),
        ];

        for (label, base, policy) in scenarios {
            let denied = evaluate(
                &DetectionInputs {
                    screen_recording: ScreenRecordingPermission::NotGranted,
                    ..base.clone()
                },
                &policy,
            );
            let granted = evaluate(
                &DetectionInputs {
                    screen_recording: ScreenRecordingPermission::Granted,
                    ..base
                },
                &policy,
            );

            assert_eq!(
                denied, granted,
                "{label} must not depend on Screen Recording permission"
            );
            assert!(
                !matches!(denied, DetectionOutcome::Suppress(_)),
                "{label} must still act without Screen Recording permission"
            );
        }
    }

    /* Suppress paths that are not decision-table rows. */
    #[test]
    fn master_toggle_off_suppresses_every_signal() {
        let outcome = evaluate(
            &DetectionInputs {
                calendar: CalendarSignal::Started { event: event(9) },
                app: zoom(),
                mic: MicSignal::Active,
                screen_recording: ScreenRecordingPermission::Granted,
                browser_title: BrowserTitleEvidence::MeetingMatch,
                ..inputs()
            },
            &DetectionPolicy {
                enabled: false,
                ..calendar_policy()
            },
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Suppress(SuppressReason::DetectionDisabled)
        );
    }

    #[test]
    fn sonas_own_dictation_is_never_read_as_a_meeting() {
        let outcome = evaluate(
            &DetectionInputs {
                app: zoom(),
                mic: MicSignal::Active,
                self_holds_input_device: true,
                ..inputs()
            },
            &DetectionPolicy {
                any_mic_activity: true,
                ..DetectionPolicy::default()
            },
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Suppress(SuppressReason::SonaHoldsInputDevice)
        );
    }

    #[test]
    fn calendar_sub_toggle_off_ignores_calendar_evidence() {
        let outcome = evaluate(
            &DetectionInputs {
                calendar: CalendarSignal::Upcoming {
                    event: event(5),
                    seconds_to_start: 10,
                },
                ..inputs()
            },
            &DetectionPolicy::default(),
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Suppress(SuppressReason::NoQualifyingSignal)
        );
    }

    #[test]
    fn an_open_capture_without_recent_context_stays_quiet() {
        let outcome = evaluate(
            &DetectionInputs {
                mic: MicSignal::Active,
                capture_active: true,
                ..inputs()
            },
            &DetectionPolicy {
                any_mic_activity: true,
                ..DetectionPolicy::default()
            },
        );

        assert_eq!(
            outcome,
            DetectionOutcome::Suppress(SuppressReason::CaptureAlreadyActive)
        );
    }

    /* §5.5 auto-stop. */
    fn stop_inputs() -> StopInputs {
        StopInputs {
            now_utc_ms: NOW,
            linked_event_end_utc_ms: None,
            last_voiced_utc_ms: Some(NOW),
            self_holds_input_device: true,
            device_running_somewhere: true,
            trigger_app_running: true,
            slept_since_start: false,
        }
    }

    #[test]
    fn a_healthy_capture_has_no_stop_trigger() {
        assert_eq!(evaluate_stop(&stop_inputs(), &StopPolicy::default()), None);
    }

    #[test]
    fn scheduled_event_end_stops_a_linked_capture() {
        let trigger = evaluate_stop(
            &StopInputs {
                linked_event_end_utc_ms: Some(NOW),
                ..stop_inputs()
            },
            &StopPolicy::default(),
        );

        assert_eq!(trigger, Some(StopTrigger::EventEnd));
    }

    #[test]
    fn silence_stops_at_the_configured_window() {
        let policy = StopPolicy {
            silence_stop_minutes: 15,
        };

        assert_eq!(
            evaluate_stop(
                &StopInputs {
                    last_voiced_utc_ms: Some(NOW - 15 * 60_000),
                    ..stop_inputs()
                },
                &policy
            ),
            Some(StopTrigger::Silence)
        );
        assert_eq!(
            evaluate_stop(
                &StopInputs {
                    last_voiced_utc_ms: Some(NOW - 15 * 60_000 + 1),
                    ..stop_inputs()
                },
                &policy
            ),
            None
        );
    }

    #[test]
    fn zero_silence_minutes_leaves_manual_stop_in_charge() {
        let trigger = evaluate_stop(
            &StopInputs {
                last_voiced_utc_ms: Some(NOW - 24 * 60 * 60_000),
                ..stop_inputs()
            },
            &StopPolicy {
                silence_stop_minutes: 0,
            },
        );

        assert_eq!(trigger, None);
    }

    #[test]
    fn without_a_voiced_clock_the_silence_rule_cannot_stop_a_live_meeting() {
        let trigger = evaluate_stop(
            &StopInputs {
                last_voiced_utc_ms: None,
                ..stop_inputs()
            },
            &StopPolicy::default(),
        );

        assert_eq!(
            trigger, None,
            "an absent voiced clock must make the rule inapplicable, not fire it"
        );
    }

    #[test]
    fn the_device_going_idle_only_counts_when_sona_is_not_holding_it() {
        // Sona's own microphone lane keeps the device raised, so a false reading
        // here would mean Sona's capture had already stopped. Ignoring it is the
        // only correct answer.
        assert_eq!(
            evaluate_stop(
                &StopInputs {
                    self_holds_input_device: true,
                    device_running_somewhere: false,
                    ..stop_inputs()
                },
                &StopPolicy::default()
            ),
            None
        );
        // A system-audio-only capture does not hold the input device, so the
        // meeting app dropping the microphone is real evidence.
        assert_eq!(
            evaluate_stop(
                &StopInputs {
                    self_holds_input_device: false,
                    device_running_somewhere: false,
                    ..stop_inputs()
                },
                &StopPolicy::default()
            ),
            Some(StopTrigger::InputDeviceIdle)
        );
    }

    #[test]
    fn the_triggering_app_quitting_stops_the_capture() {
        let trigger = evaluate_stop(
            &StopInputs {
                trigger_app_running: false,
                ..stop_inputs()
            },
            &StopPolicy::default(),
        );

        assert_eq!(trigger, Some(StopTrigger::TriggerAppExited));
    }

    #[test]
    fn a_sleep_boundary_outranks_every_other_trigger() {
        let trigger = evaluate_stop(
            &StopInputs {
                slept_since_start: true,
                linked_event_end_utc_ms: Some(NOW),
                trigger_app_running: false,
                ..stop_inputs()
            },
            &StopPolicy::default(),
        );

        assert_eq!(trigger, Some(StopTrigger::SleepBoundary));
    }

    /* §5.5 boundary inversion. */
    fn previous_capture() -> RecentCapture {
        RecentCapture {
            session_id: "session-1".to_string(),
            trigger_bundle_id: Some("us.zoom.xos".to_string()),
            started_utc_ms: NOW,
        }
    }

    #[test]
    fn a_mic_gap_defaults_to_a_new_meeting() {
        let boundary = classify_reactivation(
            &previous_capture(),
            NOW + MERGE_PROMPT_WINDOW_MS + 1,
            Some("us.zoom.xos"),
        );

        assert_eq!(boundary, ReactivationBoundary::NewMeeting);
    }

    #[test]
    fn a_close_same_app_gap_offers_a_merge_and_never_performs_one() {
        let boundary = classify_reactivation(
            &previous_capture(),
            NOW + MERGE_PROMPT_WINDOW_MS,
            Some("US.ZOOM.XOS"),
        );

        assert_eq!(
            boundary,
            ReactivationBoundary::MergePrompt {
                previous_session_id: "session-1".to_string(),
            }
        );
    }

    #[test]
    fn a_different_app_is_always_a_new_meeting() {
        let boundary =
            classify_reactivation(&previous_capture(), NOW + 1_000, Some(SLACK_BUNDLE_ID));

        assert_eq!(boundary, ReactivationBoundary::NewMeeting);
    }

    #[test]
    fn an_unattributed_capture_is_always_a_new_meeting() {
        let boundary = classify_reactivation(&previous_capture(), NOW + 1_000, None);

        assert_eq!(boundary, ReactivationBoundary::NewMeeting);
    }
}
