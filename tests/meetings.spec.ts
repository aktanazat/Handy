import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauri-mock";

test.describe("Meetings", () => {
  test("one press records, under a disclosure that is on screen first", async ({
    page,
  }) => {
    await installTauriMock(page, {
      responses: {
        // One pending suggestion, so the meetings surface renders the detected
        // meeting path alongside its own start block.
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
    // Meetings is a first-class sidebar destination: the sidebar shell
    // promoted it out of the old Library sub-nav, and the row lands on the
    // same meetings surface the deep-link handler targets.
    await page.getByRole("button", { name: "Meetings", exact: true }).click();

    const start = page
      .getByRole("button", { name: "Start recording", exact: true })
      .first();
    // The promise the press makes has to be readable before the press:
    // pressing Start is what the backend records as the acknowledgment.
    await expect(
      page
        .getByText("Records your Mac's audio locally. Nothing joins the call.")
        .first(),
    ).toBeVisible();
    await expect(start).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(() => Number(localStorage.getItem("meeting-started"))),
      )
      .toBe(0);

    // No setup screen in between: this press creates the session and starts
    // capture in one action.
    await start.click();

    // Stop exists only while capture is running, and only on the live surface,
    // so it is the state itself rather than a word describing the state. The
    // phase word next to it is "Recording", which `Start recording` contains —
    // matching on it would pass against the button that has not been pressed.
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => Number(localStorage.getItem("meeting-started"))),
      )
      .toBe(1);
  });
});
