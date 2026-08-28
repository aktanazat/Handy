use serde_json::json;
use std::error::Error;
use std::fs;
use std::io::{self, Cursor, Write};
use std::path::{Path, PathBuf};
use tempfile::TempDir;

use super::codec::{decode_event, Agent, CanonicalEventKind, DecodeError};
use super::response::ClaudeAnswer;
use super::runtime::{protocol_session_generation, Clock, RuntimePaths, SessionPaths};
use super::wire::{
    atomic_write, atomic_write_json, project_hash, read_json_bounded, AppHeartbeat, AppLease,
    HookRequest, HookResponse, PolicyProjection, SessionBinding, WriteMode,
};
use super::{
    run_with_runtime, Diagnostic, HookRuntime, PollBudget, MAX_INPUT_BYTES, MAX_RESPONSE_BYTES,
    PROTOCOL_GENERATION, SCHEMA_VERSION,
};

const STOP_INPUT: &[u8] = include_bytes!("fixtures/claude-stop-input.json");
const QUESTION_INPUT: &[u8] = include_bytes!("fixtures/claude-askuserquestion-input.json");
const PLAN_INPUT: &[u8] = include_bytes!("fixtures/claude-exitplanmode-input.json");
const STOP_BLOCK_OUTPUT: &[u8] = include_bytes!("fixtures/claude-stop-block-output.json");
const APPROVE_ANSWERS_OUTPUT: &[u8] =
    include_bytes!("fixtures/claude-pretooluse-approve-answers-output.json");
const APPROVE_OUTPUT: &[u8] = include_bytes!("fixtures/claude-pretooluse-approve-output.json");
const REJECT_OUTPUT: &[u8] = include_bytes!("fixtures/claude-pretooluse-reject-output.json");
const DONT_ASK_OUTPUT: &[u8] = include_bytes!("fixtures/claude-pretooluse-dontask-output.json");

const NOW_MS: u64 = 1_700_000_000_000;
const APP_INSTANCE_ID: &str = "0123456789abcdef0123456789abcdef";
const POLICY_GENERATION: u64 = 7;
const RUNTIME_DIR_NAME: &str = "runtime";
const GOLDEN_REASON: &str = "Golden fixture voice reply.";

struct Fixture {
    temp: TempDir,
    runtime_root: PathBuf,
    project: PathBuf,
    hook: HookRuntime,
}

fn fixture(now_ms: u64, interactive_supported: bool) -> Fixture {
    // PANIC: the test cannot exercise private runtime behavior without a temporary directory.
    let temp = TempDir::new().expect("temporary directory");
    let runtime_root = temp.path().join(RUNTIME_DIR_NAME);
    let project = temp.path().join("project");
    // PANIC: the fresh temporary fixture owns this project directory.
    fs::create_dir(&project).expect("project directory");
    // PANIC: the temporary directory is a valid private runtime parent.
    let paths = RuntimePaths::from_root(runtime_root.clone(), interactive_supported)
        .expect("private runtime paths");
    let hook = HookRuntime::new(
        paths,
        project.clone(),
        Clock::fixed(now_ms),
        PollBudget::immediate(),
    );
    Fixture {
        temp,
        runtime_root,
        project,
        hook,
    }
}

fn install_lifecycle(
    hook: &HookRuntime,
    enabled_agents: Vec<Agent>,
    allowed_projects: &[&Path],
    master_enabled: bool,
    lease_expires_at_ms: u64,
    heartbeat_expires_at_ms: u64,
    policy_expires_at_ms: u64,
) {
    let paths = hook.paths();
    // PANIC: the deterministic app lifecycle must persist before the consumer runs.
    atomic_write_json(
        &paths.app_lock_path(),
        &AppLease {
            schema_version: SCHEMA_VERSION,
            protocol_generation: PROTOCOL_GENERATION,
            app_instance_id: APP_INSTANCE_ID.to_owned(),
            pid: 1,
            policy_generation: POLICY_GENERATION,
            issued_at_ms: NOW_MS.saturating_sub(1),
            expires_at_ms: lease_expires_at_ms,
        },
        WriteMode::CreateNew,
    )
    .expect("app lease");
    // PANIC: the deterministic app lifecycle must persist before the consumer runs.
    atomic_write_json(
        &paths.heartbeat_path(),
        &AppHeartbeat {
            schema_version: SCHEMA_VERSION,
            protocol_generation: PROTOCOL_GENERATION,
            app_instance_id: APP_INSTANCE_ID.to_owned(),
            policy_generation: POLICY_GENERATION,
            issued_at_ms: NOW_MS.saturating_sub(1),
            expires_at_ms: heartbeat_expires_at_ms,
        },
        WriteMode::CreateNew,
    )
    .expect("app heartbeat");
    // PANIC: the deterministic app lifecycle must persist before the consumer runs.
    atomic_write_json(
        &paths.policy_path(),
        &PolicyProjection {
            schema_version: SCHEMA_VERSION,
            protocol_generation: PROTOCOL_GENERATION,
            app_instance_id: APP_INSTANCE_ID.to_owned(),
            generation: POLICY_GENERATION,
            master_enabled,
            enabled_agents,
            allowed_project_hashes: allowed_projects
                .iter()
                .map(|project| project_hash(project).expect("project hash"))
                .collect(),
            issued_at_ms: NOW_MS.saturating_sub(1),
            expires_at_ms: policy_expires_at_ms,
        },
        WriteMode::CreateNew,
    )
    .expect("policy projection");
}

