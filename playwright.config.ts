import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // The mirror of bunfig.toml's `pathIgnorePatterns`: Playwright owns `*.spec.ts`
  // here, `bun test` owns `*.test.ts(x)` everywhere. Without this, Playwright's
  // default matcher would also claim a `*.test.ts` dropped into tests/.
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:1420",
    // A developer's own `bun run dev` on 1420 is reused instead of fighting it
    // for the port; CI has no server running, so it starts one.
    reuseExistingServer: true,
    timeout: 30000,
  },
});
