//! Strict per-agent wire decoding.
//!
//! Each agent ships its own key convention, so every event is decoded through a
//! structure that accepts exactly the fields that agent is known to send. The
//! canonical event is the only shape the rest of the hook consumes.

use serde::Deserialize;
use serde_json::{Map, Value};

pub(crate) use super::wire::{Agent, CanonicalEvent, CanonicalEventKind, CanonicalTool};
use super::SCHEMA_VERSION;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DecodeError {
    Invalid,
    Unsupported,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClaudeInput {
    session_id: String,
    transcript_path: String,
    stop_hook_active: bool,
    hook_event_name: String,
    last_assistant_message: String,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    tool_input: Option<Map<String, Value>>,
    #[serde(default)]
    permission_suggestions: Option<Vec<Value>>,
    #[serde(default)]
    permission_mode: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    notification_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CodexInput {
    session_id: String,
    #[serde(default)]
    transcript_path: Option<String>,
    #[serde(default)]
    stop_hook_active: Option<bool>,
    hook_event_name: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    turn_id: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    tool_use_id: Option<String>,
    #[serde(default)]
    tool_input: Option<Map<String, Value>>,
    #[serde(default)]
    last_assistant_message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrokInput {
    session_id: String,
    #[serde(default)]
    workspace_root: Option<String>,
    hook_event_name: String,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    prompt_id: Option<String>,
    #[serde(default)]
    transcript_path: Option<String>,
    #[serde(default)]
    stop_hook_active: Option<bool>,
    #[serde(default)]
    last_assistant_message: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    tool_input: Option<Map<String, Value>>,
    #[serde(default)]
    permission_mode: Option<String>,
    #[serde(default)]
    bypass_permissions: Option<bool>,
}
const OMP_EXTENSION_SCHEMA_VERSION: u8 = 1;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OmpInput {
    schema_version: u8,
    event: String,
    session_id: String,
    workspace_root: String,
    stop_hook_active: bool,
    sequence: u64,
    #[serde(default)]
    turn_id: Option<u64>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    tool_call_id: Option<String>,
    #[serde(default)]
    tool_input: Option<Map<String, Value>>,
    #[serde(default)]
    approval_mode: Option<String>,
}

pub(crate) fn decode_event(agent: Agent, raw: &[u8]) -> Result<CanonicalEvent, DecodeError> {
    match agent {
        Agent::Claude => decode_claude(raw),
        Agent::Codex => decode_codex(raw),
        Agent::Grok => decode_grok(raw),
        Agent::Omp => decode_omp(raw),
    }
}

fn decode_claude(raw: &[u8]) -> Result<CanonicalEvent, DecodeError> {
    let input: ClaudeInput = serde_json::from_slice(raw).map_err(|_| DecodeError::Invalid)?;
    let kind = match input.hook_event_name.as_str() {
        "UserPromptSubmit" => CanonicalEventKind::UserPromptSubmit,
        "PermissionRequest" => CanonicalEventKind::PermissionRequest,
        "PreToolUse" => CanonicalEventKind::PreToolUse,
        "Stop" => CanonicalEventKind::Stop,
        "Notification" => CanonicalEventKind::Notification,
        _ => return Err(DecodeError::Unsupported),
    };
    validate_claude(&input, kind)?;
    Ok(canonical_from_claude(&input, kind))
}

fn validate_claude(input: &ClaudeInput, kind: CanonicalEventKind) -> Result<(), DecodeError> {
    if input.session_id.is_empty() {
        return Err(DecodeError::Invalid);
    }

    let no_tools_or_permissions = input.tool_name.is_none()
        && input.tool_input.is_none()
        && input.permission_suggestions.is_none()
        && input.permission_mode.is_none();
    let no_notification = input.message.is_none() && input.notification_type.is_none();

    match kind {
        CanonicalEventKind::UserPromptSubmit | CanonicalEventKind::Stop => {
            if no_tools_or_permissions && no_notification {
                Ok(())
            } else {
                Err(DecodeError::Invalid)
            }
        }
        CanonicalEventKind::PermissionRequest => {
            if input.tool_name.is_some()
                && input.tool_input.is_some()
                && input.permission_suggestions.is_some()
                && input.permission_mode.is_some()
                && no_notification
            {
                Ok(())
            } else {
                Err(DecodeError::Invalid)
            }
        }
        CanonicalEventKind::PreToolUse => {
            if input.tool_name.is_some()
                && input.tool_input.is_some()
                && input.permission_suggestions.is_none()
                && input.permission_mode.is_none()
                && no_notification
            {
                Ok(())
            } else {
                Err(DecodeError::Invalid)
            }
        }
        CanonicalEventKind::Notification => {
            if no_tools_or_permissions
                && input.message.is_some()
                && input.notification_type.is_some()
            {
                Ok(())
            } else {
                Err(DecodeError::Invalid)
            }
        }
        CanonicalEventKind::SessionStart | CanonicalEventKind::PostToolUse => {
            Err(DecodeError::Unsupported)
        }
    }
}

fn canonical_from_claude(input: &ClaudeInput, event: CanonicalEventKind) -> CanonicalEvent {
    CanonicalEvent {
        schema_version: SCHEMA_VERSION,
        agent: Agent::Claude,
        event,
        session_id: input.session_id.clone(),
        transcript_path: Some(input.transcript_path.clone()),
        stop_hook_active: input.stop_hook_active,
        workspace_root: None,
        request_id: None,
        model: None,
        source: None,
        prompt: None,
        message: match event {
            CanonicalEventKind::Stop => Some(input.last_assistant_message.clone()),
            CanonicalEventKind::Notification => input.message.clone(),
            _ => None,
        },
        reason: None,
        tool: input.tool_name.as_ref().map(|name| CanonicalTool {
            name: name.clone(),
            use_id: None,
            input: input.tool_input.clone().map(Value::Object),
        }),
        permission_mode: input.permission_mode.clone(),
        bypass_permissions: false,
    }
}

fn decode_codex(raw: &[u8]) -> Result<CanonicalEvent, DecodeError> {
    let input: CodexInput = serde_json::from_slice(raw).map_err(|_| DecodeError::Invalid)?;
    let kind = match input.hook_event_name.as_str() {
        "UserPromptSubmit" => CanonicalEventKind::UserPromptSubmit,
        "PermissionRequest" => CanonicalEventKind::PermissionRequest,
        "PreToolUse" => CanonicalEventKind::PreToolUse,
        "PostToolUse" => CanonicalEventKind::PostToolUse,
        "Stop" => CanonicalEventKind::Stop,
        "Notification" => CanonicalEventKind::Notification,
        _ => return Err(DecodeError::Unsupported),
    };
    validate_tool_event(
        input.session_id.as_str(),
        kind,
        input.tool_name.as_deref(),
        input.tool_input.as_ref(),
        input.tool_use_id.as_deref(),
    )?;
    Ok(canonical_from_codex(&input, kind))
}

fn canonical_from_codex(input: &CodexInput, event: CanonicalEventKind) -> CanonicalEvent {
    CanonicalEvent {
        schema_version: SCHEMA_VERSION,
        agent: Agent::Codex,
        event,
        session_id: input.session_id.clone(),
        transcript_path: input.transcript_path.clone(),
        stop_hook_active: input.stop_hook_active.unwrap_or(false),
        workspace_root: None,
        request_id: input.turn_id.clone(),
        model: input.model.clone(),
        source: input.source.clone(),
        prompt: input.prompt.clone(),
        message: input.last_assistant_message.clone(),
        reason: None,
        tool: input.tool_name.as_ref().map(|name| CanonicalTool {
            name: name.clone(),
            use_id: input.tool_use_id.clone(),
            input: input.tool_input.clone().map(Value::Object),
        }),
        permission_mode: None,
        bypass_permissions: false,
    }
}

fn decode_grok(raw: &[u8]) -> Result<CanonicalEvent, DecodeError> {
    let input: GrokInput = serde_json::from_slice(raw).map_err(|_| DecodeError::Invalid)?;
    let kind = match input.hook_event_name.as_str() {
        "userpromptsubmit" => CanonicalEventKind::UserPromptSubmit,
        "permissionrequest" => CanonicalEventKind::PermissionRequest,
        "pretooluse" => CanonicalEventKind::PreToolUse,
        "stop" => CanonicalEventKind::Stop,
        "notification" => CanonicalEventKind::Notification,
        _ => return Err(DecodeError::Unsupported),
    };
    if input.bypass_permissions.unwrap_or(false) {
        return Err(DecodeError::Unsupported);
    }
    validate_tool_event(
        input.session_id.as_str(),
        kind,
        input.tool_name.as_deref(),
        input.tool_input.as_ref(),
        None,
    )?;
    Ok(canonical_from_grok(&input, kind))
}

fn canonical_from_grok(input: &GrokInput, event: CanonicalEventKind) -> CanonicalEvent {
    CanonicalEvent {
        schema_version: SCHEMA_VERSION,
        agent: Agent::Grok,
        event,
        session_id: input.session_id.clone(),
        transcript_path: input.transcript_path.clone(),
        stop_hook_active: input.stop_hook_active.unwrap_or(false),
        workspace_root: input.workspace_root.clone(),
        request_id: input.prompt_id.clone(),
        model: None,
        source: input.source.clone(),
        prompt: None,
        message: input.last_assistant_message.clone(),
        reason: input.reason.clone(),
        tool: input.tool_name.as_ref().map(|name| CanonicalTool {
            name: name.clone(),
            use_id: None,
            input: input.tool_input.clone().map(Value::Object),
        }),
        permission_mode: input.permission_mode.clone(),
        bypass_permissions: false,
    }
}

fn decode_omp(raw: &[u8]) -> Result<CanonicalEvent, DecodeError> {
    let input: OmpInput = serde_json::from_slice(raw).map_err(|_| DecodeError::Invalid)?;
    if input.schema_version != OMP_EXTENSION_SCHEMA_VERSION {
        return Err(DecodeError::Invalid);
    }
    let event = match input.event.as_str() {
        "session_start" => CanonicalEventKind::SessionStart,
        "user_prompt_submit" => CanonicalEventKind::UserPromptSubmit,
        "permission_request" => CanonicalEventKind::PermissionRequest,
        "stop" => CanonicalEventKind::Stop,
        _ => return Err(DecodeError::Unsupported),
    };
    validate_omp(&input, event)?;
    Ok(canonical_from_omp(&input, event))
}

fn validate_omp(input: &OmpInput, event: CanonicalEventKind) -> Result<(), DecodeError> {
    if input.session_id.is_empty() || input.workspace_root.is_empty() || input.sequence == 0 {
        return Err(DecodeError::Invalid);
    }
    let no_tool = input.tool_name.is_none()
        && input.tool_call_id.is_none()
        && input.tool_input.is_none()
        && input.approval_mode.is_none();
    match event {
        CanonicalEventKind::SessionStart | CanonicalEventKind::UserPromptSubmit => {
            (!input.stop_hook_active && input.turn_id.is_none() && no_tool)
                .then_some(())
                .ok_or(DecodeError::Invalid)
        }
        CanonicalEventKind::PermissionRequest => (!input.stop_hook_active
            && input.turn_id.is_none()
            && input
                .tool_name
                .as_deref()
                .is_some_and(|name| !name.is_empty())
            && input
                .tool_call_id
                .as_deref()
                .is_some_and(|call_id| !call_id.is_empty())
            && input.tool_input.is_some()
            && input
                .approval_mode
                .as_deref()
                .is_some_and(|mode| !mode.is_empty()))
        .then_some(())
        .ok_or(DecodeError::Invalid),
        CanonicalEventKind::Stop => (input.turn_id.is_some() && no_tool)
            .then_some(())
            .ok_or(DecodeError::Invalid),
        _ => Err(DecodeError::Unsupported),
    }
}

fn canonical_from_omp(input: &OmpInput, event: CanonicalEventKind) -> CanonicalEvent {
    CanonicalEvent {
        schema_version: SCHEMA_VERSION,
        agent: Agent::Omp,
        event,
        session_id: input.session_id.clone(),
        transcript_path: None,
        stop_hook_active: input.stop_hook_active,
        workspace_root: Some(input.workspace_root.clone()),
        request_id: match event {
            CanonicalEventKind::PermissionRequest => input.tool_call_id.clone(),
            CanonicalEventKind::Stop => input.turn_id.map(|turn_id| turn_id.to_string()),
            _ => None,
        },
        model: None,
        source: None,
        prompt: None,
        message: None,
        reason: None,
        tool: input.tool_name.as_ref().map(|name| CanonicalTool {
            name: name.clone(),
            use_id: input.tool_call_id.clone(),
            input: input.tool_input.clone().map(Value::Object),
        }),
        permission_mode: input.approval_mode.clone(),
        bypass_permissions: false,
    }
}

fn validate_tool_event(
    session_id: &str,
    kind: CanonicalEventKind,
    tool_name: Option<&str>,
    tool_input: Option<&Map<String, Value>>,
    tool_use_id: Option<&str>,
) -> Result<(), DecodeError> {
    if session_id.is_empty() {
        return Err(DecodeError::Invalid);
    }

    if tool_name.is_none() && (tool_input.is_some() || tool_use_id.is_some()) {
        return Err(DecodeError::Invalid);
    }

    match kind {
        CanonicalEventKind::PermissionRequest
        | CanonicalEventKind::PreToolUse
        | CanonicalEventKind::PostToolUse => {
            if tool_name.is_some() && tool_input.is_some() {
                Ok(())
            } else {
                Err(DecodeError::Invalid)
            }
        }
        _ => Ok(()),
    }
}
