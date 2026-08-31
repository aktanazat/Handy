//! Per-series preferences at the manager boundary: read what a series has
//! decided, or change one of those decisions.
//!
//! Seven methods, all thin. The store owns the rows, the join onto standing
//! consent, and the fence; this layer only maps store errors onto the command
//! error the webview understands, and stamps the wall clock a receipt records
//! as its requested-at.

use super::series_types::{
    MeetingSeriesAlwaysRecordSetRequest, MeetingSeriesDigestSetRequest,
    MeetingSeriesMutationResult, MeetingSeriesPreferences, MeetingSeriesRemoteOptOutSetRequest,
    MeetingSeriesRemoteRoster, MeetingSeriesTemplateSetRequest,
};
use super::session::MeetingSessionManager;
use super::types::{MeetingCommandError, MeetingSessionId};
use super::workflow_engine::{map_store_error, now_utc_ms};

impl MeetingSessionManager {
    /// What one series has decided, for a surface that already knows the key —
    /// the pre-meeting card, which reads it off the calendar event.
    pub async fn series_preferences(
        &self,
        series_key: String,
    ) -> Result<MeetingSeriesPreferences, MeetingCommandError> {
        self.store()
            .await?
            .series_preferences(&series_key)
            .map_err(map_store_error)
    }

    /// What the series behind one meeting has decided, for the review screen,
    /// which knows a session and nothing else.
    pub async fn series_preferences_for_session(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingSeriesPreferences, MeetingCommandError> {
        self.store()
            .await?
            .series_preferences_for_session(session_id)
            .map_err(map_store_error)
    }

    /// The series the meeting-intelligence settings surface offers, for the one
    /// screen that needs a list rather than a key.
    pub async fn series_remote_roster(
        &self,
    ) -> Result<MeetingSeriesRemoteRoster, MeetingCommandError> {
        self.store()
            .await?
            .series_remote_roster()
            .map_err(map_store_error)
    }

    pub async fn set_series_template(
        &self,
        request: MeetingSeriesTemplateSetRequest,
    ) -> Result<MeetingSeriesMutationResult, MeetingCommandError> {
        self.store()
            .await?
            .set_series_template(&request, now_utc_ms())
            .map_err(map_store_error)
    }

    pub async fn set_series_digest(
        &self,
        request: MeetingSeriesDigestSetRequest,
    ) -> Result<MeetingSeriesMutationResult, MeetingCommandError> {
        self.store()
            .await?
            .set_series_digest(&request, now_utc_ms())
            .map_err(map_store_error)
    }

    pub async fn set_series_always_record(
        &self,
        request: MeetingSeriesAlwaysRecordSetRequest,
    ) -> Result<MeetingSeriesMutationResult, MeetingCommandError> {
        self.store()
            .await?
            .set_series_always_record(&request, now_utc_ms())
            .map_err(map_store_error)
    }

    pub async fn set_series_remote_opt_out(
        &self,
        request: MeetingSeriesRemoteOptOutSetRequest,
    ) -> Result<MeetingSeriesMutationResult, MeetingCommandError> {
        self.store()
            .await?
            .set_series_remote_opt_out(&request, now_utc_ms())
            .map_err(map_store_error)
    }
}
