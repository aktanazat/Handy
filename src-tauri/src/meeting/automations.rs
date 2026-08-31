//! D22: what happens after a meeting, on this machine, because a series was
//! told to.
//!
//! Three effects, all local by construction: reminders go into Apple's own
//! database, a Shortcut is a program the operator wrote, and a webhook is
//! refused unless its host is on their own tailnet — the same
//! [`crate::net_policy`] rule the relay client uses, not a second, looser one.
//!
//! ## One bounded attempt
//!
//! Each artifact revision gets exactly one attempt per enabled kind, claimed in
//! the store before anything leaves this process, and its outcome is written
//! down. Nothing retries. That is a decision, not an omission:
//!
//! * A retry loop around an effect with side effects outside this app is how one
//!   webhook becomes four POSTs and one reminder becomes four reminders. The
//!   failure mode of "tried once, said so" is a person reading a receipt; the
//!   failure mode of "kept trying" is duplicated work in systems this app does
//!   not own and cannot clean up.
//! * The startup reconciliation scan that resumes interrupted workflow runs is
//!   deliberately **not** extended to cover these. A workflow run is idempotent
//!   arithmetic over this machine's own rows. An automation is not, and resuming
//!   one a day later would fire an after-meeting action long after the meeting.
//!
//! So a missed automation is visible in its receipt — a run row still reading
//! `started`, or one reading `failed` with a reason — and that is where it stops.
//! Every one of these attempts is a gamble on a system we do not control; what
//! the design owes the operator is a calibrated view of how the gamble went, not
//! the appearance of certainty.
//!
//! ## Where it runs
//!
//! At the end of the pipeline, off the pipeline's thread, and only for a meeting
//! that actually reached review. The trigger sits beside the meeting-finalized
//! workflow event in `processing::finish_review` — after the artifact revision is
//! current, after the title has been derived from it, after loops have been
//! carried forward, after the semantic index has been built — because everything
//! an effect sends must already be final, and because the operator must have
//! their notes before an automation is allowed to spend thirty seconds.
//!
//! Regenerating notes by hand does not fire automations again. "After the
//! meeting" is the trigger; the artifact revision is only the identity that
//! keeps one trigger from firing twice.

use super::automation_types::{
    MeetingAutomationFailure, MeetingAutomationKind, MeetingAutomationRunReceipt,
    MeetingAutomationRunState, MeetingSeriesAutomation,
};
use super::export;
use super::store::{MeetingStore, StoreError};
use super::types::{
    MeetingArtifactId, MeetingArtifactState, MeetingExportFormat, MeetingSessionId,
};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;

/// How long any one effect may take. One bound for all three, because the number
/// the operator would care about is "how long after a meeting can this app still
/// be busy", not which of three mechanisms is slow.
const EFFECT_TIMEOUT: Duration = Duration::from_secs(30);

/// The Reminders list this app writes to, and never reads from. Named, not
/// configurable: a list the operator can find, delete, or share, and one place
/// to look when they want it all gone.
const REMINDERS_LIST: &str = "Sona";

/// The longest reminder title this app will write. A commitment read out of a
/// transcript is a sentence; anything past this is a paragraph that got in by
/// mistake, and truncating it keeps one bad extraction from producing a reminder
/// nobody can read in the list.
const MAX_REMINDER_TITLE_CHARS: usize = 200;

/// One thing to write into Reminders.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReminderItem {
    pub title: String,
    /// The meeting it came from, and its `sona://` address, so the reminder can
    /// be traced back to the sentence that produced it.
    pub notes: String,
}

