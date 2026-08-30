import type { Page } from "@playwright/test";

import { APP_SETTINGS, MODES_SNAPSHOT } from "./tauri-fixtures";

/**
 * Playwright runs the frontend in a plain Chromium, so every `invoke` and every
 * Tauri plugin internal has to be provided here. Without the OS and event plugin
 * internals the app throws while mounting, and without a non-null model list the
 * model selector crashes on `find`.
 */
/** Any JSON-serializable command response; the payload crosses the Playwright
 * serialization boundary, so JSON is the exact value contract. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type TauriMockOptions = {
  /** Command responses layered over the defaults. An override always wins. */
  responses?: Record<string, JsonValue>;
};

/** Installs the mocked Tauri runtime before any page script runs. */
export async function installTauriMock(
  page: Page,
  options: TauriMockOptions = {},
): Promise<void> {
  await page.addInitScript(installMockedRuntime, {
    settings: APP_SETTINGS,
    modes: MODES_SNAPSHOT,
    responses: options.responses ?? {},
  });
}

type MockPayload = {
  settings: Record<string, JsonValue>;
  modes: Record<string, JsonValue>;
  responses: Record<string, JsonValue>;
};

/**
 * Runs in the browser, so it may not close over anything outside its argument:
 * Playwright serializes the function and passes `payload` as JSON.
 *
 * Exported so a screenshot harness can serialize the same runtime into a plain
 * `<script>` ahead of the app bundle. One owner for what the browser sees.
 */
