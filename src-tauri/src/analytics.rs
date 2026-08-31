use anyhow::{anyhow, Result};
use chrono::{DateTime, Days, Duration, Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use specta::Type;

/// The only calendar windows exposed by dashboard trend commands.
///
/// Each variant names its wire string outright. `rename_all = "snake_case"`
/// cannot be trusted here: serde leaves a digit attached to the preceding word
/// (`days30`) while specta splits it off (`days_30`), so the generated bindings
/// published one spelling to the webview while the command deserializer only
/// accepted the other, and every trend request failed on arrival.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub enum DashboardTrendRange {
    #[serde(rename = "days_7")]
    Days7,
    #[serde(rename = "days_30")]
    Days30,
    #[serde(rename = "days_180")]
    Days180,
}

impl DashboardTrendRange {
    pub const fn days(self) -> usize {
        match self {
            Self::Days7 => 7,
            Self::Days30 => 30,
            Self::Days180 => 180,
        }
    }
}

/// Typed input shared by dashboard trend commands.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct DashboardTrendRequest {
    pub range: DashboardTrendRange,
}

/// One inclusive local-calendar range, bounded by the first representable
/// local instant of its first day and the day after its final day.
pub(crate) struct LocalCalendarRange {
    pub range: DashboardTrendRange,
    start: DateTime<Local>,
    end_exclusive: DateTime<Local>,
    start_local_date: NaiveDate,
    end_local_date: NaiveDate,
}

impl LocalCalendarRange {
    pub(crate) fn at(now: DateTime<Local>, range: DashboardTrendRange) -> Result<Self> {
        let end_local_date = now.date_naive();
        let start_local_date = end_local_date
            .checked_sub_days(Days::new(
                u64::try_from(range.days().saturating_sub(1))
                    .map_err(|_| anyhow!("trend range does not fit in calendar days"))?,
            ))
            .ok_or_else(|| anyhow!("trend range predates the supported calendar"))?;
        let start = local_midnight(start_local_date)?;
        let end_exclusive = local_midnight(
            end_local_date
                .checked_add_days(Days::new(1))
                .ok_or_else(|| anyhow!("trend range exceeds the supported calendar"))?,
        )?;

        Ok(Self {
            range,
            start,
            end_exclusive,
            start_local_date,
            end_local_date,
        })
    }

    pub(crate) fn start_utc_seconds(&self) -> i64 {
        self.start.timestamp()
    }

    pub(crate) fn end_exclusive_utc_seconds(&self) -> i64 {
        self.end_exclusive.timestamp()
    }

    pub(crate) fn start_utc_ms(&self) -> i64 {
        self.start.timestamp_millis()
    }

    pub(crate) fn end_exclusive_utc_ms(&self) -> i64 {
        self.end_exclusive.timestamp_millis()
    }

    pub(crate) fn start_local_date(&self) -> String {
        self.start_local_date.format("%F").to_string()
    }

    pub(crate) fn end_local_date(&self) -> String {
        self.end_local_date.format("%F").to_string()
    }

    pub(crate) fn local_dates(&self) -> Result<Vec<NaiveDate>> {
        (0..self.range.days())
            .map(|offset| {
                self.start_local_date
                    .checked_add_days(Days::new(
                        u64::try_from(offset).map_err(|_| {
                            anyhow!("trend day offset does not fit in calendar days")
                        })?,
                    ))
                    .ok_or_else(|| anyhow!("trend range exceeds the supported calendar"))
            })
            .collect()
    }
}

/// Resolve the first representable local instant on `date`, normally midnight.
///
/// `pub(crate)` because D28's calendar window cuts its days at exactly the same
/// boundary the trend ranges do, and a second answer to "where does a local day
/// begin" is a bug waiting for a spring-forward morning.
pub(crate) fn local_midnight(date: NaiveDate) -> Result<DateTime<Local>> {
    let midnight = date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| anyhow!("calendar day has no midnight"))?;
    if let Some(resolved) = Local.from_local_datetime(&midnight).earliest() {
        return Ok(resolved);
    }

    for seconds in 1_i64..86_400 {
        let candidate = midnight
            .checked_add_signed(Duration::seconds(seconds))
            .ok_or_else(|| anyhow!("calendar day exceeds the supported calendar"))?;
        if let Some(resolved) = Local.from_local_datetime(&candidate).earliest() {
            return Ok(resolved);
        }
    }

    Err(anyhow!("calendar day cannot be represented locally"))
}

/// The first representable local instant of the day `days - 1` days before
/// today, in UTC milliseconds: "the last `days` local calendar days, today
/// included", which is what every range in this product means. The ms-valued
/// twin of `LocalCalendarRange::at`'s start bound, sharing `local_midnight`
/// with it so the two can never disagree about where a day begins.
pub(crate) fn local_days_start_utc_ms(now: DateTime<Local>, days: u32) -> Result<i64> {
    let first_date = now
        .date_naive()
        .checked_sub_days(Days::new(u64::from(days.saturating_sub(1))))
        .ok_or_else(|| anyhow!("calendar window predates the supported calendar"))?;
    Ok(local_midnight(first_date)?.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trend_ranges_are_limited_to_supported_calendar_windows() {
        assert_eq!(DashboardTrendRange::Days7.days(), 7);
        assert_eq!(DashboardTrendRange::Days30.days(), 30);
        assert_eq!(DashboardTrendRange::Days180.days(), 180);
        assert!(serde_json::from_str::<DashboardTrendRequest>(r#"{"range":"days_14"}"#).is_err());
    }

    /// The webview only ever sends the strings the generated bindings declare,
    /// so a range this deserializer rejects is a trend command that always
    /// fails and a Capture page that always apologizes. Asserting the two
    /// spellings against each other is the only check that catches a case-rule
    /// disagreement between serde and specta.
    #[test]
    fn every_trend_range_deserializes_from_the_string_the_bindings_publish() {
        let bindings = specta_typescript::export::<DashboardTrendRange>(
            &specta_typescript::Typescript::default(),
        )
        .expect("export the trend range binding");

        for range in [
            DashboardTrendRange::Days7,
            DashboardTrendRange::Days30,
            DashboardTrendRange::Days180,
        ] {
            let wire = serde_json::to_string(&range).expect("serialize range");
            assert!(
                bindings.contains(&wire),
                "{wire} is missing from the generated binding {bindings}"
            );
            assert_eq!(
                serde_json::from_str::<DashboardTrendRequest>(&format!(r#"{{"range":{wire}}}"#))
                    .expect("deserialize the published range string")
                    .range,
                range
            );
        }
    }

    #[test]
    fn trend_ranges_cover_every_requested_local_calendar_day() {
        let now = Local::now();
        for range in [
            DashboardTrendRange::Days7,
            DashboardTrendRange::Days30,
            DashboardTrendRange::Days180,
        ] {
            let calendar =
                LocalCalendarRange::at(now.clone(), range).expect("local calendar range");
            let dates = calendar.local_dates().expect("local dates");

            assert_eq!(dates.len(), range.days());
            assert_eq!(dates.first().copied(), Some(calendar.start_local_date));
            assert_eq!(dates.last().copied(), Some(calendar.end_local_date));
            assert_eq!(calendar.start.date_naive(), calendar.start_local_date);
            assert_eq!(
                calendar.end_exclusive.date_naive(),
                calendar
                    .end_local_date
                    .checked_add_days(Days::new(1))
                    .expect("day after range")
            );
            assert!(calendar.start < calendar.end_exclusive);
        }
    }
}
