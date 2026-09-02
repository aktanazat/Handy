//! D22: what a series has been told to do once a meeting's notes are written.
//!
//! Three kinds, each opt-in per series, each holding its own configuration in
//! the same row as its switch. That pairing is deliberate: "webhook enabled"
//! with no URL and "shortcut enabled" with no shortcut name are unrunnable
//! states, so enablement and target are one fact written together under one
//! receipt, and there is no window in which the executor can read half of a
//! decision.
//!
//! A series is identified by the same `series_key` standing consent, loop 4's
//! priming and D21's template preference already use — EventKit's calendar-item
//! identifier. A meeting with no calendar event has no series and therefore no
//! automations; that is the `None` below, not an error.

use super::types::{MeetingArtifactId, MeetingOperationId, MeetingSessionId, OperationReceipt};
use serde::{Deserialize, Serialize};
use specta::Type;

/// The longest target this app will store. A Shortcut name and a webhook URL
/// both live far below it; the bound exists so a paste of an entire document
/// into the field is refused at the boundary rather than at the effect.
const MAX_TARGET_BYTES: usize = 512;

/// The stored form of a webhook URL, or why it will not be stored.
///
/// Egress policy is `crate::net_policy`'s, unchanged and unduplicated — the same
/// function the agent panel's relay client refuses a pairing with. What is
/// specific here is the rest of the URL's shape: credentials embedded in a URL
/// are a secret this app would then hold on the operator's behalf, and a
/// fragment has no meaning in a POST, so both are refused rather than silently
/// dropped. A path and a query survive, because a webhook usually is a path.
fn normalized_webhook_url(target: &str) -> Result<String, MeetingAutomationFailure> {
    let url = url::Url::parse(target).map_err(|_| MeetingAutomationFailure::TargetInvalid)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(MeetingAutomationFailure::TargetInvalid);
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err(MeetingAutomationFailure::TargetInvalid);
    }
    if !crate::net_policy::is_private_relay_host(url.host_str()) {
        return Err(MeetingAutomationFailure::HostNotAllowed);
    }
    Ok(url.to_string())
}

/// The four after-meeting actions. Nothing here is a channel to a third party:
/// reminders are Apple's local database, a Shortcut is a program the operator
/// wrote, a saved prompt goes to whichever engine D14 already allows this
/// meeting, and a webhook is refused unless its host is on their own tailnet.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MeetingAutomationKind {
    /// Write this meeting's still-open commitments into a "Sona" list in Apple
    /// Reminders.
    Reminders,
    /// Run a named Shortcut with the meeting's export JSON on stdin.
    Shortcut,
    /// POST the meeting's export JSON to a URL on the operator's own network.
    Webhook,
    /// Ask one saved prompt about this meeting and keep the answer. The target
    /// is the prompt's id.
    RunPrompt,
}

impl MeetingAutomationKind {
    /// Every kind, in the order the settings surface lists them.
    pub const ALL: [Self; 4] = [
        Self::Reminders,
        Self::Shortcut,
        Self::Webhook,
        Self::RunPrompt,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Reminders => "reminders",
            Self::Shortcut => "shortcut",
            Self::Webhook => "webhook",
            Self::RunPrompt => "run_prompt",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "reminders" => Some(Self::Reminders),
            "shortcut" => Some(Self::Shortcut),
            "webhook" => Some(Self::Webhook),
            "run_prompt" => Some(Self::RunPrompt),
            _ => None,
        }
    }

    /// Whether this kind is unrunnable without a target string. Reminders write
    /// to a list this app names itself, so it has nothing to configure; the
    /// others are a Shortcut name, a URL, and a prompt id.
    pub const fn needs_target(self) -> bool {
        match self {
            Self::Reminders => false,
            Self::Shortcut | Self::Webhook | Self::RunPrompt => true,
        }
    }

    /// The stored form of a target for this kind, or why it cannot be stored.
    ///
    /// The one place that decides what a target may be, called on the way into
    /// the store *and* again on the way into an effect. Twice on purpose: the
    /// first call is what lets the settings surface say no while the operator is
    /// still looking at the field, and the second is what makes a row written by
    /// an older build — or under an allowlist that has since narrowed — fail
    /// visibly instead of reaching the network.
    pub fn normalize_target(
        self,
        target: Option<&str>,
    ) -> Result<Option<String>, MeetingAutomationFailure> {
        let target = target.map(str::trim).filter(|value| !value.is_empty());
        // Reminders write to a list this app names, so a target here is noise
        // rather than an error, and dropping it keeps the row honest about
        // having no configuration.
        if !self.needs_target() {
            return Ok(None);
        }
        let Some(target) = target else {
            return Err(MeetingAutomationFailure::TargetMissing);
        };
        if target.len() > MAX_TARGET_BYTES || target.chars().any(|character| character.is_control())
        {
            return Err(MeetingAutomationFailure::TargetInvalid);
        }
        match self {
            // A Shortcut name is passed as one argv element, never through a
            // shell, so the rules are only the ones a name has to satisfy to be
            // a name: bounded, printable, and not a flag the `shortcuts` binary
            // would read as its own.
            Self::Shortcut => {
                if target.starts_with('-') {
                    return Err(MeetingAutomationFailure::TargetInvalid);
                }
                Ok(Some(target.to_string()))
            }
            Self::Webhook => Ok(Some(normalized_webhook_url(target)?)),
            // A prompt id is a uuid this app minted. Checking the shape here is
            // what keeps a hand-edited row from reaching the store; whether the
            // prompt still exists is the executor's question, because a prompt
            // can be deleted long after the automation was configured.
            Self::RunPrompt => match uuid::Uuid::parse_str(target) {
                Ok(prompt_id) => Ok(Some(prompt_id.to_string())),
                Err(_) => Err(MeetingAutomationFailure::TargetInvalid),
            },
            Self::Reminders => Ok(None),
        }
    }
}

