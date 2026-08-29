import { describe, expect, test } from "bun:test";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* The permission screen's one hard rule, and the one a type-check cannot see:
 * `waiting` is never just a spinner. macOS shows the microphone consent dialog
 * once ever, so after a denial the poll can spin forever with nothing to click —
 * which is exactly how this screen was reported. Both escape hatches have to be
 * in the source of the waiting branch, and both strings have to be real keys.
 *
 * The component itself is not rendered here on purpose: it calls
 * `platform()` from @tauri-apps/plugin-os during its mount effect, which has no
 * host outside the webview. What is verifiable without a host is the branch
 * structure and the catalogue, and those are what regress. */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(here, "AccessibilityOnboarding.tsx"),
  "utf8",
);
const catalogue: unknown = JSON.parse(
  fs.readFileSync(
    path.join(here, "..", "..", "i18n", "locales", "en", "translation.json"),
    "utf8",
  ),
);

/* Every string this screen renders, as a schema rather than a key walk. A
 * missing key, a nested object where a sentence belongs, or an empty value all
 * fail the parse, and the failure names the path — which is the assertion. */
const RENDERED_STRINGS = z.object({
  accessibility: z.object({ openSettings: z.string().min(1) }),
  onboarding: z.object({
    headline: z.string().min(1),
    permissions: z.object({
      accessibility: z.object({ title: z.string().min(1) }),
      allGranted: z.string().min(1),
      checking: z.string().min(1),
      grant: z.string().min(1),
      granted: z.string().min(1),
      headline: z.string().min(1),
      microphone: z.object({ title: z.string().min(1) }),
      recheck: z.string().min(1),
      subhead: z.string().min(1),
      waiting: z.string().min(1),
    }),
  }),
});

describe("waiting is always actionable", () => {
  test("the waiting branch offers System Settings and a re-check", () => {
    const waitingBranch = source.slice(
      source.indexOf('status === "waiting"'),
      source.indexOf("grantLabel}"),
    );
    expect(waitingBranch).toContain("onOpenSettings");
    expect(waitingBranch).toContain("onRecheck");
    expect(waitingBranch).toContain("ob-spinner");
  });

  test("re-check restarts the poll with a fresh error budget", () => {
    const recheck = source.slice(
      source.indexOf("const handleRecheck"),
      source.indexOf("const openSettingsPane"),
    );
    // Three consecutive failures stop the interval for good, so resetting the
    // count is the part that makes the button mean anything.
    expect(recheck).toContain("errorCountRef.current = 0");
    expect(recheck).toContain("startPolling()");
  });

  test("each permission deep-links its own System Settings pane", () => {
    expect(source).toContain("Privacy_Microphone");
    expect(source).toContain("Privacy_Accessibility");
  });
});

describe("the repaired polling logic is intact", () => {
  test("the accessibility grant sync stays outside every setState updater", () => {
    // React may replay an updater; replaying an IPC call fired hundreds of
    // them in a second. The guard is that syncAccessibilityGrant is awaited on
    // its own line, never inside a setPermissions callback.
    const updaterBodies = source.match(
      /setPermissions\(\(prev\)[\s\S]*?\}\)\)/g,
    );
    expect(updaterBodies === null).toBe(false);
    for (const body of updaterBodies ?? []) {
      expect(body.includes("syncAccessibilityGrant")).toBe(false);
      expect(body.includes("commands.")).toBe(false);
      expect(body.includes("await")).toBe(false);
    }
  });

  test("the polling updater still preserves unrelated statuses", () => {
    expect(source).toContain(
      'accessibility: accessibilityGranted ? "granted" : prev.accessibility',
    );
    expect(source).toContain(
      'microphone: microphoneGranted ? "granted" : prev.microphone',
    );
  });
});

describe("catalogue", () => {
  test("every string the permission screen renders ships in English", () => {
    const parsed = RENDERED_STRINGS.safeParse(catalogue);
    const missing = parsed.success
      ? []
      : parsed.error.issues.map((issue) => issue.path.join("."));
    expect(missing).toEqual([]);
  });
});
