import { expect, test } from "@playwright/test";

import { APP_SETTINGS } from "./support/tauri-fixtures";
import {
  emitTauriEvent,
  installEventProbe,
  listenerCounts,
} from "./support/tauri-event-probe";
import { installTauriMock } from "./support/tauri-mock";

/* Every native event the overlay webview subscribes to while it is on screen:
 * the eight the HUD registers (src/overlay/overlayEvents.ts:116-129), the
 * appearance follow the route owns (src/app/overlay/page.tsx:30-35) and the
 * theme follow bootstrapWindow adds (src/lib/bootstrapWindow.ts:61-64). The
 * map is named event by event so a new or lost subscription fails on its own
 * name instead of on a total nobody can read. */
const OVERLAY_LISTENERS = {
  "show-overlay": 1,
  "hide-overlay": 1,
  "recording-ready": 1,
  "mic-level": 1,
  "stream-text-event": 1,
  "stream-phase-event": 1,
  "stream-engine-event": 1,
  "recording-error": 1,
  "settings-changed": 1,
  "theme-changed": 1,
} satisfies Record<string, number>;

test("the overlay route turns native events into one live HUD", async ({
  page,
}) => {
  const overlaySettings = {
    ...APP_SETTINGS,
    appearance_material: "solid",
  };
  await installTauriMock(page, {
    responses: {
      get_app_settings: overlaySettings,
      get_settings: overlaySettings,
    },
  });
  await installEventProbe(page);
  await page.goto("/overlay");

  await expect(page.locator("#root")).toBeVisible();
  /* One listener per event, not two. React StrictMode mounts the appearance
   * effect twice under `next dev`, which is the server Playwright runs, so a
   * cleanup that fails to release `settings-changed` shows up here as a count
   * of 2. A production export mounts once, where this line only states that
   * the subscription exists. */
  await expect.poll(() => listenerCounts(page)).toEqual(OVERLAY_LISTENERS);
  await expect(page.getByRole("img", { name: "Input level" })).toHaveCount(0);

  await emitTauriEvent(page, "show-overlay", "recording");
  await expect(page.getByRole("img", { name: "Input level" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Starting");

  await emitTauriEvent(page, "recording-ready", null);
  await expect(page.getByRole("status")).toHaveText("Listening");

  await emitTauriEvent(page, "settings-changed", {
    setting: "appearance_material",
    value: "glass",
  });
  await expect(page.locator("html")).toHaveAttribute("data-material", "glass");

  await emitTauriEvent(page, "hide-overlay", null);
  await expect(page.getByRole("img", { name: "Input level" })).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});