fn install_ready(hook: &HookRuntime, project: &Path, agent: Agent) {
    install_lifecycle(
        hook,
        vec![agent],
        &[project],
        true,
        NOW_MS + 10_000,
        NOW_MS + 10_000,
        NOW_MS + 10_000,
    );
}

fn binding_for(agent: Agent, session_id: &str, project: &Path) -> SessionBinding {
    // PANIC: every helper call supplies an existing test project and nonempty session.
    SessionBinding::new(
        agent,
        session_id,
        project,
        protocol_session_generation(),
        POLICY_GENERATION,
    )
    .expect("session binding")
}

fn request_for(agent: Agent, input: &[u8], project: &Path) -> HookRequest {
    // PANIC: every caller passes a checked-in valid provider fixture.
    let event = decode_event(agent, input).expect("fixture event");
    let binding = binding_for(agent, &event.session_id, project);
    // PANIC: the decoded fixture and lifecycle binding form a valid request.
    HookRequest::new(APP_INSTANCE_ID.to_owned(), binding, &event, input, NOW_MS)
        .expect("hook request")
}

fn session_for(hook: &HookRuntime, request: &HookRequest) -> SessionPaths {
    // PANIC: the fixture's valid binding must yield private session paths.
    hook.paths()
        .session(&request.binding)
        .expect("session paths")
}

fn response_for(
    request: &HookRequest,
    outcome: &str,
    reason: Option<&str>,
    answers: Option<Vec<ClaudeAnswer>>,
) -> HookResponse {
    HookResponse {
        schema_version: SCHEMA_VERSION,
        protocol_generation: PROTOCOL_GENERATION,
        app_instance_id: request.app_instance_id.clone(),
        binding: request.binding.clone(),
        invocation_id: request.invocation_id.clone(),
        outcome: outcome.to_owned(),
        issued_at_ms: NOW_MS,
        expires_at_ms: NOW_MS + 5_000,
        reason: reason.map(str::to_owned),
        answers,
    }
}

fn place_response_for_request(
    hook: &HookRuntime,
    request: &HookRequest,
    response: &HookResponse,
) -> SessionPaths {
    let session = session_for(hook, request);
    // PANIC: response staging is test setup and must succeed before exercising the consumer.
    atomic_write_json(
        &session
            .response_path(&response.invocation_id)
            .expect("response path"),
        response,
        WriteMode::CreateNew,
    )
    .expect("prepared response");
    session
}

fn run(agent: Agent, input: &[u8], hook: &HookRuntime) -> (Vec<u8>, String) {
    let mut input = Cursor::new(input);
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    // PANIC: in-memory test buffers cannot fail; an error means the hook contract regressed.
    run_with_runtime(agent, &mut input, &mut stdout, &mut stderr, hook).expect("hook run");
    (
        stdout,
        String::from_utf8(stderr).expect("diagnostic is UTF-8"),
    )
}

fn diagnostic_line(diagnostic: Diagnostic) -> String {
    format!("{}\n", diagnostic.message())
}

fn sessions_are_empty(fixture: &Fixture) -> bool {
    fs::read_dir(fixture.runtime_root.join("sessions"))
        .expect("session root")
        .next()
        .is_none()
}

fn golden_answers() -> Vec<ClaudeAnswer> {
    vec![ClaudeAnswer {
        header: "Pick one".to_owned(),
        question: "Which option?".to_owned(),
        selected: vec!["First".to_owned()],
    }]
}
fn omp_session_start_input(project: &Path) -> serde_json::Result<Vec<u8>> {
    serde_json::to_vec(&json!({
        "schema_version": 1,
        "event": "session_start",
        "session_id": "omp-session",
        "workspace_root": project.to_string_lossy(),
        "stop_hook_active": false,
        "sequence": 1
    }))
}

