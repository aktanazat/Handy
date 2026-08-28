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
 */
function installMockedRuntime(payload: MockPayload): void {
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

  const defaults = new Map<string, JsonValue>([
    ["get_app_settings", payload.settings],
    ["get_settings", payload.settings],
    ["get_default_settings", payload.settings],
    ["get_modes", payload.modes],
    ["plugin:os|platform", "macos"],
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
