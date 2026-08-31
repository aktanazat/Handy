//! D22 at the manager boundary: read a series' automations, or change one.
//!
//! Thin, like `series.rs` beside it. The store owns the rows, the fence and the
//! receipt; this layer maps store errors onto the command error the webview
//! understands, and stamps the wall clock a receipt records as its requested-at.
//!
//! One method here is not thin, and is the exception on purpose:
//! [`MeetingSessionManager::enable_series_reminders`] asks macOS for the
//! reminders grant before it writes. Reminders need their own TCC grant, and the
//! only honest moment to ask for it is the press that turns the automation on —
//! not at launch, where it would be a dialog about a feature nobody enabled, and
//! not after a meeting, where it would be a dialog about a meeting that already
//! ended. Denied is reported back so the row can carry a hint; the write still
//! happens, because "I want this on, and macOS has not been persuaded yet" is a
//! real state and forgetting the operator's choice would be worse than a hint.

use super::automation_types::{
    MeetingAutomationKind, MeetingAutomationRoster, MeetingAutomationRunReceipt,
    MeetingSeriesAutomationMutationResult, MeetingSeriesAutomationSetRequest,
    MeetingSeriesAutomationsSnapshot,
};
use super::detection::calendar::CalendarAccess;
use super::session::MeetingSessionManager;
use super::types::{MeetingCommandError, MeetingSessionId};
use super::workflow_engine::{map_store_error, now_utc_ms};
use serde::{Deserialize, Serialize};
use specta::Type;

/// A write, plus whether macOS will let the reminders kind actually run.
///
/// The access state rides back with the mutation rather than being a second
/// command the surface has to remember to call: the only reason to ask is that
/// somebody just turned this on, and answering in the same breath is what lets
/// the row show a hint instead of the settings page showing a banner.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct MeetingSeriesAutomationEnableResult {
    pub mutation: MeetingSeriesAutomationMutationResult,
    pub reminders_access: CalendarAccess,
}

impl MeetingSessionManager {
    /// What one series has chosen, for a surface that knows the key.
    pub async fn series_automations(
        &self,
        series_key: String,
    ) -> Result<MeetingSeriesAutomationsSnapshot, MeetingCommandError> {
        self.store()
            .await?
            .series_automations(&series_key)
            .map_err(map_store_error)
    }

    /// What the series behind one meeting has chosen.
    pub async fn series_automations_for_session(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingSeriesAutomationsSnapshot, MeetingCommandError> {
        self.store()
            .await?
            .series_automations_for_session(session_id)
            .map_err(map_store_error)
    }

    /// Turn one kind on or off for one series.
    ///
    /// Asks macOS for the reminders grant only when this request is switching
    /// the reminders kind *on*, and only ever from here — the pass that runs
    /// after a meeting never asks for anything.
    pub async fn set_series_automation(
        &self,
        request: MeetingSeriesAutomationSetRequest,
    ) -> Result<MeetingSeriesAutomationEnableResult, MeetingCommandError> {
        let wants_reminders = request.enabled && request.kind == MeetingAutomationKind::Reminders;
        let reminders_access = if wants_reminders {
            // Blocking on a TCC dialog would hold the async runtime's worker, so
            // the wait happens on a thread made for waiting.
            tauri::async_runtime::spawn_blocking(super::automations::request_reminders_access)
                .await
                .unwrap_or(CalendarAccess::NotDetermined)
        } else {
            super::automations::reminders_access()
        };
        let mutation = self
            .store()
            .await?
            .set_series_automation(&request, now_utc_ms())
            .map_err(map_store_error)?;
        Ok(MeetingSeriesAutomationEnableResult {
            mutation,
            reminders_access,
        })
    }

    /// Every series this machine has recorded a meeting for, with its
    /// automations, for the settings surface that lists them.
    pub async fn automation_roster(&self) -> Result<MeetingAutomationRoster, MeetingCommandError> {
        self.store()
            .await?
            .automation_roster()
            .map_err(map_store_error)
    }

    /// Every automation attempt made for one meeting.
    pub async fn automation_runs(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<Vec<MeetingAutomationRunReceipt>, MeetingCommandError> {
        self.store()
            .await?
            .automation_runs(session_id)
            .map_err(map_store_error)
    }
}
