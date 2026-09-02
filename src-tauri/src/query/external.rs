//! The corpus as a process outside this app sees it: read-only, consent-gated,
//! one JSON object per invocation.
//!
//! This is the query plane's third client, after ⌘K and the panel agent, and
//! it is deliberately the thinnest of them. Everything it answers comes out of
//! [`crate::query`] or out of a `MeetingStore` read that already exists; the
//! only thing this module owns is the projection — which fields an outside
//! reader gets, and under what version — and the refusal.
//!
//! # The gate
//!
//! Nothing here reads the corpus until [`ExternalConsent`] says the operator
//! turned external access on. That is why every read goes through [`answer`]
//! and why [`answer`] takes the consent as its first argument rather than
//! reading it itself: a caller cannot forget to ask, and there is no second
//! door. The refusal names the settings row, so an agent that hits it can tell
//! its human where to click instead of guessing that Sona is broken.
//!
//! # Why the projections are not the app's own types
//!
//! `MeetingHistorySummary`, `MeetingLoopRow` and `PersonListEntry` are shaped
//! for the views that render them and change when those views do. An external
//! contract that re-exported them would break on every UI refactor, silently,
//! in somebody else's script. So each verb has a narrow projection here, all of
//! them stamped with [`QUERY_SCHEMA_VERSION`] — the same number the plane's own
//! pages carry, because these are the same nouns out of the same corpus, and a
//! second version to bump in lockstep is a second thing to get wrong.
//!
//! # Read-only
//!
//! No verb on this surface mutates. That is not a policy this module enforces
//! with a check; it is that every call below is a `SELECT`.

use super::{
    loop_link, meeting_link, person_link, QueryError, QueryEventsPage, QueryScope, QuerySearchPage,
    QUERY_SCHEMA_VERSION,
};
use crate::cli::CliArgs;
use crate::managers::history::HistoryManager;
use crate::meeting::detection::calendar::{CalendarAccess, CalendarSource};
use crate::meeting::loop_types::{
    MeetingLoopDirection, MeetingLoopId, MeetingLoopKind, MeetingLoopResolution,
    MeetingLoopResolveRequest, MeetingLoopRow, MeetingLoopStatus,
};
use crate::meeting::people_types::{PersonListEntry, PersonMeetingHeadline};
use crate::meeting::session::MeetingSessionManager;
use crate::meeting::store::MeetingStore;
use crate::meeting::types::{
    EffectiveTranscriptSegment, MeetingCommandError, MeetingHistoryHeadline, MeetingHistorySummary,
    MeetingListFilter, MeetingOperationId, MeetingPhase, MeetingReviewSnapshot, MeetingSessionId,
    OperationReceipt, OperationResult,
};
use crate::meeting::upcoming::{upcoming_window, UPCOMING_DEFAULT_DAYS};
use crate::meeting::upcoming_types::MeetingUpcomingRow;
use crate::settings::AppSettings;
use chrono::{Local, NaiveDate, TimeZone};
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

/// Where a person turns each scope on. Named in the refusal so an agent that is
/// refused can say where to click; written once so the CLI, the MCP server and
/// the settings rows cannot drift apart about what the rows are called.
pub const EXTERNAL_ACCESS_SETTING_PATH: &str = "Settings > Agents > External access";
pub const EXTERNAL_MUTATIONS_SETTING_PATH: &str = "Settings > Agents > External mutations";

/// How many rows a verb returns when the caller names no limit, and the most
/// it will return when they name a large one. The plane's own page sizes,
/// because these pages are the same pages.
const DEFAULT_LIMIT: usize = 25;
const MAX_LIMIT: usize = 100;

/// How deep the corpus-wide loop scan goes before a verb stops looking. Loops
/// are derived from ledger JSON rather than indexed, so this is a real bound
/// on `--loops`, set the same way [`super::LOOP_SCAN_DEPTH`] is: well above
/// what a person who closes loops will ever have.
const LOOP_SCAN_DEPTH: usize = 500;

/// What a verb needs the operator to have allowed.
///
/// Two scopes rather than one, and not a ladder: reading the corpus and
/// changing it are different questions, and a person who let a script read
/// their meetings has not said whether it may close their loops. A `Mutate`
/// verb therefore checks its own row and only its own row — there is no state
/// in which mutations are on and this surface silently reads more than the read
/// row allows, because every read verb is `Read` and asks for that one.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExternalScope {
    Read,
    Mutate,
}

impl ExternalScope {
    /// The settings row that opens this scope.
    const fn settings_path(self) -> &'static str {
        match self {
            Self::Read => EXTERNAL_ACCESS_SETTING_PATH,
            Self::Mutate => EXTERNAL_MUTATIONS_SETTING_PATH,
        }
    }

    /// What the refusal says. Whole sentences rather than a fragment stitched
    /// into one template: each scope names a different row and grants a
    /// different thing, and this copy is what an agent repeats to its human.
    const fn refusal(self) -> &'static str {
        match self {
            Self::Read => "External access is off. Turn on Settings > Agents > External access in Sona to allow read-only corpus queries.",
            Self::Mutate => "External mutations are off. Turn on Settings > Agents > External mutations in Sona to allow changes to the corpus.",
        }
    }
}

/// Which scopes the operator has opened to processes outside this app.
///
/// One value carrying both answers rather than a `bool` per callsite, because
/// it is the only thing standing between an agent on this Mac and every meeting
/// on it, and a `true` at a callsite says nothing about which `true` it is.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExternalConsent {
    reads: bool,
    mutations: bool,
}

impl ExternalConsent {
    pub fn from_settings(settings: &AppSettings) -> Self {
        Self {
            reads: settings.external_query_enabled,
            mutations: settings.external_mutations_enabled,
        }
    }

    const fn allows(self, scope: ExternalScope) -> bool {
        match scope {
            ExternalScope::Read => self.reads,
            ExternalScope::Mutate => self.mutations,
        }
    }
}

/// Why a request produced no answer. Machine tokens: a caller branches on
/// these, and the MCP server passes them through unchanged.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalErrorCode {
    /// The scope this verb needs is off. The one refusal that is a choice
    /// rather than a fault, which is why it carries the settings path.
    ConsentRequired,
    /// The corpus cannot be opened: the OS keychain is locked or refused, or
    /// meeting storage failed to mount.
    Unavailable,
    /// A flag combination, id, date or limit this surface will not answer.
    InvalidRequest,
    /// The id parsed but names nothing in this corpus.
    NotFound,
    Failed,
}