fn omp_permission_input(project: &Path) -> serde_json::Result<Vec<u8>> {
    serde_json::to_vec(&json!({
        "schema_version": 1,
        "event": "permission_request",
        "session_id": "omp-session",
        "workspace_root": project.to_string_lossy(),
        "stop_hook_active": false,
        "sequence": 2,
        "tool_name": "bash",
        "tool_call_id": "omp-tool-1",
        "tool_input": { "command": "pwd" },
        "approval_mode": "always-ask"
    }))
}

fn omp_stop_input(
    project: &Path,
    sequence: u64,
    stop_hook_active: bool,
) -> serde_json::Result<Vec<u8>> {
    serde_json::to_vec(&json!({
        "schema_version": 1,
        "event": "stop",
        "session_id": "omp-session",
        "workspace_root": project.to_string_lossy(),
        "stop_hook_active": stop_hook_active,
        "sequence": sequence,
        "turn_id": 7
    }))
}

#[test]
fn rejects_unusable_input_without_output_or_session() {
    let fixture = fixture(NOW_MS, true);
    let cases = [
        b"[]".as_slice(),
        b"{\"hook_event_name\":\"Stop\"}{\"hook_event_name\":\"Stop\"}".as_slice(),
    ];

    for input in cases {
        let (stdout, stderr) = run(Agent::Claude, input, &fixture.hook);
        assert!(stdout.is_empty());
        assert_eq!(stderr, diagnostic_line(Diagnostic::InvalidEvent));
    }

    let oversized = vec![b' '; MAX_INPUT_BYTES + 1];
    let (stdout, stderr) = run(Agent::Claude, &oversized, &fixture.hook);
    assert!(stdout.is_empty());
    assert_eq!(stderr, diagnostic_line(Diagnostic::InputTooLarge));
    assert!(sessions_are_empty(&fixture));
}

#[test]
fn decodes_each_agent_with_its_own_key_convention() {
    let claude = br#"{"session_id":"claude-session","transcript_path":"/tmp/claude.jsonl","stop_hook_active":false,"hook_event_name":"PreToolUse","last_assistant_message":"","tool_name":"Edit","tool_input":{"file_path":"a.rs"}}"#;
    let claude_event = decode_event(Agent::Claude, claude).expect("Claude event");
    assert_eq!(claude_event.agent, Agent::Claude);
    assert_eq!(claude_event.event, CanonicalEventKind::PreToolUse);
    assert_eq!(claude_event.tool_name(), Some("Edit"));

    let codex = br#"{"sessionId":"codex-session","hookEventName":"Stop","turnId":"turn-1","prompt":"continue","lastAssistantMessage":"done"}"#;
    let codex_event = decode_event(Agent::Codex, codex).expect("Codex event");
    assert_eq!(codex_event.agent, Agent::Codex);
    assert_eq!(codex_event.event, CanonicalEventKind::Stop);
    assert_eq!(codex_event.request_id.as_deref(), Some("turn-1"));

    let grok = br#"{"sessionId":"grok-session","hookEventName":"permissionrequest","toolName":"run_terminal_command","toolInput":{"command":"pwd"},"permissionMode":"default"}"#;
    let grok_event = decode_event(Agent::Grok, grok).expect("Grok event");
    assert_eq!(grok_event.agent, Agent::Grok);
    assert_eq!(grok_event.event, CanonicalEventKind::PermissionRequest);

    assert!(matches!(
        decode_event(Agent::Claude, codex),
        Err(DecodeError::Invalid)
    ));
    assert!(matches!(
        decode_event(Agent::Codex, claude),
        Err(DecodeError::Invalid)
    ));
}

#[test]
fn omp_decoder_accepts_only_canonical_session_permission_and_stop_events() {
    let session = br#"{"schema_version":1,"event":"session_start","session_id":"omp-session","workspace_root":"/tmp/omp","stop_hook_active":false,"sequence":1}"#;
    let session_event = decode_event(Agent::Omp, session).expect("OMP session event");
    assert_eq!(session_event.event, CanonicalEventKind::SessionStart);
    assert_eq!(session_event.agent, Agent::Omp);

    let permission = br#"{"schema_version":1,"event":"permission_request","session_id":"omp-session","workspace_root":"/tmp/omp","stop_hook_active":false,"sequence":2,"tool_name":"bash","tool_call_id":"omp-tool-1","tool_input":{"command":"pwd"},"approval_mode":"always-ask"}"#;
    let permission_event = decode_event(Agent::Omp, permission).expect("OMP permission event");
    assert_eq!(
        permission_event.event,
        CanonicalEventKind::PermissionRequest
    );
    assert_eq!(permission_event.tool_name(), Some("bash"));

    let stop = br#"{"schema_version":1,"event":"stop","session_id":"omp-session","workspace_root":"/tmp/omp","stop_hook_active":false,"sequence":3,"turn_id":7}"#;
    let stop_event = decode_event(Agent::Omp, stop).expect("OMP stop event");
    assert_eq!(stop_event.event, CanonicalEventKind::Stop);
    assert_eq!(stop_event.request_id.as_deref(), Some("7"));

    let malformed = br#"{"schema_version":1,"event":"permission_request","session_id":"omp-session","workspace_root":"/tmp/omp","stop_hook_active":false,"sequence":4,"tool_name":"bash","tool_call_id":"omp-tool-2","approval_mode":"always-ask"}"#;
    assert!(matches!(
        decode_event(Agent::Omp, malformed),
        Err(DecodeError::Invalid)
    ));
}