/// What one attempt is asked to do, with the payload already assembled.
///
/// Built on the pipeline thread while the store is legitimately open, then moved
/// to the thread that performs the effect: the effect never reads the store, and
/// the store is never held across a network call or a subprocess.
#[derive(Clone, Debug)]
pub(crate) struct AutomationPlan {
    pub artifact_id: MeetingArtifactId,
    pub session_id: MeetingSessionId,
    pub series_key: String,
    pub automation: MeetingSeriesAutomation,
    /// The meeting export document, exactly as the Export action writes it, or
    /// `None` when it could not be rendered. `None` fails the run rather than
    /// sending an empty body: a webhook that receives `[]` and reports success
    /// is worse than one that never fires.
    pub export_json: Option<Arc<Vec<u8>>>,
    /// Open commitments that are the operator's own, for the reminders kind.
    pub reminders: Vec<ReminderItem>,
}

/// What an effect did, or why it did not.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct EffectOutcome {
    pub failure: Option<MeetingAutomationFailure>,
    pub detail: Option<String>,
    pub effects: u32,
}

impl EffectOutcome {
    pub(crate) fn committed(effects: u32, detail: Option<String>) -> Self {
        Self {
            failure: None,
            detail,
            effects,
        }
    }

    pub(crate) fn failed(failure: MeetingAutomationFailure, detail: Option<String>) -> Self {
        Self {
            failure: Some(failure),
            detail,
            effects: 0,
        }
    }

    const fn state(&self) -> MeetingAutomationRunState {
        match self.failure {
            None => MeetingAutomationRunState::Committed,
            Some(_) => MeetingAutomationRunState::Failed,
        }
    }
}

/// The three things this module does to the world outside the process.
///
/// A trait so the gating, the claim, the payload and the receipt can be
/// exercised without writing to a Reminders database, launching a subprocess, or
/// opening a socket. The real implementation is [`SystemEffects`]; tests supply
/// one that records what it was asked to do.
pub(crate) trait AutomationEffects: Send + Sync {
    fn write_reminders(&self, items: &[ReminderItem]) -> EffectOutcome;
    fn run_shortcut(&self, name: &str, stdin: &[u8]) -> EffectOutcome;
    fn post_webhook(&self, url: &str, body: &[u8]) -> EffectOutcome;
}

/// Run every enabled automation for the meeting that just finished.
///
/// Spawns, and returns immediately: the caller is the processing job thread, and
/// the meeting is already in review by the time this is called. In a headless
/// build with no `AppHandle` — which is every test — the pass runs inline, the
/// same convention `MeetingProcessingService::submit` uses, so a test observes
/// the whole thing without a scheduler.
pub(crate) fn after_meeting_finalized(
    store: Arc<MeetingStore>,
    app: Option<AppHandle>,
    session_id: MeetingSessionId,
) {
    if app.is_none() {
        report(
            session_id,
            run_for_meeting(&store, session_id, &SystemEffects, now_utc_ms()),
        );
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        report(
            session_id,
            run_for_meeting(&store, session_id, &SystemEffects, now_utc_ms()),
        );
    });
}

/// Say in the log what the receipts already say in the store.
///
/// Only the failures, and only one line each: the receipt is the record, and a
/// log that repeated every success would bury the one line somebody grepping for
/// "my webhook did not fire" is looking for.
fn report(session_id: MeetingSessionId, receipts: Vec<MeetingAutomationRunReceipt>) {
    for receipt in receipts
        .iter()
        .filter(|receipt| receipt.state == MeetingAutomationRunState::Failed)
    {
        log::warn!(
            "Automation {} for {session_id:?} failed: {:?} {}",
            receipt.kind.as_str(),
            receipt.failure,
            receipt.detail.as_deref().unwrap_or_default()
        );
    }
}

/// Claim, perform and record every enabled automation for one meeting.
///
/// Returns the receipts it wrote, newest work last, so a caller — a test, or a
/// future surface that wants to report what just happened — can see the outcome
/// without re-reading the store. An empty vector means there was nothing to do:
/// no series, no automations, no current artifact, or every attempt already
/// taken.
pub(crate) fn run_for_meeting(
    store: &MeetingStore,
    session_id: MeetingSessionId,
    effects: &dyn AutomationEffects,
    started_at_utc_ms: i64,
) -> Vec<MeetingAutomationRunReceipt> {
    let plans = match plans_for_meeting(store, session_id) {
        Ok(plans) => plans,
        Err(error) => {
            log::warn!("Could not read automations for {session_id:?}: {error:?}");
            return Vec::new();
        }
    };
    let mut receipts = Vec::new();
    for plan in plans {
        match run_plan(store, &plan, effects, started_at_utc_ms) {
            Ok(Some(receipt)) => receipts.push(receipt),
            Ok(None) => {}
            Err(error) => log::warn!(
                "Automation {} for {session_id:?} could not be recorded: {error:?}",
                plan.automation.kind.as_str()
            ),
        }
    }
    receipts
}