impl ExternalErrorCode {
    /// The process exit code this refusal leaves. Two is bad input, matching
    /// what the rest of the headless surface already means by it; everything
    /// else — including a withheld consent, which is a refusal rather than a
    /// typo — is one.
    pub const fn exit_code(self) -> i32 {
        match self {
            Self::InvalidRequest => 2,
            _ => 1,
        }
    }
}

/// One refusal, as it is printed on stderr.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalError {
    pub schema_version: u32,
    pub error: ExternalErrorCode,
    pub message: String,
    /// Present only on [`ExternalErrorCode::ConsentRequired`], because it is
    /// the only refusal a human can clear by clicking something.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings_path: Option<&'static str>,
}

impl ExternalError {
    fn new(error: ExternalErrorCode, message: impl Into<String>) -> Self {
        Self {
            schema_version: QUERY_SCHEMA_VERSION,
            error,
            message: message.into(),
            settings_path: None,
        }
    }

    fn consent_required(scope: ExternalScope) -> Self {
        Self {
            schema_version: QUERY_SCHEMA_VERSION,
            error: ExternalErrorCode::ConsentRequired,
            message: scope.refusal().to_string(),
            settings_path: Some(scope.settings_path()),
        }
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self::new(ExternalErrorCode::InvalidRequest, message)
    }
}

impl From<QueryError> for ExternalError {
    fn from(error: QueryError) -> Self {
        match error {
            QueryError::Unavailable => Self::new(
                ExternalErrorCode::Unavailable,
                "Meeting storage is not open. Unlock the login keychain and make sure Sona has run at least once.",
            ),
            QueryError::InvalidRequest => Self::invalid("The query plane refused this request."),
            QueryError::UnknownCursor => Self::new(
                ExternalErrorCode::NotFound,
                "That event id is no longer in the corpus. Start again without --after.",
            ),
            QueryError::Failed => Self::new(ExternalErrorCode::Failed, "The corpus read failed."),
        }
    }
}

/// Which loop rows `--loops` keeps. Narrower than [`MeetingLoopStatus`] on
/// purpose: `dropped` and `carried` are outcomes a reader sees on the rows
/// they get back, not questions they ask.
#[derive(Clone, Copy, Debug, Eq, PartialEq, clap::ValueEnum)]
pub enum ExternalLoopStatus {
    Open,
    Done,
}

/// Which side of a loop `--mine` and `--waiting` keep.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExternalLoopSide {
    Mine,
    WaitingOn,
}

/// One thing the corpus can answer or do, after the flags have been checked.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExternalRequest {
    Search {
        scope: QueryScope,
        query: String,
        limit: usize,
    },
    Meetings {
        /// Inclusive lower bound in UTC ms, from `--from`.
        since_utc_ms: Option<i64>,
        /// Exclusive upper bound in UTC ms: the start of the day after `--to`.
        before_utc_ms: Option<i64>,
        limit: usize,
    },
    Meeting {
        session_id: MeetingSessionId,
    },
    Transcript {
        session_id: MeetingSessionId,
    },
    Loops {
        status: Option<ExternalLoopStatus>,
        side: Option<ExternalLoopSide>,
        limit: usize,
    },
    People {
        name: String,
        limit: usize,
    },
    Events {
        after_id: Option<String>,
        limit: usize,
    },
    Upcoming {
        limit: usize,
    },
    /// The one verb here that writes.
    LoopResolve {
        loop_id: MeetingLoopId,
    },
}

impl ExternalRequest {
    /// Which grant this verb needs. The whole write/read split, in one match:
    /// adding a verb without answering this question does not compile.
    pub const fn scope(&self) -> ExternalScope {
        match self {
            Self::LoopResolve { .. } => ExternalScope::Mutate,
            _ => ExternalScope::Read,
        }
    }
}

/// A request the operator has allowed.
///
/// The gate is this type rather than a check inside [`answer`]: the only way to
/// obtain one is [`AllowedRequest::new`], which takes the consent and asks the
/// request which scope it needs, so there is no signature in this module that
/// touches the corpus without one having been presented. A future verb cannot
/// forget the check, because it cannot be called without it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowedRequest(ExternalRequest);

impl AllowedRequest {
    pub fn new(consent: ExternalConsent, request: ExternalRequest) -> Result<Self, ExternalError> {
        let scope = request.scope();
        if consent.allows(scope) {
            Ok(Self(request))
        } else {
            Err(ExternalError::consent_required(scope))
        }
    }

    pub fn request(&self) -> &ExternalRequest {
        &self.0
    }
}

/// Whether this invocation is the headless corpus surface rather than a
/// dictation run.
///
/// Read by `is_headless_mode` and by the headless branch that decides which
/// managers to build, so it has to answer without touching the corpus.
pub fn is_external_query(args: &CliArgs) -> bool {
    args.query.is_some()
        || args.meetings
        || args.meeting.is_some()
        || args.transcript.is_some()
        || args.loops
        || args.people.is_some()
        || args.events
        || args.upcoming
        || args.loop_resolve.is_some()
}

impl ExternalRequest {
    /// The request these flags name.
    ///
    /// Clap has already rejected two verbs at once and the modifier
    /// combinations that contradict each other, so what is left here is the
    /// checking clap cannot do: that an id is a uuid, that a date is a date,
    /// and that a limit is a number of rows.
    pub fn from_args(args: &CliArgs) -> Result<Self, ExternalError> {
        let limit = match args.limit {
            None => DEFAULT_LIMIT,
            Some(0) => return Err(ExternalError::invalid("--limit must be at least 1.")),
            Some(limit) => limit.min(MAX_LIMIT),
        };
        if let Some(query) = args.query.as_ref() {
            return Ok(Self::Search {
                scope: args.scope.unwrap_or_default(),
                query: query.clone(),
                limit,
            });
        }
        if args.meetings {
            let last = match args.last {
                None => None,
                Some(0) => return Err(ExternalError::invalid("--last must be at least 1.")),
                Some(last) => Some(last.min(MAX_LIMIT)),
            };
            return Ok(Self::Meetings {
                since_utc_ms: args.from.as_deref().map(day_start_utc_ms).transpose()?,
                before_utc_ms: args.to.as_deref().map(next_day_start_utc_ms).transpose()?,
                limit: last.unwrap_or(limit),
            });
        }
        if let Some(id) = args.meeting.as_ref() {
            return Ok(Self::Meeting {
                session_id: session_id(id)?,
            });
        }
        if let Some(id) = args.transcript.as_ref() {
            return Ok(Self::Transcript {
                session_id: session_id(id)?,
            });
        }
        if args.loops {
            return Ok(Self::Loops {
                status: args.status,
                side: match (args.mine, args.waiting) {
                    (true, _) => Some(ExternalLoopSide::Mine),
                    (_, true) => Some(ExternalLoopSide::WaitingOn),
                    _ => None,
                },
                limit,
            });
        }
        if let Some(name) = args.people.as_ref() {
            return Ok(Self::People {
                name: name.clone(),
                limit,
            });
        }
        if args.events {
            return Ok(Self::Events {
                after_id: args.after.clone(),
                limit,
            });
        }
        if args.upcoming {
            return Ok(Self::Upcoming { limit });
        }
        if let Some(value) = args.loop_resolve.as_ref() {
            return Ok(Self::LoopResolve {
                loop_id: loop_id(value)?,
            });
        }
        Err(ExternalError::invalid(
            "No verb was named. Pass one of --query, --meetings, --meeting, --transcript, --loops, --people, --events, --upcoming, --loop-resolve.",
        ))
    }
}