#[test]
fn omp_session_and_permission_events_persist_without_response() -> Result<(), Box<dyn Error>> {
    let fixture = fixture(NOW_MS, true);
    install_ready(&fixture.hook, &fixture.project, Agent::Omp);

    let session_input = omp_session_start_input(&fixture.project)?;
    let session_request = request_for(Agent::Omp, &session_input, &fixture.project);
    let (stdout, stderr) = run(Agent::Omp, &session_input, &fixture.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());
    let persisted_session: HookRequest = read_json_bounded(
        &session_for(&fixture.hook, &session_request)
            .request_path(&session_request.invocation_id)
            .expect("OMP session path"),
        MAX_RESPONSE_BYTES,
    )
    .expect("persisted OMP session");
    assert_eq!(
        persisted_session.event.event,
        CanonicalEventKind::SessionStart
    );

    let permission_input = omp_permission_input(&fixture.project)?;
    let permission_request = request_for(Agent::Omp, &permission_input, &fixture.project);
    let (stdout, stderr) = run(Agent::Omp, &permission_input, &fixture.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());
    let permission_session = session_for(&fixture.hook, &permission_request);
    let persisted_permission: HookRequest = read_json_bounded(
        &permission_session
            .request_path(&permission_request.invocation_id)
            .expect("OMP permission path"),
        MAX_RESPONSE_BYTES,
    )
    .expect("persisted OMP permission");
    assert_eq!(
        persisted_permission.event.event,
        CanonicalEventKind::PermissionRequest
    );
    assert!(!permission_session
        .response_path(&permission_request.invocation_id)
        .expect("OMP permission response path")
        .exists());
    Ok(())
}

#[test]
fn omp_stop_returns_a_confirmed_response_once_and_skips_active_stops() -> Result<(), Box<dyn Error>>
{
    let fixture = fixture(NOW_MS, true);
    install_ready(&fixture.hook, &fixture.project, Agent::Omp);

    let unconfirmed = omp_stop_input(&fixture.project, 1, false)?;
    let (stdout, stderr) = run(Agent::Omp, &unconfirmed, &fixture.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());

    let confirmed = omp_stop_input(&fixture.project, 2, false)?;
    let request = request_for(Agent::Omp, &confirmed, &fixture.project);
    let response = response_for(&request, "block", Some(GOLDEN_REASON), None);
    let session = place_response_for_request(&fixture.hook, &request, &response);
    let (stdout, stderr) = run(Agent::Omp, &confirmed, &fixture.hook);
    assert_eq!(stdout, STOP_BLOCK_OUTPUT);
    assert!(stderr.is_empty());
    assert!(session
        .ack_path(&request.invocation_id)
        .expect("OMP acknowledgement path")
        .exists());

    let replay = omp_stop_input(&fixture.project, 3, false)?;
    let (stdout, stderr) = run(Agent::Omp, &replay, &fixture.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());

    let active = omp_stop_input(&fixture.project, 4, true)?;
    let active_request = request_for(Agent::Omp, &active, &fixture.project);
    let (stdout, stderr) = run(Agent::Omp, &active, &fixture.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());
    assert!(!session_for(&fixture.hook, &active_request)
        .request_path(&active_request.invocation_id)
        .expect("active OMP stop path")
        .exists());
    Ok(())
}

#[test]
fn omp_wrong_project_passes_through_without_persistence() -> Result<(), Box<dyn Error>> {
    let fixture = fixture(NOW_MS, true);
    let other_project = fixture.temp.path().join("other-project");
    fs::create_dir(&other_project)?;
    install_ready(&fixture.hook, &other_project, Agent::Omp);
    let input = omp_stop_input(&fixture.project, 1, false)?;
    let (stdout, stderr) = run(Agent::Omp, &input, &fixture.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());
    assert!(sessions_are_empty(&fixture));
    Ok(())
}

