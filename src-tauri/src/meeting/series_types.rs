//! D21: the notes template a recurring meeting is remembered by.
//!
//! A series is identified by the same `series_key` standing consent and loop 4's
//! priming already use — EventKit's calendar-item identifier — so "this series"
//! means exactly what it means everywhere else in the app. A meeting with no
//! calendar event behind it has no series and therefore no preference; that is
//! the `None` in every shape below, not an error.

use super::analytics::MeetingNotesTemplate;
use super::types::{MeetingOperationId, OperationReceipt};
use serde::{Deserialize, Serialize};
use specta::Type;

/// What one series has chosen, and the fence a write against it must carry.
///
/// `series_key` is `None` when the surface asking has no series at all — a
/// manual recording, or a meeting whose calendar event was never captured.
/// `template` is `None` when the series exists but has made no choice, which is
/// the state that lets artifact generation fall through to the app default.
///
/// `revision` counts every series-preference write on this machine rather than
/// only this series'. Two windows editing two different series is not a real
/// collision, but a shared counter costs one retry in that case and removes a
/// per-row revision column that nothing else would read.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingSeriesTemplateSnapshot {
    pub series_key: Option<String>,
    pub template: Option<MeetingNotesTemplate>,
    pub revision: u64,
}

/// Choose, or unchoose, the template for one series.
///
/// `template: None` clears the preference and hands the series back to the app
/// default. It is the same mutation as choosing, receipt and fence included,
/// because "stop remembering this" is a decision a person makes on purpose.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingSeriesTemplateSetRequest {
    pub operation_id: MeetingOperationId,
    pub series_key: String,
    pub template: Option<MeetingNotesTemplate>,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingSeriesTemplateMutationResult {
    pub receipt: OperationReceipt,
    pub snapshot: MeetingSeriesTemplateSnapshot,
}