fn session_id(value: &str) -> Result<MeetingSessionId, ExternalError> {
    Uuid::parse_str(value.trim())
        .map(MeetingSessionId::from_uuid)
        .map_err(|_| ExternalError::invalid(format!("{value:?} is not a meeting id.")))
}

/// A loop's own address, checked as far as this surface can see: the meeting it
/// names has to be a uuid. The rest of the id is the ledger's business, which is
/// where a digest that matches nothing becomes a `not_found`.
fn loop_id(value: &str) -> Result<MeetingLoopId, ExternalError> {
    let value = value.trim();
    let malformed = || ExternalError::invalid(format!("{value:?} is not a loop id."));
    let id = MeetingLoopId(value.to_string());
    id.session_id().ok_or_else(malformed)?;
    if id.content_key().is_none_or(str::is_empty) {
        return Err(malformed());
    }
    Ok(id)
}

/// Midnight local time on `date`, as UTC milliseconds.
///
/// Local rather than UTC because `--from 2026-03-01` is a person naming a day
/// on their own calendar, and the meetings list they are comparing it against
/// is grouped by local day too.
fn day_start_utc_ms(date: &str) -> Result<i64, ExternalError> {
    let parsed = NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d")
        .map_err(|_| ExternalError::invalid(format!("{date:?} is not a YYYY-MM-DD date.")))?;
    let midnight = parsed
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| ExternalError::invalid(format!("{date:?} has no midnight.")))?;
    Local
        .from_local_datetime(&midnight)
        .earliest()
        .map(|moment| moment.timestamp_millis())
        // A date whose midnight a daylight-saving jump skipped: the day still
        // starts, one hour later, and `latest` is that instant.
        .or_else(|| {
            Local
                .from_local_datetime(&midnight)
                .latest()
                .map(|moment| moment.timestamp_millis())
        })
        .ok_or_else(|| ExternalError::invalid(format!("{date:?} is not a local date.")))
}

/// Midnight local time on the day after `date`. `--to` names a day the reader
/// wants included, so the bound below it is where the next one starts.
fn next_day_start_utc_ms(date: &str) -> Result<i64, ExternalError> {
    let parsed = NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d")
        .map_err(|_| ExternalError::invalid(format!("{date:?} is not a YYYY-MM-DD date.")))?;
    let next = parsed
        .succ_opt()
        .ok_or_else(|| ExternalError::invalid(format!("{date:?} has no day after it.")))?;
    day_start_utc_ms(&next.format("%Y-%m-%d").to_string())
}

/// One meeting in a list. The row a reader scans before deciding which meeting
/// to open.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalMeetingRow {
    pub id: Uuid,
    pub title: String,
    pub phase: MeetingPhase,
    pub when_utc_ms: i64,
    pub recorded_duration_ms: Option<i64>,
    pub speakers: Vec<String>,
    /// The meeting in one line, tagged with where the line came from: prose a
    /// model wrote, or a word count the store measured.
    pub headline: MeetingHistoryHeadline,
    pub link: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalMeetingsPage {
    pub schema_version: u32,
    pub entries: Vec<ExternalMeetingRow>,
    pub has_more: bool,
}

/// One meeting opened: what it was about, and what it left open.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalMeetingDetail {
    pub schema_version: u32,
    pub id: Uuid,
    pub title: String,
    pub phase: MeetingPhase,
    /// When capture began. Absent for a session that never started, which has
    /// nothing in it to read either.
    pub started_at_utc_ms: Option<i64>,
    pub speakers: Vec<String>,
    /// The generated summary of the current artifact revision. Absent until
    /// processing has produced one.
    pub summary: Option<String>,
    /// The ledger's reading of where the meeting landed, when it has one.
    pub headline: Option<String>,
    pub notes: Vec<String>,
    pub loops: Vec<ExternalLoopRow>,
    pub link: String,
}

/// One speaker-labelled line of a transcript.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalTranscriptLine {
    pub speaker: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalTranscript {
    pub schema_version: u32,
    pub meeting_id: Uuid,
    pub title: String,
    pub started_at_utc_ms: Option<i64>,
    pub lines: Vec<ExternalTranscriptLine>,
    pub link: String,
}

/// One actionable ledger row, with the meeting it was raised in.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalLoopRow {
    pub id: String,
    pub meeting_id: Uuid,
    pub meeting_title: String,
    pub kind: MeetingLoopKind,
    pub status: MeetingLoopStatus,
    /// Whose side of the conversation this is on: the user owes it, somebody
    /// else does, or the ledger never said.
    pub direction: MeetingLoopDirection,
    pub text: String,
    /// The person the row belongs to: the name the user picked when there is
    /// one, the name the ledger read otherwise.
    pub owner: Option<String>,
    pub when_utc_ms: i64,
    pub resolved_at_utc_ms: Option<i64>,
    pub link: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalLoopsPage {
    pub schema_version: u32,
    pub entries: Vec<ExternalLoopRow>,
    pub has_more: bool,
}

/// One person, as a profile lookup answers.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalPersonRow {
    pub id: Uuid,
    pub display_name: String,
    pub aliases: Vec<String>,
    pub calendar_emails: Vec<String>,
    pub meetings_count: u64,
    pub last_meeting_at_utc_ms: Option<i64>,
    pub last_meeting_title: Option<String>,
    pub last_meeting_headline: Option<String>,
    pub link: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalPeoplePage {
    pub schema_version: u32,
    pub entries: Vec<ExternalPersonRow>,
    pub has_more: bool,
}

