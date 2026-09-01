import { expect, test } from "@playwright/test";

import { meetingStartedAtMs } from "./support/tauri-fixtures";
import { installTauriMock } from "./support/tauri-mock";

const CALENDAR_PROMPT = {
  eventSchemaVersion: 2,
  promptId: "prompt-1",
  prompt: {
    kind: "CalendarEvent",
    eventKey: "weekly-sync#1756136400000",
    eventTitle: "Weekly sync",
  },
  notificationTitle: "Weekly sync starting",
  delivery: "panel",
  showIntroduction: true,
};

const ACTIVE_PANEL_STATE = {
  snapshot: {
    session_id: "meeting-1",
    phase: "capturing_recording",
    revision: 2,
    title: "Existing recording",
    started_at_utc_ms: meetingStartedAtMs(),
  },
  standing_series_key: null,
};

test.describe("Consent panel", () => {
  test("acknowledges, records with the panel command, and stops from the pill", async ({
    page,
  }) => {
    await installTauriMock(page, {
      events: { "detection-prompt": [CALENDAR_PROMPT] },
    });

    await page.goto("/consent");

    await expect(
      page.getByRole("heading", { name: "Record Weekly sync?" }),
    ).toBeVisible();
    await expect(
      page.getByText("Sona records on this Mac and keeps you in control.", {
        exact: true,
      }),
    ).toBeVisible();
    const alwaysRecord = page.getByRole("checkbox", {
      name: "Always record this meeting",
    });
    await expect(alwaysRecord).toBeVisible();
    await alwaysRecord.click();
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("detection-panel-ack")),
      )
      .toBe("prompt-1");
    await expect
      .poll(() =>
        page.evaluate(() => Number(localStorage.getItem("meeting-started"))),
      )
      .toBe(0);

    await page.getByRole("button", { name: "Record", exact: true }).click();

    await expect(page.getByText("Recording", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => Number(localStorage.getItem("meeting-started"))),
      )
      .toBe(1);
    const startRequest = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("meeting-consent-panel-start-request") ?? "null",
      ),
    );
    expect(startRequest).toMatchObject({
      prompt_id: "prompt-1",
      always_record_series: true,
      consent: {
        microphone_acknowledged: true,
        system_audio_acknowledged: true,
      },
    });
    expect(startRequest.operation_id).toEqual(expect.any(String));

    await page.getByRole("button", { name: "Stop", exact: true }).click();

    await expect
      .poll(() =>
        page.evaluate(() => Number(localStorage.getItem("meeting-stopped"))),
      )
      .toBe(1);
    await expect(page.getByText("Recording", { exact: true })).toBeHidden();
  });

  test("Ignore retracts the panel without starting a meeting", async ({
    page,
  }) => {
    await installTauriMock(page, {
      events: {
        "detection-prompt": [{ ...CALENDAR_PROMPT, promptId: "prompt-ignore" }],
      },
    });
    await page.goto("/consent");
    await expect(
      page.getByRole("heading", { name: "Record Weekly sync?" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Ignore", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Record Weekly sync?" }),
    ).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => Number(localStorage.getItem("meeting-started"))),
      )
      .toBe(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(
            localStorage.getItem("detection-prompt-response") ?? "null",
          ),
        ),
      )
      .toEqual({ promptId: "prompt-ignore", accepted: false });
  });

  test("retraction clears the matching panel prompt", async ({ page }) => {
    await installTauriMock(page, {
      events: {
        "detection-prompt": [
          { ...CALENDAR_PROMPT, promptId: "prompt-retracted" },
        ],
        "detection-prompt-retracted": [
          {
            eventSchemaVersion: 2,
            promptId: "prompt-retracted",
            reason: "event_ended",
          },
        ],
      },
    });

    await page.goto("/consent");

    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("detection-panel-ack")),
      )
      .toBe("prompt-retracted");
    await expect(
      page.getByRole("heading", { name: "Weekly sync — record it?" }),
    ).toBeHidden();
  });

  test("does not acknowledge a prompt hidden by an active recording", async ({
    page,
  }) => {
    await installTauriMock(page, {
      responses: {
        meeting_consent_panel_active_state: ACTIVE_PANEL_STATE,
      },
      events: {
        "detection-prompt": [
          { ...CALENDAR_PROMPT, promptId: "prompt-behind-recording" },
        ],
      },
    });

    await page.goto("/consent");

    await expect(page.getByText("Recording", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Weekly sync — record it?" }),
    ).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("detection-panel-ack")),
      )
      .toBe("");
  });
});
