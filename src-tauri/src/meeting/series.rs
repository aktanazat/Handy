//! D21 at the manager boundary: read a series' template, or choose one.
//!
//! Three methods, all thin. The store owns the rows and the fence; this layer
//! only maps store errors onto the command error the webview understands, and
//! stamps the wall clock a receipt records as its requested-at.

use super::series_types::{
    MeetingSeriesTemplateMutationResult, MeetingSeriesTemplateSetRequest,
    MeetingSeriesTemplateSnapshot,
};
use super::session::MeetingSessionManager;
use super::types::{MeetingCommandError, MeetingSessionId};
use super::workflow_engine::{map_store_error, now_utc_ms};

impl MeetingSessionManager {
    /// What one series has chosen, for a surface that already knows the key —
    /// the pre-meeting card, which reads it off the calendar event.
    pub async fn series_template(
        &self,
        series_key: String,
    ) -> Result<MeetingSeriesTemplateSnapshot, MeetingCommandError> {
        self.store()
            .await?
            .series_template(&series_key)
            .map_err(map_store_error)
    }

    /// What the series behind one meeting has chosen, for the review screen,
    /// which knows a session and nothing else.
    pub async fn series_template_for_session(
        &self,
        session_id: MeetingSessionId,
    ) -> Result<MeetingSeriesTemplateSnapshot, MeetingCommandError> {
        self.store()
            .await?
            .series_template_for_session(session_id)
            .map_err(map_store_error)
    }

    pub async fn set_series_template(
        &self,
        request: MeetingSeriesTemplateSetRequest,
    ) -> Result<MeetingSeriesTemplateMutationResult, MeetingCommandError> {
        self.store()
            .await?
            .set_series_template(&request, now_utc_ms())
            .map_err(map_store_error)
    }
}
