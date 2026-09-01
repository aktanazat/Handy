import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauri-mock";
import { CAPTURE_AT_FULL_HEIGHT } from "./support/tauri-fixtures";

/* The main window ships at a fixed 900x800 (lib.rs), which leaves the Activity
 * band's three cards about 200pt each. That is the width its layout has to
 * survive, so this is the width the test runs at. The page is the one the fold
 * suite measures — the same week of dictation, the same three-effect feed — so
 * that what this suite reads about the order and what that suite reads about the
 * fold are two readings of one page. */
test.use({ viewport: { width: 900, height: 800 } });

test.describe("the Capture page's Activity band", () => {
  test("names every measurement in full and keeps its pager reachable", async ({
    page,
  }) => {
    await installTauriMock(page, {
      responses: CAPTURE_AT_FULL_HEIGHT,
    });
    await page.goto("/");

    const band = page.getByRole("region", { name: "Activity" });
    const titles = band.getByRole("heading", { level: 3 });
    await expect(titles).toHaveCount(3);

    /* A card title that overflows its box is an ellipsis in the shipped
     * build: "Dictations" rendered as "Di…" while the range control held the
     * rest of the row. */
    const clipped = await titles.evaluateAll((headings) =>
      headings
        .filter((heading) => heading.scrollWidth > heading.clientWidth)
        .map((heading) => heading.textContent),
    );
    expect(clipped).toEqual([]);

    await expect(
      band.getByRole("button", { name: "Previous 7 days" }),
    ).toBeVisible();
    await expect(band.getByText("Aug 24–Aug 30")).toBeVisible();
  });

  /* Where the band sits, which is the other half of reading it at a glance.
   * The band shipped last on the page, under a feed that grows one card per
   * effect Sona had: at the locked window size a corpus with anything in it
   * pushed Dictations, Words and Streak past the bottom edge, so the numbers
   * the page exists to answer were the numbers you had to scroll for. The band
   * is three fixed cards and the feed is a list, so the band goes directly
   * under the hero and the feed goes below it.
   *
   * A comma selector returns its matches in document order, and these five ids
   * are every landmark this page can draw — so the sequence is the whole
   * order, and "directly" is part of what it says. */
  test("puts its three numbers directly under the hero, above the feed", async ({
    page,
  }) => {
    await installTauriMock(page, { responses: CAPTURE_AT_FULL_HEIGHT });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Activity" })).toBeVisible();

    const landmarks = [
      "overview-status",
      "overview-activity-heading",
      "overview-workflow-receipts",
      "overview-open-loops",
      "overview-learning-suggestions",
    ];
    const order = await page
      .locator(landmarks.map((id) => `[aria-labelledby="${id}"]`).join(", "))
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-labelledby")),
      );

    expect(order).toEqual(landmarks);
  });
});