/// One series' setting for one kind.
///
/// `target` is the Shortcut name or the webhook URL, and stays on the row while
/// the switch is off so that turning an automation off and on again does not
/// make the operator retype it. `enabled: false` with a target is a remembered
/// choice, not a broken one.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingSeriesAutomation {
    pub kind: MeetingAutomationKind,
    pub enabled: bool,
    pub target: Option<String>,
}

/// What one series has chosen, and the fence a write against it must carry.
///
/// Only configured kinds appear in `automations`; a kind with no row has never
/// been touched and is off. `revision` counts every automation write on this
/// machine rather than only this series', for the same reason D21's does: the
/// surfaces that write it read the whole preference at once, and a shared
/// counter costs one retry in the rare two-window case while saving a per-row
/// column nothing would read.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingSeriesAutomationsSnapshot {
    pub series_key: Option<String>,
    pub automations: Vec<MeetingSeriesAutomation>,
    pub revision: u64,
}

impl MeetingSeriesAutomationsSnapshot {
    /// The setting for one kind, or `None` when the series has never chosen.
    pub fn get(&self, kind: MeetingAutomationKind) -> Option<&MeetingSeriesAutomation> {
        self.automations
            .iter()
            .find(|automation| automation.kind == kind)
    }

    /// The kinds that are on and have what they need to run, in `ALL` order.
    ///
    /// The executor asks this rather than filtering on `enabled` alone, so
    /// "enabled with a blank target" can never reach an effect: it is a
    /// configuration the settings surface refuses to save, and refusing it
    /// twice costs nothing.
    pub fn runnable(&self) -> Vec<MeetingSeriesAutomation> {
        MeetingAutomationKind::ALL
            .into_iter()
            .filter_map(|kind| self.get(kind))
            .filter(|automation| automation.enabled)
            .filter(|automation| !automation.kind.needs_target() || automation.target.is_some())
            .cloned()
            .collect()
    }
}

/// Turn one kind on or off for one series, and set what it points at.
///
/// `enabled: false` with `target: None` forgets the row entirely, which is how
/// an operator takes a URL back off their machine. Every other combination
/// remembers.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingSeriesAutomationSetRequest {
    pub operation_id: MeetingOperationId,
    pub series_key: String,
    pub kind: MeetingAutomationKind,
    pub enabled: bool,
    pub target: Option<String>,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingSeriesAutomationMutationResult {
    pub receipt: OperationReceipt,
    pub snapshot: MeetingSeriesAutomationsSnapshot,
}

/// Where an attempt got to.
///
/// `Started` is not a pending state waiting for a retry — nothing retries. It is
/// the claim an attempt writes before it touches anything outside this process,
/// and a row still saying it means the attempt never reported back: the app was
/// quit, or it crashed, mid-run. Leaving that visible is the point. There is no
/// reconciliation pass that would silently make it look like it never happened.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MeetingAutomationRunState {
    Started,
    Committed,
    Failed,
}

