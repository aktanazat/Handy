//! The time budget for one capture's cross-process reads.
//!
//! Reading another application's window is an out-of-process request that
//! blocks for as long as that application is wedged. A per-read timeout alone
//! does not bound a capture: the platform read walks several elements, so N
//! wedged reads cost N timeouts and the slowest source starves the rest. One
//! deadline per capture bounds the group, and each read is given only what is
//! left of it.

use std::time::{Duration, Instant};

/// Time one capture may spend inside cross-process reads. It sits inside the
/// 400 ms join in [`super`], so a capture whose slow sources stall still
/// delivers the sources that answered - starting with the frontmost
/// application's identity, which needs no cross-process read at all.
const CAPTURE_BUDGET: Duration = Duration::from_millis(350);

/// Longest single read. One wedged read must not spend the whole budget.
const MAX_READ_TIMEOUT: Duration = Duration::from_millis(250);

/// Shortest read worth starting: below this a responsive target would be
/// abandoned mid-answer. The last read of a capture may therefore end up to
/// this much past the deadline, which bounds one capture's reads at 400 ms.
const MIN_READ_TIMEOUT: Duration = Duration::from_millis(50);

/// What the next cross-process read may spend.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReadBudget {
    /// Start the read with this messaging timeout.
    Remaining(Duration),
    /// The budget is spent. Start no further read for this capture.
    Timeout,
}

/// One capture's deadline, copied by value into every reader.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CaptureDeadline {
    expires_at: Instant,
}

impl CaptureDeadline {
    pub(crate) fn starting_now() -> Self {
        Self::expiring_at(Instant::now() + CAPTURE_BUDGET)
    }

    fn expiring_at(expires_at: Instant) -> Self {
        Self { expires_at }
    }

    /// The messaging timeout for the next read, or `Timeout` once the budget is
    /// spent. A caller that gets `Timeout` reports `ContextSourceStatus::Failed`
    /// for the source it was about to read: that status already means "failed or
    /// did not answer in time", and a wedged target and a spent budget are the
    /// same fact to the user.
    ///
    /// This is a deadline, not a cancellation. A read already in flight runs to
    /// its own timeout, which is what `MAX_READ_TIMEOUT` bounds.
    pub(crate) fn next_read(self) -> ReadBudget {
        self.next_read_at(Instant::now())
    }

    fn next_read_at(self, now: Instant) -> ReadBudget {
        match self.expires_at.checked_duration_since(now) {
            None => ReadBudget::Timeout,
            Some(remaining) if remaining.is_zero() => ReadBudget::Timeout,
            Some(remaining) => {
                ReadBudget::Remaining(remaining.clamp(MIN_READ_TIMEOUT, MAX_READ_TIMEOUT))
            }
        }
    }

    /// The next read's messaging timeout in whole milliseconds, for a client
    /// that takes one — UI Automation's transaction timeout. `None` once the
    /// budget is spent.
    #[cfg(any(target_os = "windows", test))]
    pub(crate) fn next_read_millis(self) -> Option<u32> {
        match self.next_read() {
            // Every bound in this module is well under `u32::MAX` milliseconds,
            // so the saturating arm is unreachable arithmetic, not a policy.
            ReadBudget::Remaining(timeout) => {
                Some(u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX))
            }
            ReadBudget::Timeout => None,
        }
    }

    /// Whether another read may start, for a transport that offers no
    /// per-request timeout — D-Bus. The budget bounds how many reads a capture
    /// starts; the caller's join bounds how long the group may take.
    #[cfg(any(target_os = "linux", test))]
    pub(crate) fn may_start_read(self) -> bool {
        matches!(self.next_read(), ReadBudget::Remaining(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, millis: u64) -> Instant {
        start + Duration::from_millis(millis)
    }

    #[test]
    fn a_fresh_capture_gets_the_per_read_cap_not_the_whole_budget() {
        let ReadBudget::Remaining(timeout) = CaptureDeadline::starting_now().next_read() else {
            panic!("a fresh capture has budget left");
        };
        assert_eq!(timeout, MAX_READ_TIMEOUT);
    }

    #[test]
    fn each_read_gets_only_the_time_that_is_left() {
        let start = Instant::now();
        let deadline = CaptureDeadline::expiring_at(at(start, 350));

        assert_eq!(
            deadline.next_read_at(at(start, 200)),
            ReadBudget::Remaining(Duration::from_millis(150))
        );
        assert_eq!(
            deadline.next_read_at(at(start, 260)),
            ReadBudget::Remaining(Duration::from_millis(90))
        );
    }

    #[test]
    fn a_read_is_never_started_below_the_floor() {
        let start = Instant::now();
        let deadline = CaptureDeadline::expiring_at(at(start, 350));

        assert_eq!(
            deadline.next_read_at(at(start, 340)),
            ReadBudget::Remaining(MIN_READ_TIMEOUT)
        );
    }

    #[test]
    fn a_spent_budget_starts_no_further_read() {
        let start = Instant::now();
        let deadline = CaptureDeadline::expiring_at(at(start, 350));

        assert_eq!(deadline.next_read_at(at(start, 350)), ReadBudget::Timeout);
        assert_eq!(deadline.next_read_at(at(start, 9_000)), ReadBudget::Timeout);
    }

    #[test]
    fn a_wedged_target_cannot_hold_a_capture_past_the_bound() {
        // Every read runs to its own timeout, and one answers just early enough
        // to start a floor-length last read. That is the worst case.
        let start = Instant::now();
        let deadline = CaptureDeadline::expiring_at(at(start, 350));
        let mut now = start;
        let mut reads = 0;

        while let ReadBudget::Remaining(timeout) = deadline.next_read_at(now) {
            now += timeout;
            if now == at(start, 350) {
                now -= Duration::from_millis(5);
            }
            reads += 1;
            assert!(reads <= 16, "the budget must converge, not loop");
        }

        assert_eq!(now.duration_since(start), Duration::from_millis(395));
        assert!(now <= at(start, 400));
    }

    /// The Windows reader spends the budget as a UI Automation transaction
    /// timeout, which is a whole number of milliseconds.
    #[test]
    fn a_millisecond_client_gets_the_same_budget_the_deadline_hands_out() {
        let fresh = CaptureDeadline::starting_now();
        assert_eq!(
            fresh.next_read_millis(),
            Some(MAX_READ_TIMEOUT.as_millis() as u32)
        );

        let spent = CaptureDeadline::expiring_at(Instant::now());
        assert_eq!(spent.next_read_millis(), None);
    }

    /// The Linux reader cannot bound one D-Bus request, so the budget decides
    /// whether another read starts at all.
    #[test]
    fn a_transport_without_timeouts_still_stops_starting_reads() {
        assert!(CaptureDeadline::starting_now().may_start_read());
        assert!(!CaptureDeadline::expiring_at(Instant::now()).may_start_read());
    }
}
