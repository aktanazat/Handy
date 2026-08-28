import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauri-mock";

test.describe("Meetings", () => {
  test("a detected meeting reaches explicit consent before capture start", async ({
    page,
  }) => {
    await installTauriMock(page, {
      responses: {
        // One pending suggestion, so the meetings surface renders the detected
        // meeting path rather than its empty state.
        meeting_suggestions_list: [
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
        ],
      },
    });

    await page.goto("/");
    // Meetings is a segment of the Library section, not a top-level nav item.
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: "Meetings", exact: true }).click();
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
      .poll(() =>
        page.evaluate(() => Number(localStorage.getItem("meeting-started"))),
      )
      .toBe(0);

    await page.getByRole("button", { name: "Check recording setup" }).click();
    const start = page.getByRole("button", {
      name: "Start local notes",
      exact: true,
    });
    await expect(start).toBeDisabled();
    await page.getByLabel("I have permission to capture this meeting.").check();
    await expect(start).toBeEnabled();
    await start.click();

    await expect(page.getByText("Active capture")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => Number(localStorage.getItem("meeting-started"))),
      )
      .toBe(1);
  });
});
