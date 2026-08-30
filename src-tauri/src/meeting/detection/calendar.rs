//! The calendar dimension: EventKit against the on-device Calendar store.
//!
//! Reading events requires **full access**, not read-only: Apple's own docs are
//! explicit that a read-only grant does not exist and that the write-only grant
//! can write but never read back. That is a heavy ask for a note-taking app, so
//! the request is lazy — it happens the first time the operator turns the
//! calendar sub-toggle on, never at launch and never as a side effect of the
//! master detection toggle.
//!
//! No event content is persisted, and only the one nearest event is read in
//! full. Every event in the lookahead window is reduced to a key, a title, a
//! participant count and two instants; the event the tick actually selects is
//! then read a second time for the facts the pre-meeting card shows — named
//! attendees with their answers, the event's notes, its calendar's title, and
//! the URL attached to it. Those live in the in-memory detection status until
//! the event passes. Nothing on this path writes to disk, and nothing writes
//! back to the Calendar store: Sona records meetings, it does not answer
//! invitations.

use super::machine::{CalendarAttendee, CalendarEventSummary, CalendarSignal, ParticipationStatus};

/// How far ahead to look for the next event. Wide enough that a tick can never
/// step over an event's start, narrow enough that the query stays trivial.
const LOOKAHEAD_MS: i64 = 2 * 60 * 60 * 1000;

/// Authorization for reading events, as the operator would recognize it.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum CalendarAccess {
    /// Never asked. The sub-toggle has not been turned on.
    NotDetermined,
    /// Full access granted: events are readable.
    Authorized,
    /// Denied, restricted, or downgraded to write-only. Detection continues on
    /// the ad-hoc path alone and says so in its status.
    Denied,
    /// No EventKit on this platform.
    Unavailable,
}

/// The calendar store, behind a trait so the runtime and the decision table can
/// both be exercised without a Calendar database or a TCC prompt.
pub trait CalendarSource: Send + Sync {
    fn access(&self) -> CalendarAccess;

    /// Requests full access. Blocks until the operator answers, so this is only
    /// ever called from the command that handles the sub-toggle being switched
    /// on, never from the detection tick.
    fn request_access(&self) -> CalendarAccess;

    /// The single event whose window is nearest `now`, or `None`. Returning one
    /// event rather than a list is deliberate: the decision table only ever asks
    /// about the current moment, and a list would invite callers to invent
    /// their own precedence.
    fn next_event(&self, now_utc_ms: i64, lookahead_ms: i64) -> Option<CalendarEventSummary>;
}

/// Used on non-macOS targets and whenever the sub-toggle is off.
pub struct NoCalendar;

impl CalendarSource for NoCalendar {
    fn access(&self) -> CalendarAccess {
        CalendarAccess::Unavailable
    }

    fn request_access(&self) -> CalendarAccess {
        CalendarAccess::Unavailable
    }

    fn next_event(&self, _now_utc_ms: i64, _lookahead_ms: i64) -> Option<CalendarEventSummary> {
        None
    }
}

/// Places the nearest event relative to `now`. Pure, so the T-60s boundary and
/// the started/ended transitions are testable without a calendar.
pub fn calendar_signal(event: Option<CalendarEventSummary>, now_utc_ms: i64) -> CalendarSignal {
    let Some(event) = event else {
        return CalendarSignal::Absent;
    };
    if now_utc_ms >= event.end_utc_ms {
        return CalendarSignal::Absent;
    }
    if now_utc_ms >= event.start_utc_ms {
        return CalendarSignal::Started { event };
    }
    // Rounds up, so an event 60.4s out reports 61 and stays outside the lead
    // window rather than prompting early.
    let seconds_to_start = (event.start_utc_ms - now_utc_ms + 999) / 1_000;
    CalendarSignal::Upcoming {
        event,
        seconds_to_start,
    }
}