/// One attempt: claim it, perform it, write down what happened.
///
/// `Ok(None)` is the gate having refused — this artifact revision already had
/// its attempt at this kind. The claim is a store write and the effect is
/// everything after it, in that order, so a process that dies mid-effect leaves
/// a row that says an attempt was started and never finished rather than a gap
/// that invites a second one.
fn run_plan(
    store: &MeetingStore,
    plan: &AutomationPlan,
    effects: &dyn AutomationEffects,
    started_at_utc_ms: i64,
) -> Result<Option<MeetingAutomationRunReceipt>, StoreError> {
    let Some(_claim) = store.claim_automation_run(
        plan.artifact_id,
        plan.session_id,
        &plan.series_key,
        &plan.automation,
        started_at_utc_ms,
    )?
    else {
        return Ok(None);
    };
    let outcome = perform(plan, effects);
    store
        .finish_automation_run(
            plan.artifact_id,
            plan.automation.kind,
            outcome.state(),
            outcome.failure,
            outcome.detail.as_deref(),
            outcome.effects,
            // Read again rather than reusing the claim's instant: the effect took
            // time, and a receipt that claimed to finish when it started would
            // hide exactly the duration a reader is looking for.
            now_utc_ms(),
        )
        .map(Some)
}

/// Perform one effect, re-checking its target on the way in.
///
/// The second check is not paranoia about the settings surface: a row can be
/// older than the policy that would refuse it today, and the moment a target
/// stops being acceptable is the moment it must stop being used. A refusal here
/// is a receipt, not a panic and not a silent skip.
fn perform(plan: &AutomationPlan, effects: &dyn AutomationEffects) -> EffectOutcome {
    let kind = plan.automation.kind;
    let target = match kind.normalize_target(plan.automation.target.as_deref()) {
        Ok(target) => target,
        Err(failure) => return EffectOutcome::failed(failure, None),
    };
    match kind {
        MeetingAutomationKind::Reminders => {
            if plan.reminders.is_empty() {
                // Nothing was left open that is the operator's own. That is a
                // successful pass with nothing to write, not a failure, and
                // recording it is how "why is my list empty" has an answer.
                return EffectOutcome::committed(0, Some("no open commitments".to_string()));
            }
            effects.write_reminders(&plan.reminders)
        }
        MeetingAutomationKind::Shortcut | MeetingAutomationKind::Webhook => {
            let (Some(target), Some(export)) = (target, plan.export_json.as_deref()) else {
                return EffectOutcome::failed(
                    MeetingAutomationFailure::TargetMissing,
                    plan.export_json
                        .is_none()
                        .then(|| "the meeting export could not be rendered".to_string()),
                );
            };
            if kind == MeetingAutomationKind::Shortcut {
                effects.run_shortcut(&target, export)
            } else {
                effects.post_webhook(&target, export)
            }
        }
    }
}

