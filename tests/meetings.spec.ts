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
    // Meetings is a segment of the Library section, not a top-level nav item.
    // That strip is a segmented control, so the segment is a `tab`: wave 2
    // moved it onto the shared Tabs primitive, which brings the tablist
    // semantics and the roving tabindex with it.
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("tab", { name: "Meetings", exact: true }).click();

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

    await expect(page.getByText("Active capture")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => Number(localStorage.getItem("meeting-started"))),
      )
      .toBe(1);
  });
});
