use crate::managers::history::HistoryManager;
use crate::meeting::session::MeetingSessionManager;
use crate::query::{QueryCursor, QueryError, QueryEventsPage, QueryScope, QuerySearchPage};
use std::sync::Arc;
use tauri::State;

/// Search every noun this app keeps, through one API.
///
/// `cursor` comes from the previous page's `next_cursor` and belongs to the
/// query that produced it: the page order depends on the query text, so a
/// cursor from a different search is not a position in this one.
#[tauri::command]
#[specta::specta]
pub async fn sona_query_search(
    meetings: State<'_, Arc<MeetingSessionManager>>,
    history: State<'_, Arc<HistoryManager>>,
    scope: QueryScope,
    query: String,
    limit: Option<usize>,
    cursor: Option<QueryCursor>,
) -> Result<QuerySearchPage, QueryError> {
    crate::query::search(&meetings, &history, scope, &query, limit, cursor).await
}

/// What happened, newest first. `after_id` is the last event id the caller
/// already saw.
#[tauri::command]
#[specta::specta]
pub async fn sona_query_events(
    meetings: State<'_, Arc<MeetingSessionManager>>,
    after_id: Option<String>,
    limit: Option<usize>,
) -> Result<QueryEventsPage, QueryError> {
    crate::query::events(&meetings, after_id, limit).await
}