/// Everything this meeting's series asked for, with the payload built once.
///
/// The export document is assembled a single time and shared by every kind that
/// needs it: a Shortcut and a webhook on the same series are two sends of one
/// document, not two renders of a transcript.
fn plans_for_meeting(
    store: &MeetingStore,
    session_id: MeetingSessionId,
) -> Result<Vec<AutomationPlan>, StoreError> {
    let snapshot = store.series_automations_for_session(session_id)?;
    let Some(series_key) = snapshot.series_key.clone() else {
        return Ok(Vec::new());
    };
    let runnable = snapshot.runnable();
    if runnable.is_empty() {
        return Ok(Vec::new());
    }
    let review = store.review_snapshot(session_id)?;
    let Some(artifact_id) = review
        .artifacts
        .iter()
        .find(|artifact| artifact.state == MeetingArtifactState::Current)
        .map(|artifact| artifact.artifact_id)
    else {
        // No current notes: nothing an after-meeting action could be about.
        return Ok(Vec::new());
    };
    let kinds = runnable
        .iter()
        .map(|automation| automation.kind)
        .collect::<Vec<_>>();
    let export_json = kinds
        .iter()
        .any(|kind| *kind != MeetingAutomationKind::Reminders)
        .then(|| {
            export::render(MeetingExportFormat::Json, &review)
                .ok()
                .map(Arc::new)
        })
        .flatten();
    let reminders = if kinds.contains(&MeetingAutomationKind::Reminders) {
        reminder_items(store, session_id, &review.session.title)?
    } else {
        Vec::new()
    };
    Ok(runnable
        .into_iter()
        .map(|automation| AutomationPlan {
            artifact_id,
            session_id,
            series_key: series_key.clone(),
            automation,
            export_json: export_json.clone(),
            reminders: reminders.clone(),
        })
        .collect())
}

/// The operator's own still-open rows from this meeting's ledger.
///
/// "Mine" is D27's classification, read off the row rather than recomputed here:
/// a commitment the ledger attributed to a named other person is theirs even
/// when that person has no Person record yet, and pushing those into a personal
/// reminders list would turn "what I owe" into "everything anyone said".
fn reminder_items(
    store: &MeetingStore,
    session_id: MeetingSessionId,
    meeting_title: &str,
) -> Result<Vec<ReminderItem>, StoreError> {
    let loops = store.meeting_loops(session_id)?;
    Ok(loops
        .rows
        .iter()
        .filter(|row| row.is_open() && row.is_mine())
        .map(|row| ReminderItem {
            title: bounded_title(&row.text),
            notes: format!("{meeting_title}\n{}", crate::query::loop_link(&row.loop_id)),
        })
        .collect())
}

fn bounded_title(text: &str) -> String {
    let trimmed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.chars().count() <= MAX_REMINDER_TITLE_CHARS {
        return trimmed;
    }
    trimmed
        .chars()
        .take(MAX_REMINDER_TITLE_CHARS - 1)
        .chain(std::iter::once('…'))
        .collect()
}

/// The wall clock: read once for a claim, and again for the outcome it finished
/// with.
fn now_utc_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// The real effects.
pub(crate) struct SystemEffects;

impl AutomationEffects for SystemEffects {
    fn write_reminders(&self, items: &[ReminderItem]) -> EffectOutcome {
        reminders::write(items)
    }

    fn run_shortcut(&self, name: &str, stdin: &[u8]) -> EffectOutcome {
        shortcut::run(name, stdin)
    }

    fn post_webhook(&self, url: &str, body: &[u8]) -> EffectOutcome {
        webhook::post(url, body)
    }
}

/// What a reminders run does about the grant it found.
///
/// `None` means proceed. The three refusals are separated because they are three
/// different things to tell somebody: macOS said no, macOS has not been asked
/// yet, and there is no Reminders on this machine at all. Both the macOS path and
/// the platforms without one go through this, so the mapping from a permission
/// state to a receipt exists once.
pub(crate) const fn reminders_gate(
    access: super::detection::calendar::CalendarAccess,
) -> Option<MeetingAutomationFailure> {
    use super::detection::calendar::CalendarAccess;
    match access {
        CalendarAccess::Authorized => None,
        // Not determined reads as denied *here* on purpose: this pass never
        // prompts, so "nobody has been asked" and "somebody said no" have the
        // same consequence after a meeting, and the difference is the settings
        // row's to explain.
        CalendarAccess::NotDetermined | CalendarAccess::Denied => {
            Some(MeetingAutomationFailure::PermissionDenied)
        }
        CalendarAccess::Unavailable => Some(MeetingAutomationFailure::Unavailable),
    }
}