export function installMockedRuntime(payload: MockPayload): void {
  const state = { phase: "preflight", started: 0 };
  localStorage.setItem("meeting-started", "0");

  const sources = [
    {
      track_id: null,
      source_kind: "microphone",
      required: true,
      availability: "available",
      health: "healthy",
      format: null,
      last_durable_offset_ns: 0,
      gap_count: 0,
    },
    {
      track_id: null,
      source_kind: "system_audio",
      required: true,
      availability: "available",
      health: "healthy",
      format: null,
      last_durable_offset_ns: 0,
      gap_count: 0,
    },
  ];

  const capturing = () => state.phase !== "preflight";

  const session = () => ({
    session_id: "meeting-1",
    phase: state.phase,
    revision: capturing() ? 2 : 1,
    title: "Local notes",
    started_at_utc_ms: capturing() ? 1_756_136_400_000 : null,
    elapsed_offset_ns: capturing() ? 8_000_000_000 : null,
    sources,
    open_capture_window_started_at_ns: null,
    capture_completeness: "not_started",
    storage: "available",
    processing_status: { kind: "pending" },
    retention_deadline_utc_ms: null,
    allowed_actions: capturing()
      ? ["pause", "stop", "discard"]
      : ["refresh_preflight", "cancel_preflight", "start"],
  });

  const receipt = () => ({
    schema_version: 1,
    operation_id: "operation-1",
    session_id: "meeting-1",
    actor: "user",
    command: "start",
    expected_revision: 1,
    from_phase: "preflight",
    to_phase: state.phase,
    requested_at_utc_ms: 1_756_136_400_000,
    committed_at_utc_ms: 1_756_136_400_000,
    result: "committed",
    reason_codes: [],
    new_revision: capturing() ? 2 : 1,
    effect_ids: [],
  });

  /* Detection never fires a prompt in E2E: the ad-hoc path needs a real
   * CoreAudio transition and the calendar path a granted TCC scope, so the
   * quiet-but-healthy status below is the only one a browser can reach. */
  const detectionStatus = () => ({
    eventSchemaVersion: 1,
    settings: {
      enabled: true,
      calendarEnabled: false,
      anyMicActivity: false,
      autoStartOnOpenPane: false,
      silenceStopMinutes: 15,
      meetingApps: [
        "us.zoom.xos",
        "com.microsoft.teams2",
        "com.microsoft.teams",
        "com.tinyspeck.slackmacgap",
        "com.webex.meetingmanager",
      ],
    },
    calendarAccess: "not_determined",
    notificationAccess: "not_determined",
    inputDeviceActive: false,
    sonaHoldsInputDevice: false,
    suppressReason: "no_qualifying_signal",
    countdown: null,
    runningMeetingApps: [],
    availableStopTriggers: [
      "sleep_boundary",
      "event_end",
      "trigger_app_exited",
      "input_device_idle",
    ],
    inputDeviceReportingSuspect: false,
  });

  const userNotes = () => ({
    session_id: "meeting-1",
    body: "",
    template: "general",
    revision: 0,
    updated_at_utc_ms: 1_756_136_400_000,
  });

  /* The zero-valued snapshot the analytics strip renders its "nothing to
   * measure" state from. */
  const analyticsSnapshot = () => ({
    session_id: "meeting-1",
    input_revision: 1,
    computed_at_utc_ms: 1_756_136_400_000,
    analytics: {
      talk: {
        segment_count: 0,
        turn_count: 0,
        interaction_count: 0,
        total_speaking_ns: 0,
        speakers: [],
        longest_monologue_ns: 0,
        longest_monologue_speaker_id: null,
        median_switch_gap_ms: null,
      },
      trackers: [],
    },
    action_items: [],
    notes: userNotes(),
  });

  /* The panel's quiet-but-healthy snapshot: relay paired and reachable, panel
   * attached, nothing in flight. `relayStatusToPhase` (src/agent-panel/
   * AgentPanelApp.tsx:24-41) maps ready + no turn + no proposal to the `idle`
   * phase, which is the only state a browser can reach — the mock answers
   * `plugin:event|listen` with an id and then emits nothing, so no turn or
   * proposal lifecycle ever advances on its own. A spec that needs one supplies
   * it through `responses`. Shapes are AgentPanelStatusV1 in src/bindings.ts. */
  const agentPanel = () => ({
    invalidation_id: 1,
    relay_status: "ready",
    panel_open: true,
    conversation: [],
    turn: null,
    proposal: null,
    geometry: {
      x: 0,
      y: 0,
      outer_width: 380,
      outer_height: 640,
      attachment: "right",
      compact: false,
    },
  });

  const defaults = new Map<string, JsonValue>([
    ["get_app_settings", payload.settings],
    ["get_settings", payload.settings],
    ["get_default_settings", payload.settings],
    ["get_modes", payload.modes],
    ["plugin:os|platform", "macos"],
    /* getVersion() feeds the What's New gate and the About page. Unanswered it
       resolves to null, and the gate then logs "Failed to load release notes"
       from a version parse that never sees a string. Kept in step with
       src-tauri/tauri.conf.json's version. */
    ["plugin:app|version", "1.0.0"],
    ["plugin:event|listen", 1],
    ["plugin:event|unlisten", null],
    ["get_available_microphones", []],
    ["get_available_output_devices", []],
    ["get_available_models", []],
    ["get_current_model", ""],
    ["get_transcription_model_status", null],
    ["is_model_loading", false],
    ["is_recording", false],
    [
      "get_history_entries",
      {
        entries: [],
        has_more: false,
        total: 0,
        total_count: 0,
      },
    ],
    [
      "search_history_entries",
      {
        entries: [],
        has_more: false,
        total: 0,
        total_count: 0,
      },
    ],
    ["get_history_stats", null],
    ["get_history_trend", null],
    ["get_history_run_receipts", []],
    /* Capture's instrument strip: the engine's real binding and the device's
     * real channel count. `backend` is the field `ModelLoadStatus` gained this
     * wave — the compute backend the loaded engine bound to, not the requested
     * accelerator. */
    [
      "get_model_load_status",
      { is_loaded: false, current_model: null, backend: null },
    ],
    ["get_microphone_channels", 1],
    ["list_vocabulary_entries", []],
    ["list_audio_import_jobs", []],
    ["list_snippets", []],
    [
      "check_for_updates",
      {
        current_version: "1.0.0",
        latest_version: null,
        update_available: false,
        url: null,
        notes_excerpt: null,
        published_at_utc_ms: null,
        status: "up_to_date",
        error: null,
      },
    ],
    [
      "cloud_sync_service_status",
      {
        configured: false,
        endpoint: null,
        reason: "no endpoint configured",
      },
    ],
    ["cloud_sync_overview_get", null],
    ["get_agent_bridge_status", null],
    ["get_secure_input_status", null],
    ["get_context_diagnostics", null],
    ["meeting_suggestions_list", []],
    ["meeting_list", { entries: [], has_more: false }],
    ["meeting_recovery_list", []],
    ["meeting_retention_get", { policy: { kind: "forever" }, revision: 1 }],
    ["meeting_trend", null],

    // Meeting detection (MeetingDetect). No `detection-prompt` event is ever
    // emitted here, so the countdown card and the toast path stay unmounted.
    ["detection_status_get", detectionStatus()],
    ["detection_settings_set", detectionStatus()],
    ["detection_calendar_access_request", "not_determined"],
    ["detection_notification_access_request", "not_determined"],
    ["detection_prompt_respond", null],
    ["detection_running_meeting_apps", []],

    // Meeting analytics + notes (MeetingAnalyticsNotes).
    ["get_meeting_analytics", analyticsSnapshot()],
    ["list_keyword_trackers", []],
    ["save_keyword_trackers", []],
    ["set_action_item_done", []],
    ["get_meeting_user_notes", userNotes()],
    ["save_meeting_user_notes", userNotes()],
    [
      "reenhance_meeting_with_notes",
      { receipt: receipt(), snapshot: session() },
    ],
    [
      "meeting_catch_up",
      {
        state: "no_transcript_yet",
        bullets: [],
        through_offset_ns: null,
        segment_count: 0,
      },
    ],

    // History power pack (HistoryPowerPackV2).
    ["reprocess_history_entry", null],
    ["get_text_replacements", []],
    ["save_text_replacements", []],
    ["reset_text_replacements", []],
    ["update_text_replacements_enabled", null],
    ["get_persona_samples", []],
    ["save_persona_samples", []],
    [
      "hud_pill_state",
      { enabled: false, position: "bottom", mode_name: null, mode_id: null },
    ],
    ["set_hud_pill_enabled", null],
    ["set_hud_pill_position", null],
    ["hud_toggle_recording", null],
    ["hud_open_mode_menu", null],

    // Command mode (CommandModeContext / SettingsOnboardingRestyle).
    ["change_command_mode_enabled_setting", null],

    /* Appearance material (TokensTypeFoundation). Rust resolves intent against
     * whether native vibrancy applied and writes `data-material` itself, so the
     * command answers with nothing. */
    ["change_appearance_material_setting", null],

    /* Agent panel (/agent-panel). Every commands.agentPanel* call site branches
     * on the `{ status: "ok" | "error" }` result shape, so an unmocked command
     * falling through to `return null` is a crash on `result.data.relay_status`,
     * not a graceful miss. All seven status commands answer with the same idle
     * snapshot except for the field each one actually moves. */
    ["agent_panel_status", agentPanel()],
    ["agent_panel_open", agentPanel()],
    ["agent_panel_close", { ...agentPanel(), panel_open: false }],
    /* Post-enqueue, which is what the backend returns before any turn event:
     * the panel goes to the `running` phase and stays there, because nothing
     * here emits agent-panel://turn-changed. */
    [
      "agent_panel_send_turn",
      {
        ...agentPanel(),
        turn: {
          turn_id: "agent-panel-turn-1",
          state: "queued",
          event_cursor: 0,
        },
      },
    ],
    [
      "agent_panel_cancel_turn",
      {
        ...agentPanel(),
        turn: {
          turn_id: "agent-panel-turn-1",
          state: "canceled",
          event_cursor: 1,
        },
      },
    ],
    /* Both resolve the pending proposal, so the snapshot comes back with none.
     * A spec that needs the applied/undone preview — to reach the undo
     * affordance — supplies its own AgentPanelProposalPreviewV1. */
    ["agent_panel_apply_change", agentPanel()],
    ["agent_panel_undo_change", agentPanel()],
    [
      "agent_panel_public_identity",
      { key_id: "agent-panel-key-1", public_key: "0".repeat(64) },
    ],
  ]);

  const invoke = async (command: string): Promise<JsonValue> => {
    if (Object.prototype.hasOwnProperty.call(payload.responses, command)) {
      return payload.responses[command];
    }
    if (
      command === "meeting_preflight_create" ||
      command === "meeting_preflight_refresh"
    ) {
      return { receipt: receipt(), snapshot: session() };
    }
    if (command === "meeting_get") {
      return {
        session: session(),
        tracks: [],
        gaps: [],
        speakers: [],
        transcript: [],
        notes: [],
        artifacts: [],
        questions: [],
        diarization: {
          status: "not_requested",
          model_id: "local",
          model_version: "1",
          generation_id: null,
          assigned_segment_count: 0,
        },
        can_export: false,
        remote_cancellation_pending: false,
      };
    }
    if (command === "meeting_start") {
      state.started += 1;
      state.phase = "capturing_recording";
      localStorage.setItem("meeting-started", String(state.started));
      return { receipt: receipt(), snapshot: session() };
    }
    const preset = defaults.get(command);
    if (preset !== undefined) {
      return preset;
    }
    if (command.includes("permission")) return true;
    return null;
  };

  type TauriGlobals = {
    isTauri: boolean;
    __TAURI_INTERNALS__: {
      invoke: typeof invoke;
      transformCallback: () => number;
      convertFileSrc: (path: string) => string;
    };
    __TAURI_OS_PLUGIN_INTERNALS__: Record<string, string>;
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => void };
  };
  // SAFETY: the mock plants the Tauri globals the runtime reads at startup;
  // Window does not declare them, so the intersection assertion is the way in.
  const target = window as Window & Partial<TauriGlobals>;
  target.isTauri = true;
  target.__TAURI_INTERNALS__ = {
    invoke,
    /* One constant id for every callback, so no handler is ever kept: the mock
       answers `plugin:event|listen` with an id and then emits nothing, which
       means a `listen()` handler in the app never runs under Playwright. Any
       spec that needs a backend event has to register handlers here first,
       rather than pass because the event silently never arrived. */
    transformCallback: () => 1,
    convertFileSrc: (path: string) => path,
  };
  target.__TAURI_OS_PLUGIN_INTERNALS__ = {
    platform: "macos",
    arch: "aarch64",
    family: "unix",
    os_type: "macos",
    ostype: "macos",
    version: "15.6.0",
    exe_extension: "",
    eol: "\n",
  };
  target.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
}