/// One event in the week ahead.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalUpcomingRow {
    /// The occurrence's own key, which is what starts this specific event.
    pub event_key: String,
    pub title: String,
    pub start_utc_ms: i64,
    pub end_utc_ms: i64,
    /// Participants the calendar named, the operator's own entry excluded.
    pub attendees: Vec<String>,
    /// Participants including the ones the calendar refused to name, so it can
    /// exceed `attendees.len()`.
    pub attendee_count: u32,
    pub calendar_name: Option<String>,
    pub join_url: Option<String>,
    /// Present exactly when the event repeats.
    pub series_key: Option<String>,
    /// A standing grant covers this series, so its occurrences record
    /// themselves. `false` for a one-off, which has no series to grant.
    pub always_record: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalUpcomingPage {
    pub schema_version: u32,
    /// Whether the calendar is readable at all. An empty list under
    /// `authorized` is a free week; an empty list under anything else is a
    /// missing grant, and a reader has to be able to tell them apart.
    pub calendar_access: CalendarAccess,
    pub window_start_utc_ms: i64,
    pub window_end_utc_ms: i64,
    pub entries: Vec<ExternalUpcomingRow>,
    pub has_more: bool,
}

/// One mutation, as it is printed.
///
/// The receipt is the store's own [`OperationReceipt`], verbatim rather than
/// projected — unlike every row above it. A receipt is not a view of a noun, it
/// is the audit record of a write, and an outside reader that got a reshaped
/// copy could not compare what it did against what the app's own event stream
/// says it did.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ExternalReceipt {
    pub schema_version: u32,
    pub receipt: OperationReceipt,
}

/// One answer. Serialised untagged: the verb is what the caller asked for, so
/// repeating it in the payload would be a field nobody reads.
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum ExternalResponse {
    Search(QuerySearchPage),
    Meetings(ExternalMeetingsPage),
    Meeting(Box<ExternalMeetingDetail>),
    Transcript(ExternalTranscript),
    Loops(ExternalLoopsPage),
    People(ExternalPeoplePage),
    Events(QueryEventsPage),
    Upcoming(ExternalUpcomingPage),
    LoopResolve(ExternalReceipt),
}

impl ExternalResponse {
    /// The process exit code this answer leaves.
    ///
    /// Zero for every read, and for a write that landed. One for a write the
    /// fence rejected — which is an *answer*, not a refusal, so the receipt
    /// still goes to stdout and stderr stays empty. Without this a shell doing
    /// `sona --loop-resolve … && …` would read a rejected write as a closed
    /// loop, and the only thing telling it otherwise would be a JSON field it
    /// has to parse.
    const fn exit_code(&self) -> i32 {
        match self {
            Self::LoopResolve(answer) => match answer.receipt.result {
                OperationResult::Committed => 0,
                _ => 1,
            },
            _ => 0,
        }
    }
}

/// Answer one request the operator has allowed.
///
/// The store projections are this module's; `search` and `events` are the
/// plane's own pages, handed back unchanged, because a thin client that
/// reshaped them would be a second answer to a question
/// [`crate::query`] has already answered.
///
/// `calendar` is a collaborator rather than something looked up here because
/// this process builds no detection loop: `--upcoming` needs the calendar and
/// nothing else detection owns, and the headless branch hands over exactly that.
pub async fn answer(
    allowed: &AllowedRequest,
    meetings: &Arc<MeetingSessionManager>,
    history: &Arc<HistoryManager>,
    calendar: &dyn CalendarSource,
) -> Result<ExternalResponse, ExternalError> {
    match allowed.request() {
        ExternalRequest::Search {
            scope,
            query,
            limit,
        } => Ok(ExternalResponse::Search(
            super::search(meetings, history, *scope, query, Some(*limit), None).await?,
        )),
        ExternalRequest::Events { after_id, limit } => Ok(ExternalResponse::Events(
            super::events(meetings, after_id.clone(), Some(*limit)).await?,
        )),
        ExternalRequest::Meetings {
            since_utc_ms,
            before_utc_ms,
            limit,
        } => Ok(ExternalResponse::Meetings(meetings_page(
            store(meetings).await?.as_ref(),
            *since_utc_ms,
            *before_utc_ms,
            *limit,
        )?)),
        ExternalRequest::Meeting { session_id } => Ok(ExternalResponse::Meeting(Box::new(
            meeting_detail(store(meetings).await?.as_ref(), *session_id)?,
        ))),
        ExternalRequest::Transcript { session_id } => Ok(ExternalResponse::Transcript(transcript(
            store(meetings).await?.as_ref(),
            *session_id,
        )?)),
        ExternalRequest::Loops {
            status,
            side,
            limit,
        } => Ok(ExternalResponse::Loops(loops_page(
            store(meetings).await?.as_ref(),
            *status,
            *side,
            *limit,
        )?)),
        ExternalRequest::People { name, limit } => Ok(ExternalResponse::People(people_page(
            store(meetings).await?.as_ref(),
            name,
            *limit,
        )?)),
        ExternalRequest::Upcoming { limit } => Ok(ExternalResponse::Upcoming(
            upcoming_page(meetings, calendar, *limit).await?,
        )),
        ExternalRequest::LoopResolve { loop_id } => Ok(ExternalResponse::LoopResolve(
            resolve_loop(meetings, loop_id).await?,
        )),
    }
}

/// The mounted corpus, or the refusal that says why it is not open. Opening it
/// reads the OS credential store, which is where a locked keychain surfaces.
async fn store(meetings: &Arc<MeetingSessionManager>) -> Result<Arc<MeetingStore>, ExternalError> {
    meetings
        .store()
        .await
        .map_err(|error| QueryError::from(error).into())
}

/// The week ahead, as the Meetings home reads it, projected for an outside
/// reader.
///
/// The window is the pane's own — today plus [`UPCOMING_DEFAULT_DAYS`] more
/// local days — so a script and the screen answer the same question. `--limit`
/// cuts the rows rather than the window: a reader asking for three wants the
/// next three, not the next three days.
///
/// The calendar read blocks. It runs inline because this process has one job and
/// this is it, unlike `meeting_upcoming_events`, which is answering a window in
/// front of a webview.
async fn upcoming_page(
    meetings: &Arc<MeetingSessionManager>,
    calendar: &dyn CalendarSource,
    limit: usize,
) -> Result<ExternalUpcomingPage, ExternalError> {
    let window = upcoming_window(Local::now(), UPCOMING_DEFAULT_DAYS);
    let occurrences = calendar.events_between(window.0, window.1);
    let events = meetings
        .upcoming_events(calendar.access(), window, occurrences)
        .await
        .map_err(|error| ExternalError::from(QueryError::from(error)))?;
    let has_more = events.rows.len() > limit;
    Ok(ExternalUpcomingPage {
        schema_version: QUERY_SCHEMA_VERSION,
        calendar_access: events.access,
        window_start_utc_ms: events.window_start_utc_ms,
        window_end_utc_ms: events.window_end_utc_ms,
        entries: events
            .rows
            .into_iter()
            .take(limit)
            .map(upcoming_row)
            .collect(),
        has_more,
    })
}