#[test]
fn codex_and_grok_decode_then_pass_through_without_persistence() {
    let fixture = fixture(NOW_MS, true);
    let codex =
        br#"{"sessionId":"codex-session","hookEventName":"Stop","lastAssistantMessage":"done"}"#;
    let grok =
        br#"{"sessionId":"grok-session","hookEventName":"stop","lastAssistantMessage":"done"}"#;

    for (agent, input) in [
        (Agent::Codex, codex.as_slice()),
        (Agent::Grok, grok.as_slice()),
    ] {
        let (stdout, stderr) = run(agent, input, &fixture.hook);
        assert!(stdout.is_empty());
        assert!(stderr.is_empty());
    }
    assert!(sessions_are_empty(&fixture));
}

#[test]
fn ready_lifecycle_persists_a_bound_request_in_its_session_paths() {
    let fixture = fixture(NOW_MS, true);
    install_ready(&fixture.hook, &fixture.project, Agent::Claude);
    let request = request_for(Agent::Claude, STOP_INPUT, &fixture.project);
    let session = session_for(&fixture.hook, &request);

    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &fixture.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());

    let request_path = session
        .request_path(&request.invocation_id)
        .expect("request path");
    let persisted: HookRequest =
        read_json_bounded(&request_path, MAX_RESPONSE_BYTES).expect("persisted request");
    assert_eq!(persisted.app_instance_id, APP_INSTANCE_ID);
    assert_eq!(persisted.protocol_generation, PROTOCOL_GENERATION);
    assert_eq!(persisted.binding, request.binding);
    assert_eq!(persisted.invocation_id, request.invocation_id);
    assert_eq!(persisted.issued_at_ms, NOW_MS);
    assert_eq!(persisted.expires_at_ms, NOW_MS + 30_000);
    assert!(session
        .response_path(&request.invocation_id)
        .expect("response path")
        .ends_with(format!("{}.json", request.invocation_id)));
    assert!(session
        .claimed_path(&request.invocation_id)
        .expect("claim path")
        .ends_with(format!("{}.json", request.invocation_id)));
    assert!(session
        .ack_path(&request.invocation_id)
        .expect("ack path")
        .ends_with(format!("{}.json", request.invocation_id)));

    let rendered = request_path.to_string_lossy();
    assert!(rendered.contains(&request.binding.session_handle));
    assert!(!rendered.contains(&request.event.session_id));
}

#[test]
fn claude_stop_matches_golden_and_persists_exact_ack_bytes() {
    let fixture = fixture(NOW_MS, true);
    install_ready(&fixture.hook, &fixture.project, Agent::Claude);
    let request = request_for(Agent::Claude, STOP_INPUT, &fixture.project);
    let response = response_for(&request, "block", Some(GOLDEN_REASON), None);
    let session = place_response_for_request(&fixture.hook, &request, &response);

    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &fixture.hook);
    assert_eq!(stdout, STOP_BLOCK_OUTPUT);
    assert!(stderr.is_empty());
    assert!(!session
        .response_path(&request.invocation_id)
        .expect("response path")
        .exists());
    assert!(!session
        .claimed_path(&request.invocation_id)
        .expect("claim path")
        .exists());

    let ack_path = session.ack_path(&request.invocation_id).expect("ack path");
    let ack = fs::read(&ack_path).expect("persisted acknowledgement");
    let expected = format!(
        "{{\"schema_version\":{SCHEMA_VERSION},\"protocol_generation\":{PROTOCOL_GENERATION},\"app_instance_id\":\"{APP_INSTANCE_ID}\",\"binding\":{{\"agent\":\"claude\",\"session_handle\":\"{}\",\"project_hash\":\"{}\",\"session_generation\":{},\"policy_generation\":{POLICY_GENERATION}}},\"invocation_id\":\"{}\",\"outcome\":\"response_emitted\",\"emitted_at_ms\":{NOW_MS}}}",
        request.binding.session_handle,
        request.binding.project_hash,
        protocol_session_generation(),
        request.invocation_id,
    );
    assert_eq!(ack, expected.as_bytes());
}

#[test]
fn explicit_fixture_covered_claude_pre_tool_responses_match_goldens() {
    let cases = [
        (
            QUESTION_INPUT,
            "approve",
            Some(golden_answers()),
            APPROVE_ANSWERS_OUTPUT,
        ),
        (QUESTION_INPUT, "reject", None, REJECT_OUTPUT),
        (QUESTION_INPUT, "dont_ask", None, DONT_ASK_OUTPUT),
        (PLAN_INPUT, "approve", None, APPROVE_OUTPUT),
        (PLAN_INPUT, "reject", None, REJECT_OUTPUT),
        (PLAN_INPUT, "dont_ask", None, DONT_ASK_OUTPUT),
    ];

    for (input, outcome, answers, expected) in cases {
        let fixture = fixture(NOW_MS, true);
        install_ready(&fixture.hook, &fixture.project, Agent::Claude);
        let request = request_for(Agent::Claude, input, &fixture.project);
        let response = response_for(&request, outcome, None, answers);
        let session = place_response_for_request(&fixture.hook, &request, &response);

        let (stdout, stderr) = run(Agent::Claude, input, &fixture.hook);
        assert_eq!(
            stdout, expected,
            "outcome {outcome} produced unexpected bytes"
        );
        assert!(stderr.is_empty());
        assert!(session
            .ack_path(&request.invocation_id)
            .expect("ack path")
            .exists());
    }
}