/// Running a Shortcut the operator named.
///
/// `/usr/bin/shortcuts run <name>` with the export on stdin, as one argv vector
/// and no shell anywhere: the name is data, and a name containing a quote, a
/// semicolon or a newline has to be inert rather than clever. The absolute path
/// is deliberate — resolving `shortcuts` through `PATH` would let whatever the
/// app was launched from decide what runs.
mod shortcut {
    use super::{EffectOutcome, MeetingAutomationFailure, EFFECT_TIMEOUT};
    use std::io::Write;
    use std::process::{Command, Stdio};

    const SHORTCUTS_BINARY: &str = "/usr/bin/shortcuts";

    pub(super) fn run(name: &str, stdin: &[u8]) -> EffectOutcome {
        if !std::path::Path::new(SHORTCUTS_BINARY).exists() {
            return EffectOutcome::failed(MeetingAutomationFailure::Unavailable, None);
        }
        let mut child = match Command::new(SHORTCUTS_BINARY)
            .arg("run")
            .arg(name)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(_) => return EffectOutcome::failed(MeetingAutomationFailure::Unavailable, None),
        };
        // Writing before waiting, and dropping the pipe afterwards, so a
        // Shortcut that reads all of stdin sees EOF and one that reads none does
        // not deadlock this thread against a full pipe buffer.
        if let Some(pipe) = child.stdin.as_mut() {
            let _ = pipe.write_all(stdin);
        }
        drop(child.stdin.take());
        match wait_bounded(&mut child) {
            Some(status) if status.success() => EffectOutcome::committed(1, None),
            Some(status) => EffectOutcome::failed(
                MeetingAutomationFailure::Rejected,
                Some(match status.code() {
                    Some(code) => format!("shortcut exited {code}"),
                    None => "shortcut was signalled".to_string(),
                }),
            ),
            None => EffectOutcome::failed(MeetingAutomationFailure::TimedOut, None),
        }
    }

    /// Wait for the child, killing it at the bound.
    ///
    /// `wait_timeout` is not in std, and a Shortcut is a program the operator
    /// wrote that may wait on a dialog forever, so the bound is enforced by
    /// polling and then killing. The poll interval is coarse on purpose: this is
    /// a background pass, and a tenth of a second of latency on a thirty-second
    /// bound costs nothing while a tight loop would burn a core.
    fn wait_bounded(child: &mut std::process::Child) -> Option<std::process::ExitStatus> {
        let deadline = std::time::Instant::now() + EFFECT_TIMEOUT;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => return Some(status),
                Ok(None) => {}
                Err(_) => return None,
            }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
}

/// POSTing the export to a host on the operator's own network.
mod webhook {
    use super::{EffectOutcome, MeetingAutomationFailure, EFFECT_TIMEOUT};

    pub(super) fn post(url: &str, body: &[u8]) -> EffectOutcome {
        // Re-parsed here rather than trusted from the caller: this is the last
        // line before a socket, and the host check has to sit on the same string
        // the request will use.
        let parsed = match url::Url::parse(url) {
            Ok(parsed) => parsed,
            Err(_) => return EffectOutcome::failed(MeetingAutomationFailure::TargetInvalid, None),
        };
        if !crate::net_policy::is_private_relay_host(parsed.host_str()) {
            return EffectOutcome::failed(MeetingAutomationFailure::HostNotAllowed, None);
        }
        let client = match reqwest::Client::builder()
            // A redirect is a host this app never approved. Following one would
            // make the allowlist advisory.
            .redirect(reqwest::redirect::Policy::none())
            .timeout(EFFECT_TIMEOUT)
            .build()
        {
            Ok(client) => client,
            Err(_) => return EffectOutcome::failed(MeetingAutomationFailure::Unavailable, None),
        };
        let body = body.to_vec();
        let request = client
            .post(parsed)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body);
        // Blocking on this thread rather than handing the app an async task:
        // the pass owns a bounded worker thread already, and the receipt has to
        // be written by whoever learned the outcome.
        match tauri::async_runtime::block_on(request.send()) {
            Ok(response) if response.status().is_success() => {
                EffectOutcome::committed(1, Some(format!("HTTP {}", response.status().as_u16())))
            }
            Ok(response) => EffectOutcome::failed(
                MeetingAutomationFailure::Rejected,
                Some(format!("HTTP {}", response.status().as_u16())),
            ),
            Err(error) if error.is_timeout() => {
                EffectOutcome::failed(MeetingAutomationFailure::TimedOut, None)
            }
            Err(_) => EffectOutcome::failed(MeetingAutomationFailure::Rejected, None),
        }
    }
}

