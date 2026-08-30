import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauri-mock";

test.describe("App shell", () => {
  test("the sidebar carries every destination", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    const nav = page.locator(".app-sidebar-nav");
    for (const name of [
      "Capture",
      "Library",
      "Modes",
      "Meetings",
      "Settings",
    ]) {
      await expect(
        nav.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    }
  });

  test("aria-current names the active route and follows it", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.goto("/");

    const nav = page.locator(".app-sidebar-nav");
    const capture = nav.getByRole("button", { name: "Capture", exact: true });
    const meetings = nav.getByRole("button", { name: "Meetings", exact: true });

    await expect(capture).toHaveAttribute("aria-current", "page");

    // Meetings is a first-class destination, not a segment inside Library.
    await meetings.click();
    await expect(meetings).toHaveAttribute("aria-current", "page");
    await expect(capture).not.toHaveAttribute("aria-current", "page");
  });

  test("the Settings row opens the settings hub", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page
      .locator(".app-sidebar-nav")
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expect(page.locator(".settings-hub")).toBeVisible();
  });

  test("the search row opens the command palette", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.locator(".app-sidebar-search").click();
    await expect(page.locator(".command-palette")).toBeVisible();
  });
});
