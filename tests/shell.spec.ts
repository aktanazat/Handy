import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauri-mock";

test.describe("App shell", () => {
  test("primary navigation renders", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    for (const name of ["Capture", "Library", "Modes"]) {
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    }
  });
});
