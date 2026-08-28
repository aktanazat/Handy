//! Claiming and encoding the desktop app's answer to one hook invocation.
//!
//! A response moves from `responses/` to `claimed/` before it is decoded. The
//! claim survives every failure until stdout has been flushed and a durable ack
//! records the emitted response.

use serde::Serialize;
use std::io;
use std::path::{Path, PathBuf};

use super::runtime::{Clock, Request, SessionPaths};
pub(super) use super::wire::HookAnswer as ClaudeAnswer;
use super::wire::{read_json_bounded, HookResponse as AppResponse};
use super::{
    CanonicalEvent, CanonicalEventKind, Diagnostic, ASK_USER_QUESTION_TOOL, EXIT_PLAN_MODE_TOOL,
    MAX_RESPONSE_BYTES, PROTOCOL_GENERATION, SCHEMA_VERSION,
};

const PRE_TOOL_USE_HOOK_EVENT: &str = "PreToolUse";
const BLOCK_DECISION: &str = "block";
const APPROVE_DECISION: &str = "Approve";
const REJECT_DECISION: &str = "Reject";
const DONT_ASK_DECISION: &str = "dontAsk";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Block,
    Approve,
    Reject,
    DontAsk,
    PassThrough,
}

impl Outcome {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "block" => Some(Self::Block),
            "approve" => Some(Self::Approve),
            "reject" => Some(Self::Reject),
            "dont_ask" => Some(Self::DontAsk),
            "pass_through" => Some(Self::PassThrough),
            _ => None,
        }
    }

    fn permission_decision(self) -> Option<&'static str> {
        match self {
            Self::Approve => Some(APPROVE_DECISION),
            Self::Reject => Some(REJECT_DECISION),
            Self::DontAsk => Some(DONT_ASK_DECISION),
            Self::Block | Self::PassThrough => None,
        }
    }
}

#[derive(Serialize)]
struct StopDecision<'a> {
    decision: &'a str,
    reason: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HookSpecificOutput<'a> {
    hook_event_name: &'a str,
    permission_decision: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    answers: Option<&'a Vec<ClaudeAnswer>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreToolUseDecision<'a> {
    hook_specific_output: HookSpecificOutput<'a>,
}

/// Claims the app's response for this invocation, if one is already waiting.
pub(crate) fn try_claim(
    paths: &SessionPaths,
    invocation_id: &str,
) -> Result<Option<PathBuf>, Diagnostic> {
    match paths.claim_response(invocation_id) {
        Ok(claimed) => Ok(Some(claimed)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(Diagnostic::ResponseNotClaimed),
    }
}

/// Decodes one already-claimed response without deleting it.
///
/// The caller owns the output-and-ack transaction and removes the claim only
/// after the acknowledgement has persisted.
pub(crate) fn encode_claimed(
    path: &Path,
    clock: &Clock,
    request: &Request,
    event: &CanonicalEvent,
) -> Result<Option<Vec<u8>>, Diagnostic> {
    let response: AppResponse =
        read_json_bounded(path, MAX_RESPONSE_BYTES).map_err(|_| Diagnostic::ResponseMalformed)?;

    if response.schema_version != SCHEMA_VERSION
        || response.protocol_generation != PROTOCOL_GENERATION
        || response.app_instance_id != request.app_instance_id
        || response.binding != request.binding
        || response.invocation_id != request.invocation_id
    {
        return Err(Diagnostic::ResponseNotBound);
    }

    let now_ms = clock.now_ms();
    if response.issued_at_ms < request.issued_at_ms
        || response.issued_at_ms > response.expires_at_ms
        || response.expires_at_ms > request.expires_at_ms
        || !response.matches(request, now_ms)
    {
        return Err(Diagnostic::ResponseStale);
    }

    let outcome = Outcome::parse(&response.outcome).ok_or(Diagnostic::ResponseOutcomeUnknown)?;
    if outcome == Outcome::PassThrough {
        return Ok(None);
    }

    encode_outcome(&response, outcome, event).map(Some)
}

fn encode_outcome(
    response: &AppResponse,
    outcome: Outcome,
    event: &CanonicalEvent,
) -> Result<Vec<u8>, Diagnostic> {
    match (event.event, outcome) {
        (CanonicalEventKind::Stop, Outcome::Block) => {
            let reason = response
                .reason
                .as_deref()
                .filter(|reason| !reason.is_empty())
                .ok_or(Diagnostic::ResponseOutcomeUnsupported)?;
            if response.answers.is_some() {
                return Err(Diagnostic::ResponseOutcomeUnsupported);
            }
            serialize(&StopDecision {
                decision: BLOCK_DECISION,
                reason,
            })
        }
        (CanonicalEventKind::PreToolUse, _) => {
            let decision = outcome
                .permission_decision()
                .ok_or(Diagnostic::ResponseOutcomeUnsupported)?;
            if response.reason.is_some() {
                return Err(Diagnostic::ResponseOutcomeUnsupported);
            }
            let answers = permitted_answers(response, outcome, event)?;
            serialize(&PreToolUseDecision {
                hook_specific_output: HookSpecificOutput {
                    hook_event_name: PRE_TOOL_USE_HOOK_EVENT,
                    permission_decision: decision,
                    answers,
                },
            })
        }
        _ => Err(Diagnostic::ResponseOutcomeUnsupported),
    }
}

/// Answers ride along only where an exact golden fixture covers them: an
/// approved `AskUserQuestion`. Every other pairing is refused rather than
/// emitting a byte sequence no fixture proves.
fn permitted_answers<'a>(
    response: &'a AppResponse,
    outcome: Outcome,
    event: &CanonicalEvent,
) -> Result<Option<&'a Vec<ClaudeAnswer>>, Diagnostic> {
    let tool = event
        .tool_name()
        .ok_or(Diagnostic::ResponseOutcomeUnsupported)?;

    match (tool, outcome, &response.answers) {
        (ASK_USER_QUESTION_TOOL, Outcome::Approve, Some(answers)) if !answers.is_empty() => {
            Ok(Some(answers))
        }
        (ASK_USER_QUESTION_TOOL, Outcome::Reject | Outcome::DontAsk, None)
        | (EXIT_PLAN_MODE_TOOL, Outcome::Approve | Outcome::Reject | Outcome::DontAsk, None) => {
            Ok(None)
        }
        _ => Err(Diagnostic::ResponseOutcomeUnsupported),
    }
}

fn serialize<T: Serialize>(payload: &T) -> Result<Vec<u8>, Diagnostic> {
    let mut encoded =
        serde_json::to_vec(payload).map_err(|_| Diagnostic::ResponseOutcomeUnsupported)?;
    encoded.push(b'\n');
    Ok(encoded)
}