#[test]
fn interactive_support_and_an_active_app_are_required_before_persistence() {
    let unsupported = fixture(NOW_MS, false);
    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &unsupported.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());
    assert!(sessions_are_empty(&unsupported));

    let app_off = fixture(NOW_MS, true);
    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &app_off.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());
    assert!(sessions_are_empty(&app_off));
}

#[test]
fn stale_lease_heartbeat_and_policy_pass_through_before_persistence() {
    for (lease_expiry, heartbeat_expiry, policy_expiry) in [
        (NOW_MS - 1, NOW_MS + 10_000, NOW_MS + 10_000),
        (NOW_MS + 10_000, NOW_MS - 1, NOW_MS + 10_000),
        (NOW_MS + 10_000, NOW_MS + 10_000, NOW_MS - 1),
    ] {
        let fixture = fixture(NOW_MS, true);
        install_lifecycle(
            &fixture.hook,
            vec![Agent::Claude],
            &[&fixture.project],
            true,
            lease_expiry,
            heartbeat_expiry,
            policy_expiry,
        );

        let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &fixture.hook);
        assert!(stdout.is_empty());
        assert!(stderr.is_empty());
        assert!(sessions_are_empty(&fixture));
    }
}

#[test]
fn disabled_policy_and_agent_or_project_mismatch_pass_through() {
    let disabled = fixture(NOW_MS, true);
    install_lifecycle(
        &disabled.hook,
        vec![Agent::Claude],
        &[&disabled.project],
        false,
        NOW_MS + 10_000,
        NOW_MS + 10_000,
        NOW_MS + 10_000,
    );
    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &disabled.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());
    assert!(sessions_are_empty(&disabled));

    let wrong_agent = fixture(NOW_MS, true);
    install_lifecycle(
        &wrong_agent.hook,
        vec![Agent::Codex],
        &[&wrong_agent.project],
        true,
        NOW_MS + 10_000,
        NOW_MS + 10_000,
        NOW_MS + 10_000,
    );
    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &wrong_agent.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());
    assert!(sessions_are_empty(&wrong_agent));

    let wrong_project = fixture(NOW_MS, true);
    let other_project = wrong_project.temp.path().join("other-project");
    fs::create_dir(&other_project).expect("other project");
    install_lifecycle(
        &wrong_project.hook,
        vec![Agent::Claude],
        &[&other_project],
        true,
        NOW_MS + 10_000,
        NOW_MS + 10_000,
        NOW_MS + 10_000,
    );
    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &wrong_project.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());
    assert!(sessions_are_empty(&wrong_project));
}

#[test]
fn missing_workspace_and_malformed_policy_pass_through_before_persistence() {
    let missing_fixture = fixture(NOW_MS, true);
    let missing_workspace = missing_fixture.temp.path().join("missing-project");
    let paths = RuntimePaths::from_root(missing_fixture.temp.path().join("missing-runtime"), true)
        .expect("missing-project runtime");
    let hook = HookRuntime::new(
        paths,
        missing_workspace,
        Clock::fixed(NOW_MS),
        PollBudget::immediate(),
    );
    install_ready(&hook, &missing_fixture.project, Agent::Claude);
    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());

    let malformed = fixture(NOW_MS, true);
    install_ready(&malformed.hook, &malformed.project, Agent::Claude);
    atomic_write(
        &malformed.hook.paths().policy_path(),
        b"{}",
        WriteMode::Replace,
    )
    .expect("malformed policy bytes");
    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &malformed.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());
    assert!(sessions_are_empty(&malformed));
}

