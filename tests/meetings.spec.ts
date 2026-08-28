import { expect, test } from "@playwright/test";

test.describe("Meetings", () => {
  test("a detected meeting reaches explicit consent before capture start", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      type MeetingTestState = {
        started: number;
        phase: string;
      };
      type TauriTestValue = null | boolean | number | string | object;
      type TauriInternals = {
        invoke: (command: string) => Promise<TauriTestValue>;
        transformCallback: () => number;
        convertFileSrc: (path: string) => string;
      };
      const state: MeetingTestState = { started: 0, phase: "preflight" };
      localStorage.setItem("meeting-started", "0");
      const sourceSnapshot = [
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
      const internals: TauriInternals = {
        async invoke(command) {
          const session = {
            session_id: "meeting-1",
            phase: state.phase,
            revision: state.phase === "preflight" ? 1 : 2,
            title: "Local notes",
            started_at_utc_ms:
              state.phase === "preflight" ? null : 1_756_136_400_000,
            elapsed_offset_ns:
              state.phase === "preflight" ? null : 8_000_000_000,
            sources: sourceSnapshot,
            open_capture_window_started_at_ns: null,
            capture_completeness: "not_started",
            storage: "available",
            processing_status: { kind: "pending" },
            retention_deadline_utc_ms: null,
            allowed_actions:
              state.phase === "preflight"
                ? ["refresh_preflight", "cancel_preflight", "start"]
                : ["pause", "stop", "discard"],
          };
          const review = {
            session,
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
          const receipt = {
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
            new_revision: session.revision,
            effect_ids: [],
          };

          if (command === "get_app_settings") {
            return {
              onboarding_completed: true,
              theme: "light",
              post_process_providers: [],
            };
          }
          if (command === "plugin:os|platform") return "macos";
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return null;
          if (command === "meeting_suggestions_list") {
            return [
              {
                offer_id: "offer-1",
                provider: "zoom",
                app_bundle_id: "us.zoom.xos",
                evidence_flags: {
                  appOnly: true,
                  axTitle: false,
                  axHost: false,
                  axUnavailable: false,
                },
                observed_at_ns: 1,
                expires_at_ns: 2,
              },
            ];
          }
          if (command === "meeting_list") {
            return { entries: [], has_more: false };
          }
          if (command === "meeting_recovery_list") return [];
          if (command === "meeting_retention_get") {
            return { policy: { kind: "forever" }, revision: 1 };
          }
          if (command === "meeting_preflight_create") {
            return { receipt, snapshot: session };
          }
          if (command === "meeting_get") return review;
          if (command === "meeting_start") {
            state.started += 1;
            state.phase = "capturing_recording";
            localStorage.setItem("meeting-started", String(state.started));
            return { receipt, snapshot: session };
          }
          if (command === "get_available_microphones") return [];
          if (command === "get_available_output_devices") return [];
          if (command.includes("permission")) return true;
          return null;
        },
        transformCallback: () => 1,
        convertFileSrc: (path) => path,
      };
      Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: internals });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Meetings" }).click();
    await page
      .getByRole("button", { name: "Start local notes", exact: true })
      .click();

    await expect(
      page.getByRole("heading", { name: "Start local notes" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Check recording setup" }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Number(localStorage.getItem("meeting-started"))))
      .toBe(0);

    await page.getByRole("button", { name: "Check recording setup" }).click();
    const start = page.getByRole("button", {
      name: "Start local notes",
      exact: true,
    });
    await expect(start).toBeDisabled();
    await page
      .getByLabel("I have permission to capture this meeting.")
      .check();
    await expect(start).toBeEnabled();
    await start.click();

    await expect(page.getByText("Active capture")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Number(localStorage.getItem("meeting-started"))))
      .toBe(1);
  });
});