pub fn lookahead_ms() -> i64 {
    LOOKAHEAD_MS
}

/// Maps `EKParticipantStatus`'s raw value onto the answer a person recognizes.
///
/// Keyed on the raw integer, and living outside the macOS module, so the one
/// rule that turns a framework constant into something a card renders is
/// testable without a Calendar database or a TCC prompt.
pub fn participation_status(raw: isize) -> ParticipationStatus {
    match raw {
        1 => ParticipationStatus::Pending,
        2 => ParticipationStatus::Accepted,
        3 => ParticipationStatus::Declined,
        4 => ParticipationStatus::Tentative,
        // 0 is Unknown. 5 Delegated, 6 Completed and 7 InProcess describe
        // reminders and task assignments, not an answer to an invitation, so
        // they report "no answer" rather than a fabricated attendance claim.
        _ => ParticipationStatus::Unknown,
    }
}

/// Reduces one raw participant to an attendee a card can name, or nothing.
///
/// A participant EventKit will not name is a chip that could say only
/// "someone". It is dropped here and survives in `attendee_count` alone, which
/// is the honest split: the event has N participants, and these are the ones
/// with names.
pub fn named_attendee(
    name: Option<&str>,
    status_raw: isize,
    is_self: bool,
) -> Option<CalendarAttendee> {
    let name = name?.trim();
    if name.is_empty() {
        return None;
    }
    Some(CalendarAttendee {
        name: name.to_string(),
        status: participation_status(status_raw),
        is_self,
    })
}

/// Trims one optional event string and treats an empty result as absent, so a
/// row is omitted rather than rendered blank.
pub fn event_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(target_os = "macos")]
pub use macos::EventKitCalendar;