#[test]
fn strict_response_files_require_exact_binding_and_fresh_expiry() {
    let unbound = fixture(NOW_MS, true);
    install_ready(&unbound.hook, &unbound.project, Agent::Claude);
    let request = request_for(Agent::Claude, STOP_INPUT, &unbound.project);
    let mut response = response_for(&request, "block", Some(GOLDEN_REASON), None);
    response.app_instance_id = "fedcba9876543210fedcba9876543210".to_owned();
    let session = place_response_for_request(&unbound.hook, &request, &response);
    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &unbound.hook);
    assert!(stdout.is_empty());
    assert_eq!(stderr, diagnostic_line(Diagnostic::ResponseNotBound));
    assert!(session
        .claimed_path(&request.invocation_id)
        .expect("claim path")
        .exists());
    assert!(!session
        .ack_path(&request.invocation_id)
        .expect("ack path")
        .exists());

    let stale = fixture(NOW_MS, true);
    install_ready(&stale.hook, &stale.project, Agent::Claude);
    let request = request_for(Agent::Claude, STOP_INPUT, &stale.project);
    let mut response = response_for(&request, "block", Some(GOLDEN_REASON), None);
    response.issued_at_ms = NOW_MS - 2;
    response.expires_at_ms = NOW_MS - 1;
    let session = place_response_for_request(&stale.hook, &request, &response);
    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &stale.hook);
    assert!(stdout.is_empty());
    assert_eq!(stderr, diagnostic_line(Diagnostic::ResponseStale));
    assert!(session
        .claimed_path(&request.invocation_id)
        .expect("claim path")
        .exists());
}

#[test]
fn malformed_and_oversized_claimed_responses_pass_through_and_remain_claimed() {
    let malformed = fixture(NOW_MS, true);
    install_ready(&malformed.hook, &malformed.project, Agent::Claude);
    let request = request_for(Agent::Claude, STOP_INPUT, &malformed.project);
    let session = session_for(&malformed.hook, &request);
    let response = response_for(&request, "block", Some(GOLDEN_REASON), None);
    let mut value = serde_json::to_value(response).expect("response value");
    value["unexpected"] = json!(true);
    atomic_write(
        &session
            .response_path(&request.invocation_id)
            .expect("response path"),
        &serde_json::to_vec(&value).expect("response bytes"),
        WriteMode::CreateNew,
    )
    .expect("malformed response");
    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &malformed.hook);
    assert!(stdout.is_empty());
    assert_eq!(stderr, diagnostic_line(Diagnostic::ResponseMalformed));
    assert!(session
        .claimed_path(&request.invocation_id)
        .expect("claim path")
        .exists());
    assert!(!session
        .ack_path(&request.invocation_id)
        .expect("ack path")
        .exists());

    let oversized = fixture(NOW_MS, true);
    install_ready(&oversized.hook, &oversized.project, Agent::Claude);
    let request = request_for(Agent::Claude, STOP_INPUT, &oversized.project);
    let session = session_for(&oversized.hook, &request);
    atomic_write(
        &session
            .response_path(&request.invocation_id)
            .expect("response path"),
        &vec![b'x'; MAX_RESPONSE_BYTES + 1],
        WriteMode::CreateNew,
    )
    .expect("oversized response");
    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &oversized.hook);
    assert!(stdout.is_empty());
    assert_eq!(stderr, diagnostic_line(Diagnostic::ResponseMalformed));
    assert!(session
        .claimed_path(&request.invocation_id)
        .expect("claim path")
        .exists());
}

#[test]
fn duplicate_claim_is_not_replaced_or_acknowledged() {
    let fixture = fixture(NOW_MS, true);
    install_ready(&fixture.hook, &fixture.project, Agent::Claude);
    let request = request_for(Agent::Claude, STOP_INPUT, &fixture.project);
    let session = session_for(&fixture.hook, &request);
    let claim_path = session
        .claimed_path(&request.invocation_id)
        .expect("claim path");
    atomic_write(&claim_path, b"already claimed", WriteMode::CreateNew).expect("existing claim");
    let response = response_for(&request, "block", Some(GOLDEN_REASON), None);
    atomic_write_json(
        &session
            .response_path(&request.invocation_id)
            .expect("response path"),
        &response,
        WriteMode::CreateNew,
    )
    .expect("prepared response");

    let (stdout, stderr) = run(Agent::Claude, STOP_INPUT, &fixture.hook);
    assert!(stdout.is_empty());
    assert_eq!(stderr, diagnostic_line(Diagnostic::ResponseNotClaimed));
    assert_eq!(
        fs::read(&claim_path).expect("existing claim"),
        b"already claimed"
    );
    assert!(session
        .response_path(&request.invocation_id)
        .expect("response path")
        .exists());
    assert!(!session
        .ack_path(&request.invocation_id)
        .expect("ack path")
        .exists());
}

struct WriteFail;

impl Write for WriteFail {
    fn write(&mut self, _: &[u8]) -> io::Result<usize> {
        Err(io::Error::new(io::ErrorKind::BrokenPipe, "writer failure"))
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct FlushFail(Vec<u8>);

impl Write for FlushFail {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Err(io::Error::new(io::ErrorKind::BrokenPipe, "flush failure"))
    }
}

struct AckDirectoryRemovingWriter {
    bytes: Vec<u8>,
    ack_directory: PathBuf,
}

impl Write for AckDirectoryRemovingWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        fs::remove_dir(&self.ack_directory)
    }
}