fn upcoming_row(row: MeetingUpcomingRow) -> ExternalUpcomingRow {
    ExternalUpcomingRow {
        event_key: row.event_key,
        title: row.title,
        start_utc_ms: row.start_utc_ms,
        end_utc_ms: row.end_utc_ms,
        attendees: row
            .attendees
            .into_iter()
            .filter(|attendee| !attendee.is_self)
            .map(|attendee| attendee.name)
            .collect(),
        attendee_count: row.attendee_count,
        calendar_name: row.calendar_name,
        join_url: row.join_url,
        series_key: row.series.as_ref().map(|series| series.series_key.clone()),
        always_record: row.series.is_some_and(|series| series.always_record),
    }
}

/// Mark one loop done through the app's own resolve path.
///
/// Two steps because a mutation on this surface is fenced like every other one:
/// the loop rows of the meeting are read to learn the revision the write must
/// match, and the write is refused if the meeting moved in between. A CLI holds
/// no revision across invocations, so reading it immediately before is the only
/// honest fence available — and a rejection comes back as the receipt saying so
/// rather than as a silent overwrite.
async fn resolve_loop(
    meetings: &Arc<MeetingSessionManager>,
    loop_id: &MeetingLoopId,
) -> Result<ExternalReceipt, ExternalError> {
    let session_id = loop_id
        .session_id()
        .ok_or_else(|| ExternalError::invalid("That loop id names no meeting."))?;
    let loops = meetings
        .loops_list(session_id)
        .await
        .map_err(command_error(session_id.uuid()))?;
    if !loops.rows.iter().any(|row| &row.loop_id == loop_id) {
        return Err(ExternalError::new(
            ExternalErrorCode::NotFound,
            format!("No loop {} in this corpus.", loop_id.as_str()),
        ));
    }
    let result = meetings
        .loop_resolve(MeetingLoopResolveRequest {
            operation_id: MeetingOperationId::new(),
            loop_id: loop_id.clone(),
            expected_revision: loops.revision,
            resolution: MeetingLoopResolution::Done,
        })
        .await
        .map_err(command_error(session_id.uuid()))?;
    Ok(ExternalReceipt {
        schema_version: QUERY_SCHEMA_VERSION,
        receipt: result.receipt,
    })
}

/// A meeting command's refusal, as this surface reports it. `NotFound` is the
/// one that means something specific to a caller holding an id.
fn command_error(session: Uuid) -> impl Fn(MeetingCommandError) -> ExternalError {
    move |error| match error {
        MeetingCommandError::NotFound => ExternalError::new(
            ExternalErrorCode::NotFound,
            format!("No meeting {session} in this corpus."),
        ),
        error => QueryError::from(error).into(),
    }
}

/// One page of retained meetings, newest first.
///
/// `pub(crate)` for the reason [`super::assemble`] is: everything above it is
/// state lookup and `await`, and this is the half a fixture store can
/// exercise. The four projections below it are the same.
pub(crate) fn meetings_page(
    store: &MeetingStore,
    since_utc_ms: Option<i64>,
    before_utc_ms: Option<i64>,
    limit: usize,
) -> Result<ExternalMeetingsPage, ExternalError> {
    let page = store
        .list_sessions(before_utc_ms, limit, &MeetingListFilter::default())
        .map_err(QueryError::from)?;
    // The store's cursor is the upper bound, so `--to` is already applied. The
    // lower bound is a suffix of a newest-first page, which is why it can be
    // cut here rather than becoming a second list query nobody else needs.
    let mut entries = page.entries;
    let mut has_more = page.has_more;
    if let Some(since) = since_utc_ms {
        let kept = entries
            .iter()
            .take_while(|entry| entry.created_at_utc_ms >= since)
            .count();
        if kept < entries.len() {
            has_more = false;
        }
        entries.truncate(kept);
    }
    Ok(ExternalMeetingsPage {
        schema_version: QUERY_SCHEMA_VERSION,
        entries: entries.into_iter().map(meeting_row).collect(),
        has_more,
    })
}

fn meeting_row(summary: MeetingHistorySummary) -> ExternalMeetingRow {
    ExternalMeetingRow {
        id: summary.session_id.uuid(),
        title: summary.title,
        phase: summary.phase,
        when_utc_ms: summary.created_at_utc_ms,
        recorded_duration_ms: summary.recorded_duration_ms,
        speakers: summary.speaker_labels,
        headline: summary.headline,
        link: meeting_link(summary.session_id),
    }
}

pub(crate) fn meeting_detail(
    store: &MeetingStore,
    session_id: MeetingSessionId,
) -> Result<ExternalMeetingDetail, ExternalError> {
    let snapshot = review(store, session_id)?;
    let artifacts = current_artifacts(&snapshot);
    let loops = store
        .meeting_loops(session_id)
        .map_err(QueryError::from)?
        .rows;
    Ok(ExternalMeetingDetail {
        id: session_id.uuid(),
        title: snapshot.session.title.clone(),
        phase: snapshot.session.phase,
        started_at_utc_ms: snapshot.session.started_at_utc_ms,
        speakers: speaker_names(&snapshot),
        summary: artifacts
            .map(|content| content.summary.text.trim())
            .filter(|summary| !summary.is_empty())
            .map(str::to_string),
        headline: artifacts
            .and_then(|content| content.headline())
            .map(str::to_string),
        notes: snapshot
            .notes
            .iter()
            .map(|note| note.body.trim().to_string())
            .filter(|body| !body.is_empty())
            .collect(),
        loops: loops
            .into_iter()
            .map(|row| {
                loop_row(
                    row,
                    &snapshot.session.title,
                    snapshot.session.started_at_utc_ms.unwrap_or_default(),
                )
            })
            .collect(),
        link: meeting_link(session_id),
        schema_version: QUERY_SCHEMA_VERSION,
    })
}

pub(crate) fn transcript(
    store: &MeetingStore,
    session_id: MeetingSessionId,
) -> Result<ExternalTranscript, ExternalError> {
    let snapshot = review(store, session_id)?;
    let lines = snapshot
        .transcript
        .iter()
        .filter(|segment| !segment.removed)
        .filter_map(|segment| transcript_line(segment, &snapshot))
        .collect();
    Ok(ExternalTranscript {
        schema_version: QUERY_SCHEMA_VERSION,
        meeting_id: session_id.uuid(),
        title: snapshot.session.title.clone(),
        started_at_utc_ms: snapshot.session.started_at_utc_ms,
        lines,
        link: meeting_link(session_id),
    })
}

