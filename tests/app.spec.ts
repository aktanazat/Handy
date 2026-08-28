import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauri-mock";

test.describe("Sona App", () => {
  test("dev server responds", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("app mounts against the mocked Tauri runtime", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));

    await installTauriMock(page);
    await page.goto("/");

    // A mount failure leaves #root empty, so this is the cheapest proof that
    // the mocked plugin internals are complete enough for the real app.
    await expect(page.locator("#root > *")).not.toHaveCount(0);
    expect(failures).toEqual([]);
  });
});