impl MeetingAutomationRunState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Committed => "committed",
            Self::Failed => "failed",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "started" => Some(Self::Started),
            "committed" => Some(Self::Committed),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}

/// Why an attempt did not commit.
///
/// Its own vocabulary rather than [`super::types::MeetingReasonCode`], for the
/// same reason `ProcessingStatus::Failed` carries its own: these are the ways
/// three specific effects fail, and widening the app-wide code list with them
/// would make every unrelated receipt reader carry them too.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MeetingAutomationFailure {
    /// macOS has not been asked, or said no. Surfaces as a hint on the settings
    /// row, never as a dialog: the operator turned this on once and does not
    /// need to be interrupted after every meeting about it.
    PermissionDenied,
    /// No Shortcut name or no URL. Cannot happen through the settings surface,
    /// and is checked anyway because the store is older than any one release.
    TargetMissing,
    /// The URL is not on the operator's own network. Same policy as the relay —
    /// see [`crate::net_policy`].
    HostNotAllowed,
    /// The URL is not a URL, or not one this app will POST to.
    TargetInvalid,
    /// This platform has no such facility: no EventKit, no `shortcuts` binary.
    Unavailable,
    /// The effect ran past its bound and was stopped.
    TimedOut,
    /// It ran, and it said no: a non-2xx status, a non-zero exit, a save that
    /// EventKit refused.
    Rejected,
}

impl MeetingAutomationFailure {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PermissionDenied => "permission_denied",
            Self::TargetMissing => "target_missing",
            Self::HostNotAllowed => "host_not_allowed",
            Self::TargetInvalid => "target_invalid",
            Self::Unavailable => "unavailable",
            Self::TimedOut => "timed_out",
            Self::Rejected => "rejected",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "permission_denied" => Some(Self::PermissionDenied),
            "target_missing" => Some(Self::TargetMissing),
            "host_not_allowed" => Some(Self::HostNotAllowed),
            "target_invalid" => Some(Self::TargetInvalid),
            "unavailable" => Some(Self::Unavailable),
            "timed_out" => Some(Self::TimedOut),
            "rejected" => Some(Self::Rejected),
            _ => None,
        }
    }
}

/// The receipt for one attempt.
///
/// This *is* the receipt, not a summary of one kept elsewhere: like the workflow
/// engine's run log, a system-actor background pass records its own outcome in
/// its own table rather than minting an [`OperationReceipt`], which belongs to
/// fenced user mutations. One row per artifact revision per kind, forever, so
/// "did my webhook fire for that meeting" has an answer that does not depend on
/// a log file.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingAutomationRunReceipt {
    pub artifact_id: MeetingArtifactId,
    pub session_id: MeetingSessionId,
    pub series_key: String,
    pub kind: MeetingAutomationKind,
    pub state: MeetingAutomationRunState,
    pub failure: Option<MeetingAutomationFailure>,
    /// One short line naming what happened, for a reader who needs more than
    /// the code: the HTTP status, the exit status, the list that was written.
    /// Never the payload, and never a URL.
    pub detail: Option<String>,
    /// How many things the effect produced — reminders written, requests sent.
    pub effects: u32,
    pub started_at_utc_ms: i64,
    pub finished_at_utc_ms: Option<i64>,
}

/// One series the operator could turn an automation on for, as the settings
/// surface lists it.
///
/// `series_key`, `title`, `last_met_at_utc_ms` and `meeting_count` are
/// `store::series::series_roster_in`'s answer, unchanged — the same four
/// `MeetingSeriesRemoteRow` carries, so the two settings screens cannot
/// disagree about which series exist or what they are called. Only
/// `automations` belongs to this surface.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingAutomationSeries {
    pub series_key: String,
    pub title: String,
    pub last_met_at_utc_ms: i64,
    pub meeting_count: u32,
    pub automations: Vec<MeetingSeriesAutomation>,
}

/// Every series the settings surface lists, and the fence its writes carry.
///
/// The revision rides with the list rather than being fetched per row because it
/// is one counter for the whole table: a surface that read it per series would be
/// making three round trips to learn the same number, and would still have to
/// re-read all of them after any write.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingAutomationRoster {
    pub series: Vec<MeetingAutomationSeries>,
    pub revision: u64,
}