/// One transcript line, with the human edit applied and the speaker resolved.
///
/// A segment whose effective text is empty is not a line: the review screen
/// renders nothing for it either, and a reader parsing this stream would count
/// it as a turn that never happened.
fn transcript_line(
    segment: &EffectiveTranscriptSegment,
    snapshot: &MeetingReviewSnapshot,
) -> Option<ExternalTranscriptLine> {
    let text = segment
        .replacement_text
        .as_deref()
        .unwrap_or(segment.base.text.as_str())
        .trim();
    if text.is_empty() {
        return None;
    }
    let speaker = snapshot
        .speakers
        .iter()
        .find(|speaker| speaker.speaker_id == segment.assigned_speaker_id)
        .map(|speaker| speaker.display_name.clone())
        .unwrap_or_default();
    Some(ExternalTranscriptLine {
        speaker,
        start_ms: segment.base.start_offset_ns / 1_000_000,
        end_ms: segment.base.end_offset_ns / 1_000_000,
        text: text.to_string(),
    })
}

pub(crate) fn loops_page(
    store: &MeetingStore,
    status: Option<ExternalLoopStatus>,
    side: Option<ExternalLoopSide>,
    limit: usize,
) -> Result<ExternalLoopsPage, ExternalError> {
    let mut entries = Vec::new();
    let mut has_more = false;
    let mut scanned = 0usize;
    'corpus: for meeting in store.corpus_loops().map_err(QueryError::from)? {
        for row in meeting.rows {
            scanned += 1;
            if scanned > LOOP_SCAN_DEPTH {
                has_more = true;
                break 'corpus;
            }
            if !keeps_status(status, row.status) || !keeps_side(side, row.direction) {
                continue;
            }
            if entries.len() == limit {
                has_more = true;
                break 'corpus;
            }
            entries.push(loop_row(row, &meeting.title, meeting.at_utc_ms));
        }
    }
    Ok(ExternalLoopsPage {
        schema_version: QUERY_SCHEMA_VERSION,
        entries,
        has_more,
    })
}

const fn keeps_status(filter: Option<ExternalLoopStatus>, status: MeetingLoopStatus) -> bool {
    match filter {
        None => true,
        Some(ExternalLoopStatus::Open) => status.is_open(),
        Some(ExternalLoopStatus::Done) => matches!(status, MeetingLoopStatus::Done),
    }
}

const fn keeps_side(filter: Option<ExternalLoopSide>, direction: MeetingLoopDirection) -> bool {
    match filter {
        None => true,
        Some(ExternalLoopSide::Mine) => matches!(direction, MeetingLoopDirection::Mine),
        Some(ExternalLoopSide::WaitingOn) => matches!(direction, MeetingLoopDirection::WaitingOn),
    }
}

fn loop_row(row: MeetingLoopRow, meeting_title: &str, when_utc_ms: i64) -> ExternalLoopRow {
    ExternalLoopRow {
        link: loop_link(&row.loop_id),
        id: row.loop_id.as_str().to_string(),
        meeting_id: row.session_id.uuid(),
        meeting_title: meeting_title.to_string(),
        kind: row.kind,
        status: row.status,
        direction: row.direction,
        text: row.text,
        owner: row.owner_display_name.or(row.owner_text),
        when_utc_ms,
        resolved_at_utc_ms: row.resolved_at_utc_ms,
    }
}

pub(crate) fn people_page(
    store: &MeetingStore,
    name: &str,
    limit: usize,
) -> Result<ExternalPeoplePage, ExternalError> {
    let tokens = super::tokens(name);
    if tokens.is_empty() {
        return Err(ExternalError::invalid("--people needs a name to look up."));
    }
    let mut entries = Vec::new();
    let mut has_more = false;
    for entry in store.people_list().map_err(QueryError::from)?.entries {
        if !super::matches_every_token(&super::person_haystack(&entry), &tokens) {
            continue;
        }
        if entries.len() == limit {
            has_more = true;
            break;
        }
        entries.push(person_row(entry));
    }
    Ok(ExternalPeoplePage {
        schema_version: QUERY_SCHEMA_VERSION,
        entries,
        has_more,
    })
}

fn person_row(entry: PersonListEntry) -> ExternalPersonRow {
    let (last_meeting_title, last_meeting_headline) = match entry.last_meeting {
        None => (None, None),
        Some(meeting) => (
            Some(meeting.title),
            meeting.headline.map(|headline| match headline {
                PersonMeetingHeadline::Ledger { text }
                | PersonMeetingHeadline::Summary { text } => text,
            }),
        ),
    };
    ExternalPersonRow {
        id: entry.person.id.uuid(),
        display_name: entry.person.display_name,
        aliases: entry.person.aliases,
        calendar_emails: entry.person.calendar_emails,
        meetings_count: entry.meetings_count,
        last_meeting_at_utc_ms: entry.last_meeting_at_utc_ms,
        last_meeting_title,
        last_meeting_headline,
        link: person_link(entry.person.id),
    }
}

fn review(
    store: &MeetingStore,
    session_id: MeetingSessionId,
) -> Result<MeetingReviewSnapshot, ExternalError> {
    store
        .review_snapshot(session_id)
        .map_err(|error| match error {
            crate::meeting::store::StoreError::NotFound => ExternalError::new(
                ExternalErrorCode::NotFound,
                format!("No meeting {} in this corpus.", session_id.uuid()),
            ),
            error => QueryError::from(error).into(),
        })
}

/// The generated artifacts a reader is looking at: the current revision's, or
/// none while processing has not produced one.
fn current_artifacts(
    snapshot: &MeetingReviewSnapshot,
) -> Option<&crate::meeting::types::GeneratedMeetingArtifacts> {
    snapshot
        .artifacts
        .iter()
        .find(|revision| revision.state == crate::meeting::types::MeetingArtifactState::Current)
        .and_then(|revision| revision.content.as_ref())
}

/// The diarized speaker labels of a meeting, in the order the store assigned
/// them. Empty before diarization has named anybody.
fn speaker_names(snapshot: &MeetingReviewSnapshot) -> Vec<String> {
    snapshot
        .speakers
        .iter()
        .map(|speaker| speaker.display_name.clone())
        .collect()
}

