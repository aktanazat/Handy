use anyhow::{anyhow, Result};
use chrono::{DateTime, Days, Duration, Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use specta::Type;

/// The only calendar windows exposed by dashboard trend commands.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DashboardTrendRange {
    Days7,
    Days30,
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
fn local_midnight(date: NaiveDate) -> Result<DateTime<Local>> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trend_ranges_are_limited_to_supported_calendar_windows() {
        assert_eq!(DashboardTrendRange::Days7.days(), 7);
        assert_eq!(DashboardTrendRange::Days30.days(), 30);
        assert_eq!(DashboardTrendRange::Days180.days(), 180);
        assert_eq!(
            serde_json::to_string(&DashboardTrendRange::Days7).expect("serialize range"),
            r#""days7""#
        );
        assert_eq!(
            serde_json::from_str::<DashboardTrendRequest>(r#"{"range":"days7"}"#)
                .expect("deserialize range")
                .range,
            DashboardTrendRange::Days7
        );
        assert!(serde_json::from_str::<DashboardTrendRequest>(r#"{"range":"days_14"}"#).is_err());
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