#[cfg(target_os = "macos")]
mod macos {
    use super::{event_text, named_attendee, CalendarAccess, CalendarEventSummary, CalendarSource};
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEvent, EKEventStore};
    use objc2_foundation::{NSDate, NSError};
    use std::sync::mpsc;
    use std::sync::Mutex;
    use std::time::Duration;

    /// How long to wait for the operator to answer the TCC prompt before giving
    /// up on the reply. The grant still lands in TCC if they answer later; the
    /// next `access()` call sees it. This bound exists because the command is
    /// awaited by the settings toggle, and a toggle that never returns is worse
    /// than one that reports "not determined".
    const AUTHORIZATION_TIMEOUT: Duration = Duration::from_secs(120);

    /// Owns the one `EKEventStore`, created on first query rather than in `new`.
    ///
    /// `new` runs inside Tauri's `setup`, before the window exists, and
    /// constructing a store connects to CalendarAgent. Worse, it did so
    /// unconditionally: `detection_calendar_enabled` defaults to false, so the
    /// overwhelming majority of operators paid a calendar connection at every
    /// launch for a feature they had not turned on — while this module's own
    /// permission matrix promised the calendar was touched lazily and never at
    /// launch. Deferring it makes that promise true.
    pub struct EventKitCalendar {
        store: Mutex<Option<Retained<EKEventStore>>>,
    }

    // SAFETY: every use of `store` goes through the mutex, and EKEventStore's
    // event queries are documented as callable off the main thread.
    unsafe impl Send for EventKitCalendar {}
    unsafe impl Sync for EventKitCalendar {}

    impl EventKitCalendar {
        pub fn new() -> Self {
            Self {
                store: Mutex::new(None),
            }
        }

        /// Runs `body` against the one store, creating it on first use.
        ///
        /// The lock is held for the whole body, which is what the previous
        /// guard-returning accessor did too: EventKit's query APIs are callable
        /// off the main thread but not concurrently on one store, and both the
        /// tick thread and the settings command can arrive here.
        fn with_store<T>(&self, body: impl FnOnce(&EKEventStore) -> T) -> T {
            let mut store = self
                .store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            // SAFETY: `EKEventStore::new` is a plain allocation and init; it
            // requests nothing and prompts for nothing.
            let store = store.get_or_insert_with(|| unsafe { EKEventStore::new() });
            body(store)
        }
    }

    impl Default for EventKitCalendar {
        fn default() -> Self {
            Self::new()
        }
    }

    fn access_from_status(status: EKAuthorizationStatus) -> CalendarAccess {
        match status {
            EKAuthorizationStatus::NotDetermined => CalendarAccess::NotDetermined,
            EKAuthorizationStatus::FullAccess => CalendarAccess::Authorized,
            // Denied, restricted, and write-only all mean the same thing here:
            // events cannot be read.
            _ => CalendarAccess::Denied,
        }
    }

    impl CalendarSource for EventKitCalendar {
        fn access(&self) -> CalendarAccess {
            // SAFETY: a class method reading TCC state; no arguments to violate.
            let status =
                unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
            access_from_status(status)
        }

        fn request_access(&self) -> CalendarAccess {
            if self.access() == CalendarAccess::Authorized {
                return CalendarAccess::Authorized;
            }
            let (sender, receiver) = mpsc::channel::<bool>();
            let completion = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
                let _ = sender.send(granted.as_bool());
            });
            // SAFETY: EventKit retains the block for the request's duration, and
            // the block only sends into a channel this scope owns.
            self.with_store(|store| unsafe {
                store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&completion));
            });
            match receiver.recv_timeout(AUTHORIZATION_TIMEOUT) {
                // Re-read TCC rather than trusting the boolean: a write-only
                // grant reports success but still cannot read events.
                Ok(_) => self.access(),
                Err(_) => CalendarAccess::NotDetermined,
            }
        }

        fn next_event(&self, now_utc_ms: i64, lookahead_ms: i64) -> Option<CalendarEventSummary> {
            if self.access() != CalendarAccess::Authorized {
                return None;
            }
            objc2::rc::autoreleasepool(|_| {
                self.with_store(|store| {
                    // Start the window in the past so an event already under way
                    // is still found; `calendar_signal` sorts out where it sits.
                    let start = NSDate::dateWithTimeIntervalSince1970(
                        (now_utc_ms - lookahead_ms) as f64 / 1_000.0,
                    );
                    let end = NSDate::dateWithTimeIntervalSince1970(
                        (now_utc_ms + lookahead_ms) as f64 / 1_000.0,
                    );
                    // `None` calendars means "every calendar the store sees".
                    // SAFETY: both dates are live for this construction call.
                    let predicate = unsafe {
                        store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None)
                    };
                    // SAFETY: the predicate came from this same store.
                    let events = unsafe { store.eventsMatchingPredicate(&predicate) };
                    // Two passes on purpose. The cheap summary runs over every
                    // event in the window; the content read — notes, attendee
                    // names, calendar title, URL — runs once, on the one event
                    // that won. An agenda pasted into a recurring event is
                    // kilobytes of string, and reading it for a dozen events
                    // every fifteen seconds to throw eleven away is the kind of
                    // waste that never shows up in a profile and never stops
                    // costing.
                    events
                        .iter()
                        .filter_map(|event| summarize(&event).map(|summary| (event, summary)))
                        .filter(|(_, summary)| summary.end_utc_ms > now_utc_ms)
                        .min_by_key(|(_, summary)| (summary.start_utc_ms - now_utc_ms).abs())
                        .map(|(event, mut summary)| {
                            enrich(&event, &mut summary);
                            summary
                        })
                })
            })
        }
    }

    /// Reduces an `EKEvent` to the fields the decision table reads, and nothing
    /// more. `enrich` adds the rest, for the one event that is selected.
    fn summarize(event: &EKEvent) -> Option<CalendarEventSummary> {
        // SAFETY: plain property reads on a live event.
        let (start, end, all_day) =
            unsafe { (event.startDate(), event.endDate(), event.isAllDay()) };
        // An all-day event is a label on the day, not something that starts. It
        // would otherwise fire a countdown at every midnight.
        if all_day {
            return None;
        }
        let start_utc_ms = instant_ms(&start);
        let end_utc_ms = instant_ms(&end);
        if end_utc_ms <= start_utc_ms {
            return None;
        }
        // SAFETY: plain property reads on a live event.
        let (identifier, title, attendees) = unsafe {
            (
                event.calendarItemIdentifier(),
                event.title(),
                event.attendees(),
            )
        };
        let event_key = identifier.to_string();
        if event_key.is_empty() {
            return None;
        }
        Some(CalendarEventSummary {
            event_key,
            title: title.to_string(),
            // A nil attendee list counts as zero, which §5.3 case 9 treats the
            // same as a solo block. Under-counting here suppresses a prompt;
            // over-counting would raise one for a personal reminder.
            attendee_count: attendees.map_or(0, |attendees| attendees.len()),
            start_utc_ms,
            end_utc_ms,
            // Filled by `enrich`, for the selected event only.
            attendees: Vec::new(),
            notes: None,
            calendar_name: None,
            url: None,
        })
    }

    /// Adds the facts the pre-meeting card renders to an already-selected
    /// event. Every one of them stays absent when EventKit reports nothing, so
    /// a card omits the row rather than showing an empty one.
    fn enrich(event: &EKEvent, summary: &mut CalendarEventSummary) {
        // SAFETY: plain property reads on a live event.
        let (attendees, notes, calendar, url) = unsafe {
            (
                event.attendees(),
                event.notes(),
                event.calendar(),
                event.URL(),
            )
        };
        if let Some(attendees) = attendees {
            summary.attendees = attendees
                .iter()
                .filter_map(|participant| {
                    // SAFETY: plain property reads on a live participant.
                    let (name, status, is_self) = unsafe {
                        (
                            participant.name(),
                            participant.participantStatus(),
                            participant.isCurrentUser(),
                        )
                    };
                    let name = name.map(|name| name.to_string());
                    named_attendee(name.as_deref(), status.0, is_self)
                })
                .collect();
        }
        summary.notes = event_text(notes.map(|notes| notes.to_string()));
        // SAFETY: `title` is a plain property read on a live calendar.
        summary.calendar_name =
            event_text(calendar.map(|calendar| unsafe { calendar.title() }.to_string()));
        summary.url = event_text(
            url.and_then(|url| url.absoluteString())
                .map(|absolute| absolute.to_string()),
        );
    }

    fn instant_ms(date: &NSDate) -> i64 {
        (date.timeIntervalSince1970() * 1_000.0) as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_700_000_000_000;

    fn event(start_offset_ms: i64, duration_ms: i64) -> CalendarEventSummary {
        CalendarEventSummary {
            event_key: "event-1".to_string(),
            title: "Quarterly planning".to_string(),
            attendee_count: 3,
            start_utc_ms: NOW + start_offset_ms,
            end_utc_ms: NOW + start_offset_ms + duration_ms,
            attendees: Vec::new(),
            notes: None,
            calendar_name: None,
            url: None,
        }
    }

    #[test]
    fn no_event_reads_as_an_absent_signal() {
        assert_eq!(calendar_signal(None, NOW), CalendarSignal::Absent);
    }

    #[test]
    fn an_event_under_way_reads_as_started() {
        let signal = calendar_signal(Some(event(-60_000, 30 * 60_000)), NOW);

        assert!(matches!(signal, CalendarSignal::Started { .. }));
    }

    #[test]
    fn a_finished_event_reads_as_absent() {
        let signal = calendar_signal(Some(event(-60 * 60_000, 30 * 60_000)), NOW);

        assert_eq!(signal, CalendarSignal::Absent);
    }

    #[test]
    fn the_lead_countdown_rounds_away_from_prompting_early() {
        let CalendarSignal::Upcoming {
            seconds_to_start, ..
        } = calendar_signal(Some(event(60_400, 30 * 60_000)), NOW)
        else {
            panic!("an event 60.4s out is still upcoming");
        };

        assert_eq!(
            seconds_to_start, 61,
            "rounding up keeps a 60.4s event outside the T-60s window"
        );
    }

    #[test]
    fn an_event_exactly_at_the_lead_boundary_reports_sixty() {
        let CalendarSignal::Upcoming {
            seconds_to_start, ..
        } = calendar_signal(Some(event(60_000, 30 * 60_000)), NOW)
        else {
            panic!("an event 60s out is still upcoming");
        };

        assert_eq!(seconds_to_start, 60);
    }

    #[test]
    fn the_start_instant_flips_upcoming_to_started() {
        let signal = calendar_signal(Some(event(0, 30 * 60_000)), NOW);

        assert!(matches!(signal, CalendarSignal::Started { .. }));
    }

    #[test]
    fn an_absent_calendar_never_produces_an_event() {
        assert_eq!(NoCalendar.access(), CalendarAccess::Unavailable);
        assert_eq!(NoCalendar.next_event(NOW, lookahead_ms()), None);
    }

    /* EKParticipantStatus's raw values, as the framework defines them. Written
     * out rather than imported so the test still fails if the mapping is
     * silently re-pointed at some other integer. */
    const RAW_UNKNOWN: isize = 0;
    const RAW_PENDING: isize = 1;
    const RAW_ACCEPTED: isize = 2;
    const RAW_DECLINED: isize = 3;
    const RAW_TENTATIVE: isize = 4;
    const RAW_DELEGATED: isize = 5;
    const RAW_COMPLETED: isize = 6;
    const RAW_IN_PROCESS: isize = 7;

    #[test]
    fn every_answer_a_person_can_give_maps_to_its_own_state() {
        assert_eq!(
            participation_status(RAW_PENDING),
            ParticipationStatus::Pending
        );
        assert_eq!(
            participation_status(RAW_ACCEPTED),
            ParticipationStatus::Accepted
        );
        assert_eq!(
            participation_status(RAW_DECLINED),
            ParticipationStatus::Declined
        );
        assert_eq!(
            participation_status(RAW_TENTATIVE),
            ParticipationStatus::Tentative
        );
    }

    #[test]
    fn task_states_report_no_answer_rather_than_an_invented_one() {
        for raw in [RAW_UNKNOWN, RAW_DELEGATED, RAW_COMPLETED, RAW_IN_PROCESS] {
            assert_eq!(
                participation_status(raw),
                ParticipationStatus::Unknown,
                "raw status {raw} is not an answer to an invitation"
            );
        }
    }

    #[test]
    fn an_unknown_future_status_reports_no_answer() {
        assert_eq!(participation_status(99), ParticipationStatus::Unknown);
    }

    #[test]
    fn a_named_participant_carries_their_answer_and_whether_they_are_you() {
        assert_eq!(
            named_attendee(Some("  Aktan Azat  "), RAW_ACCEPTED, true),
            Some(CalendarAttendee {
                name: "Aktan Azat".to_string(),
                status: ParticipationStatus::Accepted,
                is_self: true,
            })
        );
    }

    #[test]
    fn a_participant_eventkit_will_not_name_is_dropped() {
        assert_eq!(named_attendee(None, RAW_ACCEPTED, false), None);
        assert_eq!(named_attendee(Some("   "), RAW_ACCEPTED, false), None);
    }

    #[test]
    fn blank_event_text_reads_as_absent_so_its_row_is_omitted() {
        assert_eq!(event_text(None), None);
        assert_eq!(event_text(Some("   \n ".to_string())), None);
        assert_eq!(
            event_text(Some("  Agenda: ship the card  ".to_string())),
            Some("Agenda: ship the card".to_string())
        );
    }
}