/// Run one external request for the headless CLI, and report a process exit
/// code.
///
/// Stdout carries exactly one JSON value on success; stderr carries exactly
/// one JSON object on failure. Nothing else is printed on either, which is
/// what makes `sona --query … | jq` work while the app's own log lines are
/// going to stderr beside it.
pub fn run_cli(app: &tauri::AppHandle, args: &CliArgs) -> i32 {
    use tauri::Manager;

    let outcome = ExternalRequest::from_args(args)
        .and_then(|request| {
            AllowedRequest::new(
                ExternalConsent::from_settings(&crate::settings::get_settings(app)),
                request,
            )
        })
        .and_then(|allowed| {
            let meetings = app.state::<Arc<MeetingSessionManager>>();
            let history = app.state::<Arc<HistoryManager>>();
            let calendar = crate::meeting::detection::calendar::platform_calendar();
            tauri::async_runtime::block_on(answer(&allowed, &meetings, &history, calendar.as_ref()))
        });
    let printed = match outcome {
        Ok(response) => serde_json::to_string(&response).map(|json| {
            println!("{json}");
            response.exit_code()
        }),
        Err(error) => serde_json::to_string(&error).map(|json| {
            eprintln!("{json}");
            error.error.exit_code()
        }),
    };
    printed.unwrap_or_else(|error| {
        eprintln!(
            r#"{{"schema_version":{QUERY_SCHEMA_VERSION},"error":"failed","message":"The answer could not be serialized: {error}"}}"#
        );
        1
    })
}

#[cfg(test)]
mod tests {
    //! What the flags mean, and what happens when consent is off.
    //!
    //! Everything here is the half of the surface that needs no corpus: which
    //! request a command line names, which combinations clap refuses, and the
    //! exact refusal an outside agent gets. The store-backed half — that each
    //! verb reads what it claims to and projects the fields it documents —
    //! lives in `meeting/store/external_tests.rs`, where the encrypted-store
    //! fixture is.

    use super::*;
    use clap::Parser;

    const MEETING: &str = "1e1a5f0e-0000-4000-8000-000000000001";

    /// The loop id `--loop-resolve` is given in the tests below: any meeting
    /// uuid plus a content key, which is all this surface checks.
    const LOOP: &str = "1e1a5f0e-0000-4000-8000-000000000001:loop:0123456789abcdef";

    fn parse(argv: &[&str]) -> CliArgs {
        let mut command = vec!["sona"];
        command.extend_from_slice(argv);
        CliArgs::try_parse_from(command).expect("these flags parse")
    }

    fn request(argv: &[&str]) -> ExternalRequest {
        ExternalRequest::from_args(&parse(argv)).expect("these flags name a request")
    }

    fn refusal(argv: &[&str]) -> ExternalError {
        ExternalRequest::from_args(&parse(argv)).expect_err("these flags are refused")
    }

    /// The consent as the settings rows leave it: reads on, mutations on or
    /// off. Built from the real defaults so the test cannot disagree with the
    /// switches about what a fresh install allows.
    fn consent(reads: bool, mutations: bool) -> ExternalConsent {
        let mut settings = crate::settings::get_default_settings();
        settings.external_query_enabled = reads;
        settings.external_mutations_enabled = mutations;
        ExternalConsent::from_settings(&settings)
    }

    #[test]
    fn every_verb_names_its_own_request() {
        assert_eq!(
            request(&["--query", "dana"]),
            ExternalRequest::Search {
                scope: QueryScope::All,
                query: "dana".to_string(),
                limit: DEFAULT_LIMIT,
            }
        );
        assert_eq!(
            request(&["--meetings"]),
            ExternalRequest::Meetings {
                since_utc_ms: None,
                before_utc_ms: None,
                limit: DEFAULT_LIMIT,
            }
        );
        assert_eq!(
            request(&["--meeting", MEETING]),
            ExternalRequest::Meeting {
                session_id: MeetingSessionId::from_uuid(Uuid::parse_str(MEETING).unwrap()),
            }
        );
        assert_eq!(
            request(&["--transcript", MEETING]),
            ExternalRequest::Transcript {
                session_id: MeetingSessionId::from_uuid(Uuid::parse_str(MEETING).unwrap()),
            }
        );
        assert_eq!(
            request(&["--loops"]),
            ExternalRequest::Loops {
                status: None,
                side: None,
                limit: DEFAULT_LIMIT,
            }
        );
        assert_eq!(
            request(&["--people", "Dana Reyes"]),
            ExternalRequest::People {
                name: "Dana Reyes".to_string(),
                limit: DEFAULT_LIMIT,
            }
        );
        assert_eq!(
            request(&["--events"]),
            ExternalRequest::Events {
                after_id: None,
                limit: DEFAULT_LIMIT,
            }
        );
        assert_eq!(
            request(&["--upcoming"]),
            ExternalRequest::Upcoming {
                limit: DEFAULT_LIMIT,
            }
        );
        assert_eq!(
            request(&["--loop-resolve", LOOP]),
            ExternalRequest::LoopResolve {
                loop_id: MeetingLoopId(LOOP.to_string()),
            }
        );
    }

    #[test]
    fn modifiers_narrow_the_verb_they_belong_to() {
        assert_eq!(
            request(&["--query", "dana", "--scope", "people", "--limit", "5"]),
            ExternalRequest::Search {
                scope: QueryScope::People,
                query: "dana".to_string(),
                limit: 5,
            }
        );
        assert_eq!(
            request(&["--meetings", "--last", "3"]),
            ExternalRequest::Meetings {
                since_utc_ms: None,
                before_utc_ms: None,
                limit: 3,
            }
        );
        assert_eq!(
            request(&["--loops", "--status", "done", "--waiting"]),
            ExternalRequest::Loops {
                status: Some(ExternalLoopStatus::Done),
                side: Some(ExternalLoopSide::WaitingOn),
                limit: DEFAULT_LIMIT,
            }
        );
        assert_eq!(
            request(&["--loops", "--mine"]),
            ExternalRequest::Loops {
                status: None,
                side: Some(ExternalLoopSide::Mine),
                limit: DEFAULT_LIMIT,
            }
        );
        assert_eq!(
            request(&["--events", "--after", "abc", "--limit", "2"]),
            ExternalRequest::Events {
                after_id: Some("abc".to_string()),
                limit: 2,
            }
        );
    }

    /// `--to` names a day the reader wants included, so the window it opens is
    /// a whole civil day wide rather than ending at its midnight.
    #[test]
    fn a_one_day_window_includes_the_day_it_names() {
        let ExternalRequest::Meetings {
            since_utc_ms,
            before_utc_ms,
            ..
        } = request(&["--meetings", "--from", "2026-06-10", "--to", "2026-06-10"])
        else {
            panic!("--meetings names a meetings read");
        };

        assert_eq!(
            before_utc_ms.unwrap() - since_utc_ms.unwrap(),
            24 * 60 * 60 * 1_000,
            "one local day, midnight to midnight"
        );
    }