#[test]
fn write_failure_keeps_claim_without_ack_or_another_response_attempt() {
    let fixture = fixture(NOW_MS, true);
    install_ready(&fixture.hook, &fixture.project, Agent::Claude);
    let request = request_for(Agent::Claude, STOP_INPUT, &fixture.project);
    let response = response_for(&request, "block", Some(GOLDEN_REASON), None);
    let session = place_response_for_request(&fixture.hook, &request, &response);
    let mut input = Cursor::new(STOP_INPUT);
    let mut stdout = WriteFail;
    let mut stderr = Vec::new();

    assert!(run_with_runtime(
        Agent::Claude,
        &mut input,
        &mut stdout,
        &mut stderr,
        &fixture.hook,
    )
    .is_err());
    assert!(stderr.is_empty());
    assert!(session
        .claimed_path(&request.invocation_id)
        .expect("claim path")
        .exists());
    assert!(!session
        .ack_path(&request.invocation_id)
        .expect("ack path")
        .exists());

    let (retry, retry_stderr) = run(Agent::Claude, STOP_INPUT, &fixture.hook);
    assert!(retry.is_empty());
    assert_eq!(
        retry_stderr,
        diagnostic_line(Diagnostic::RequestNotPersisted)
    );
    assert!(session
        .claimed_path(&request.invocation_id)
        .expect("claim path")
        .exists());
}

#[test]
fn flush_failure_keeps_claim_without_ack() {
    let fixture = fixture(NOW_MS, true);
    install_ready(&fixture.hook, &fixture.project, Agent::Claude);
    let request = request_for(Agent::Claude, STOP_INPUT, &fixture.project);
    let response = response_for(&request, "block", Some(GOLDEN_REASON), None);
    let session = place_response_for_request(&fixture.hook, &request, &response);
    let mut input = Cursor::new(STOP_INPUT);
    let mut stdout = FlushFail(Vec::new());
    let mut stderr = Vec::new();

    assert!(run_with_runtime(
        Agent::Claude,
        &mut input,
        &mut stdout,
        &mut stderr,
        &fixture.hook,
    )
    .is_err());
    assert_eq!(stdout.0, STOP_BLOCK_OUTPUT);
    assert!(stderr.is_empty());
    assert!(session
        .claimed_path(&request.invocation_id)
        .expect("claim path")
        .exists());
    assert!(!session
        .ack_path(&request.invocation_id)
        .expect("ack path")
        .exists());
}

#[test]
fn ack_failure_keeps_claim_without_creating_an_ack() {
    let fixture = fixture(NOW_MS, true);
    install_ready(&fixture.hook, &fixture.project, Agent::Claude);
    let request = request_for(Agent::Claude, STOP_INPUT, &fixture.project);
    let response = response_for(&request, "block", Some(GOLDEN_REASON), None);
    let session = place_response_for_request(&fixture.hook, &request, &response);
    let ack_path = session.ack_path(&request.invocation_id).expect("ack path");
    let ack_directory = ack_path.parent().expect("ack directory").to_path_buf();
    let mut input = Cursor::new(STOP_INPUT);
    let mut stdout = AckDirectoryRemovingWriter {
        bytes: Vec::new(),
        ack_directory,
    };
    let mut stderr = Vec::new();

    assert!(run_with_runtime(
        Agent::Claude,
        &mut input,
        &mut stdout,
        &mut stderr,
        &fixture.hook,
    )
    .is_err());
    assert_eq!(stdout.bytes, STOP_BLOCK_OUTPUT);
    assert!(stderr.is_empty());
    assert!(!ack_path.exists());
    assert!(session
        .claimed_path(&request.invocation_id)
        .expect("claim path")
        .exists());
}

#[test]
fn pass_through_response_never_auto_approves_or_acknowledges() {
    let fixture = fixture(NOW_MS, true);
    install_ready(&fixture.hook, &fixture.project, Agent::Claude);
    let request = request_for(Agent::Claude, QUESTION_INPUT, &fixture.project);
    let response = response_for(&request, "pass_through", None, None);
    let session = place_response_for_request(&fixture.hook, &request, &response);

    let (stdout, stderr) = run(Agent::Claude, QUESTION_INPUT, &fixture.hook);
    assert!(stdout.is_empty());
    assert!(stderr.is_empty());
    assert!(session
        .claimed_path(&request.invocation_id)
        .expect("claim path")
        .exists());
    assert!(!session
        .ack_path(&request.invocation_id)
        .expect("ack path")
        .exists());
}