/// Writing reminders through EventKit.
///
/// Reminders need their own grant, separate from the calendar's, and it is asked
/// for lazily: the first time the operator turns this automation on, from the
/// command behind that switch, and never from this pass. A pass that asked would
/// raise a system dialog after a meeting the operator has already walked away
/// from — and would raise it again after the next one. Denied is a hint on the
/// settings row and a `permission_denied` receipt, nothing more.
#[cfg(target_os = "macos")]
mod reminders {
    use super::{EffectOutcome, MeetingAutomationFailure, ReminderItem, REMINDERS_LIST};
    use crate::meeting::detection::calendar::CalendarAccess;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_event_kit::{
        EKAuthorizationStatus, EKCalendar, EKEntityType, EKEventStore, EKReminder,
    };
    use objc2_foundation::{NSError, NSString};
    use std::sync::mpsc;
    use std::time::Duration;

    /// Long enough for a person to read a system dialog and answer it. Same
    /// bound, and the same reason, as the calendar grant's: the command behind a
    /// settings switch is awaited by the UI, and a switch that never returns is
    /// worse than one reporting "not determined".
    const AUTHORIZATION_TIMEOUT: Duration = Duration::from_secs(120);

    /// Whether reminders may be written, without asking for anything.
    pub(crate) fn access() -> CalendarAccess {
        // SAFETY: a class method reading TCC state; no arguments to violate.
        let status =
            unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Reminder) };
        match status {
            EKAuthorizationStatus::NotDetermined => CalendarAccess::NotDetermined,
            // Reminders are the one entity where write-only is enough: this app
            // writes rows and never reads them back.
            EKAuthorizationStatus::FullAccess | EKAuthorizationStatus::WriteOnly => {
                CalendarAccess::Authorized
            }
            _ => CalendarAccess::Denied,
        }
    }

    /// Ask macOS for the reminders grant. Blocks until the operator answers, so
    /// only the settings command calls it.
    pub(crate) fn request_access() -> CalendarAccess {
        if access() == CalendarAccess::Authorized {
            return CalendarAccess::Authorized;
        }
        let store = new_store();
        let (sender, receiver) = mpsc::channel::<bool>();
        let completion = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            let _ = sender.send(granted.as_bool());
        });
        // SAFETY: EventKit retains the block for the request's duration, and the
        // block only sends into a channel this scope owns.
        unsafe {
            store.requestFullAccessToRemindersWithCompletion(RcBlock::as_ptr(&completion));
        }
        match receiver.recv_timeout(AUTHORIZATION_TIMEOUT) {
            // Re-read TCC rather than trusting the boolean the callback carried.
            Ok(_) => access(),
            Err(_) => CalendarAccess::NotDetermined,
        }
    }

    pub(super) fn write(items: &[ReminderItem]) -> EffectOutcome {
        if let Some(failure) = super::reminders_gate(access()) {
            return EffectOutcome::failed(failure, None);
        }
        objc2::rc::autoreleasepool(|_| {
            let store = new_store();
            let Some(calendar) = sona_list(&store) else {
                return EffectOutcome::failed(
                    MeetingAutomationFailure::Rejected,
                    Some(format!("no \"{REMINDERS_LIST}\" list")),
                );
            };
            let mut written = 0u32;
            for item in items {
                // SAFETY: a fresh reminder from this store, then plain property
                // writes on it; every argument outlives the call.
                let saved = unsafe {
                    let reminder = EKReminder::reminderWithEventStore(&store);
                    reminder.setTitle(Some(&NSString::from_str(&item.title)));
                    reminder.setNotes(Some(&NSString::from_str(&item.notes)));
                    reminder.setCalendar(Some(&calendar));
                    store.saveReminder_commit_error(&reminder, false)
                };
                if saved.is_err() {
                    // One commit for the whole batch below, so a refusal here
                    // means nothing has been written yet and the receipt can say
                    // so honestly.
                    return EffectOutcome::failed(
                        MeetingAutomationFailure::Rejected,
                        Some("EventKit refused a reminder".to_string()),
                    );
                }
                written = written.saturating_add(1);
            }
            // SAFETY: committing this store's own pending saves.
            match unsafe { store.commit() } {
                Ok(()) => EffectOutcome::committed(
                    written,
                    Some(format!("{written} into \"{REMINDERS_LIST}\"")),
                ),
                Err(_) => EffectOutcome::failed(
                    MeetingAutomationFailure::Rejected,
                    Some("EventKit refused the commit".to_string()),
                ),
            }
        })
    }

    fn new_store() -> Retained<EKEventStore> {
        // SAFETY: `EKEventStore::new` is a plain allocation and init; it requests
        // nothing and prompts for nothing.
        unsafe { EKEventStore::new() }
    }

    /// The "Sona" reminders list, created on first use.
    ///
    /// `None` when it neither exists nor can be made, which is a failed run
    /// rather than a quiet write into whatever list happened to be default:
    /// reminders this app created must be findable and deletable as a group.
    fn sona_list(store: &EKEventStore) -> Option<Retained<EKCalendar>> {
        // SAFETY: a plain query for this store's reminder lists.
        let existing = unsafe { store.calendarsForEntityType(EKEntityType::Reminder) };
        for calendar in existing.iter() {
            // SAFETY: plain property read on a live calendar.
            let title = unsafe { calendar.title() };
            if title.to_string() == REMINDERS_LIST {
                return Some(calendar);
            }
        }
        // SAFETY: a new list on this store, homed on the same source as the
        // operator's default list so it lands where their other reminders live.
        unsafe {
            let calendar =
                EKCalendar::calendarForEntityType_eventStore(EKEntityType::Reminder, store);
            calendar.setTitle(&NSString::from_str(REMINDERS_LIST));
            calendar.setSource(store.defaultCalendarForNewReminders()?.source().as_deref());
            store
                .saveCalendar_commit_error(&calendar, true)
                .ok()
                .map(|()| calendar)
        }
    }
}

/// Reminders on platforms with no EventKit. Reporting `Unavailable` rather than
/// silently succeeding is what keeps the receipt honest on Linux and Windows.
#[cfg(not(target_os = "macos"))]
mod reminders {
    use super::{EffectOutcome, MeetingAutomationFailure, ReminderItem};
    use crate::meeting::detection::calendar::CalendarAccess;

    pub(crate) fn access() -> CalendarAccess {
        CalendarAccess::Unavailable
    }

    pub(crate) fn request_access() -> CalendarAccess {
        CalendarAccess::Unavailable
    }

    pub(super) fn write(_items: &[ReminderItem]) -> EffectOutcome {
        EffectOutcome::failed(
            super::reminders_gate(access()).unwrap_or(MeetingAutomationFailure::Unavailable),
            None,
        )
    }
}

/// Whether reminders may be written, for the settings row's hint.
pub fn reminders_access() -> super::detection::calendar::CalendarAccess {
    reminders::access()
}

/// Ask macOS for the reminders grant, from the switch that needs it.
pub fn request_reminders_access() -> super::detection::calendar::CalendarAccess {
    reminders::request_access()
}
