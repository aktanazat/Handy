import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauri-mock";

/* The main window ships at a fixed 900x680 (lib.rs), which leaves the Activity
 * band's three cards about 200pt each. That is the width its layout has to
 * survive, so this is the width the test runs at. */
test.use({ viewport: { width: 900, height: 680 } });

const day = (localDate: string, recordings: number) => ({
  local_date: localDate,
  recordings,
  duration_ms: recordings * 2_000,
  words: recordings * 20,
  by_source: [],
});

const HISTORY_TREND = {
  range: "days_180",
  range_start_local_date: "2026-08-24",
  range_end_local_date: "2026-08-30",
  all_time: { recordings: 28, duration_ms: 56_000, words: 560, by_source: [] },
  range_total: {
    recordings: 28,
    duration_ms: 56_000,
    words: 560,
    by_source: [],
  },
  active_days: 7,
  current_streak_days: 3,
  points: [
    day("2026-08-24", 1),
    day("2026-08-25", 2),
    day("2026-08-26", 3),
    day("2026-08-27", 4),
    day("2026-08-28", 5),
    day("2026-08-29", 6),
    day("2026-08-30", 7),
  ],
};

test.describe("the Capture page's Activity band", () => {
  test("names every measurement in full and keeps its pager reachable", async ({
    page,
  }) => {
    await installTauriMock(page, {
      responses: { get_history_trend: HISTORY_TREND },
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
});