    #[test]
    fn a_page_is_bounded_and_a_zero_page_is_refused() {
        assert_eq!(
            request(&["--query", "dana", "--limit", "5000"]),
            ExternalRequest::Search {
                scope: QueryScope::All,
                query: "dana".to_string(),
                limit: MAX_LIMIT,
            }
        );
        for argv in [
            vec!["--query", "dana", "--limit", "0"],
            vec!["--meetings", "--last", "0"],
        ] {
            assert_eq!(
                refusal(&argv).error,
                ExternalErrorCode::InvalidRequest,
                "{argv:?}"
            );
        }
    }

    #[test]
    fn an_id_or_a_date_that_is_not_one_is_a_usage_error() {
        for argv in [
            vec!["--meeting", "not-a-uuid"],
            vec!["--transcript", "not-a-uuid"],
            vec!["--meetings", "--from", "yesterday", "--to", "2026-06-10"],
            vec!["--meetings", "--from", "2026-06-10", "--to", "2026-06-32"],
            vec!["--loop-resolve", "not-a-loop"],
            vec!["--loop-resolve", "loop:0123456789abcdef"],
            vec!["--loop-resolve", MEETING],
        ] {
            let refused = refusal(&argv);
            assert_eq!(refused.error, ExternalErrorCode::InvalidRequest, "{argv:?}");
            assert_eq!(refused.error.exit_code(), 2, "usage errors exit 2");
        }
    }

    /// One verb per invocation, and no modifier that means nothing on its own.
    /// Clap enforces these, so the check is that the groups are wired, not
    /// that clap works.
    #[test]
    fn contradictory_flags_do_not_parse() {
        for argv in [
            vec!["--meetings", "--loops"],
            vec!["--query", "dana", "--events"],
            vec!["--loops", "--mine", "--waiting"],
            vec!["--upcoming", "--loops"],
            vec!["--loop-resolve", LOOP, "--upcoming"],
            vec!["--loop-resolve", LOOP, "--query", "dana"],
            vec!["--scope", "people"],
            vec!["--status", "open"],
            vec!["--after", "abc"],
            vec!["--last", "3"],
            vec!["--meetings", "--last", "3", "--limit", "3"],
            vec!["--meetings", "--from", "2026-06-10"],
        ] {
            let mut command = vec!["sona"];
            command.extend_from_slice(&argv);
            assert!(
                CliArgs::try_parse_from(command).is_err(),
                "{argv:?} must not parse"
            );
        }
    }

    #[test]
    fn a_transcription_run_is_not_a_corpus_read() {
        assert!(!is_external_query(&parse(&[
            "--transcribe-file",
            "/tmp/example.wav"
        ])));
        assert!(is_external_query(&parse(&["--loops"])));
    }

    /// The refusal an outside agent gets, exactly as the MCP server passes it
    /// through: a machine token it can branch on, and the settings row a human
    /// has to click.
    #[test]
    fn a_withheld_read_consent_refuses_before_any_read() {
        let refused = AllowedRequest::new(consent(false, false), request(&["--query", "dana"]))
            .expect_err("external access is off");

        assert_eq!(
            serde_json::to_value(&refused).unwrap(),
            serde_json::json!({
                "schema_version": QUERY_SCHEMA_VERSION,
                "error": "consent_required",
                "message": "External access is off. Turn on Settings > Agents > External access in Sona to allow read-only corpus queries.",
                "settings_path": "Settings > Agents > External access",
            })
        );
        assert_eq!(refused.error.exit_code(), 1, "a refusal is not a typo");
    }

    #[test]
    fn a_granted_consent_carries_the_read_through() {
        let allowed = AllowedRequest::new(consent(true, false), request(&["--loops", "--mine"]))
            .expect("external access is on");

        assert_eq!(
            allowed.request(),
            &ExternalRequest::Loops {
                status: None,
                side: Some(ExternalLoopSide::Mine),
                limit: DEFAULT_LIMIT,
            }
        );
    }

    /// The whole point of the second row: a person who opened their corpus to
    /// readers has not agreed to a script closing their loops, so the write
    /// verb is refused on its own row and names that row rather than the read
    /// one.
    #[test]
    fn reading_the_corpus_does_not_grant_changing_it() {
        let refused = AllowedRequest::new(consent(true, false), request(&["--loop-resolve", LOOP]))
            .expect_err("external mutations are off");

        assert_eq!(refused.error, ExternalErrorCode::ConsentRequired);
        assert_eq!(
            refused.settings_path,
            Some(EXTERNAL_MUTATIONS_SETTING_PATH),
            "the refusal names the row that is off, not the one that is on"
        );
        assert!(
            AllowedRequest::new(consent(true, true), request(&["--loop-resolve", LOOP])).is_ok()
        );
    }

    /// And the other direction: the mutation row alone opens nothing to read.
    #[test]
    fn changing_the_corpus_does_not_grant_reading_it() {
        let refused = AllowedRequest::new(consent(false, true), request(&["--meetings"]))
            .expect_err("external access is off");

        assert_eq!(refused.settings_path, Some(EXTERNAL_ACCESS_SETTING_PATH));
    }

    /// Every refusal but the consent one is a fault rather than a choice, so
    /// only the consent refusal points at a switch.
    #[test]
    fn only_the_consent_refusal_names_a_settings_row() {
        assert_eq!(
            ExternalError::consent_required(ExternalScope::Read).settings_path,
            Some(EXTERNAL_ACCESS_SETTING_PATH)
        );
        assert_eq!(
            ExternalError::from(QueryError::Unavailable).settings_path,
            None
        );
        assert_eq!(
            ExternalError::from(QueryError::Unavailable).error,
            ExternalErrorCode::Unavailable,
            "a locked keychain is not a missing consent"
        );
    }

    #[test]
    fn a_fresh_install_grants_neither_scope() {
        let settings = crate::settings::get_default_settings();
        let fresh = ExternalConsent::from_settings(&settings);

        assert!(!fresh.allows(ExternalScope::Read));
        assert!(!fresh.allows(ExternalScope::Mutate));
        assert!(consent(true, false).allows(ExternalScope::Read));
        assert!(consent(false, true).allows(ExternalScope::Mutate));
    }

    /// Which grant each verb asks for, in one place: everything reads except
    /// the one flag that writes.
    #[test]
    fn only_loop_resolve_asks_for_the_mutation_scope() {
        for argv in [
            vec!["--query", "dana"],
            vec!["--meetings"],
            vec!["--meeting", MEETING],
            vec!["--transcript", MEETING],
            vec!["--loops"],
            vec!["--people", "Dana"],
            vec!["--events"],
            vec!["--upcoming"],
        ] {
            assert_eq!(request(&argv).scope(), ExternalScope::Read, "{argv:?}");
        }
        assert_eq!(
            request(&["--loop-resolve", LOOP]).scope(),
            ExternalScope::Mutate
        );
    }
}
