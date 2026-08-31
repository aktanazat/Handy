import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installTauriMock } from "./support/tauri-mock";

/* The shell is Tailwind utilities on its components now, so nothing here
 * selects by class: every locator is a role or an accessible name, which is
 * also the part of the surface that is not allowed to change silently. The one
 * exception is the settings hub's own test id, which MeetingsSettings owns. */
const sidebarNav = (page: Page) =>
  page.getByRole("navigation", { name: "Main navigation" });
const palette = (page: Page) => page.getByRole("dialog");

const openApp = async (page: Page) => {
  await installTauriMock(page);
  await page.goto("/");
  // The rail is the app's first paint; waiting on it replaces every sleep.
  await expect(
    sidebarNav(page).getByRole("button", { name: "Capture", exact: true }),
  ).toBeVisible();
};

test.describe("App shell", () => {
  test("the sidebar carries every destination", async ({ page }) => {
    await openApp(page);

    const nav = sidebarNav(page);
    for (const name of [
      "Capture",
      "Library",
      "Meetings",
      "People",
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
    await openApp(page);

    const nav = sidebarNav(page);
    const capture = nav.getByRole("button", { name: "Capture", exact: true });
    const meetings = nav.getByRole("button", { name: "Meetings", exact: true });

    await expect(capture).toHaveAttribute("aria-current", "page");

    // Meetings is a first-class destination, not a segment inside Library.
    await meetings.click();
    await expect(meetings).toHaveAttribute("aria-current", "page");
    await expect(capture).not.toHaveAttribute("aria-current", "page");
  });

  test("the Settings row opens the hub on Essentials", async ({ page }) => {
    await openApp(page);

    await sidebarNav(page)
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expect(page.getByTestId("settings-hub")).toBeVisible();

    /* Two tabs, and Debug is absent until the chord unlocks it. Five of the
     * seven tabs this hub used to carry are gone: General, Privacy, Agents,
     * Workflows and About are all Advanced now. */
    const tabs = page.getByRole("tablist", { name: "Settings" });
    await expect(tabs.getByRole("tab")).toHaveText(["Essentials", "Advanced"]);
    await expect(
      tabs.getByRole("tab", { name: "Essentials", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  });

  /* The number this restructure exists for. Essentials is meant to be short
   * enough to read at once, and the only way that stays true is if adding a
   * row here fails a test. Rows and fields both count: a field is a row whose
   * control is too wide to sit beside its label, not a second kind of thing. */
  test("Essentials is one surface of ten to eleven rows", async ({ page }) => {
    await openApp(page);

    await sidebarNav(page)
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    const essentials = page.getByTestId("settings-essentials");
    await expect(essentials).toBeVisible();

    const rows = essentials.locator(
      '[data-slot="settings-row"], [data-slot="settings-field"]',
    );
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(10);
    expect(count).toBeLessThanOrEqual(11);

    // No section headings: the tab above already names the page.
    await expect(essentials.getByRole("heading")).toHaveCount(0);
  });

  test("Advanced carries the sections the folded tabs became", async ({
    page,
  }) => {
    await openApp(page);

    await sidebarNav(page)
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await page.getByRole("tab", { name: "Advanced", exact: true }).click();

    for (const section of [
      "Meetings",
      "Models",
      "Dictation",
      "What Sona does after a meeting",
      "Sync",
      "Agents",
      "About Sona",
    ]) {
      await expect(
        page.getByRole("heading", { name: section, exact: true }),
      ).toBeVisible();
    }

    /* Debug has no row and no link anywhere, so the one line that says how to
     * reach it is load-bearing. */
    await expect(
      page.getByText("Press \u2318\u21e7D to open the debug page."),
    ).toBeVisible();
  });

  test("the search row opens the command palette", async ({ page }) => {
    await openApp(page);

    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(palette(page)).toBeVisible();
  });
});

/* The regression this slice exists for.
 *
 * ⌘K toggles, so every keydown the shell accepts is one open-or-close. Holding
 * the chord makes the OS repeat keydown at its repeat rate, and the listener
 * used to accept all of them: the palette strobed for as long as the chord was
 * held. Two more mechanisms piled onto the same press — the surface was behind
 * a lazy chunk with a null Suspense fallback, so the first chord painted
 * nothing at all until the chunk landed, and it then entered on a spring from
 * opacity 0. Anyone who pressed again during that gap toggled it shut.
 *
 * Each test below pins one of those: exactly one dialog per press, a held
 * chord that stays open on the same element, and a press that resolves on the
 * first frame with no second surface behind it. */
test.describe("the ⌘K palette does not flicker", () => {
  /** Marks the live dialog node, so a later assertion can tell a surviving
   * element from a replacement. React drops the property with the node. */
  const tagDialog = (page: Page) =>
    palette(page).evaluate((element) => {
      // SAFETY: the palette locator resolves the dialog element, which is an
      // HTMLElement in the page; evaluate types its argument as bare Element.
      (element as HTMLElement).dataset.flickerProbe = "same-node";
    });

  test("one press opens exactly one palette", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press("Meta+k");
    await expect(palette(page)).toBeVisible();
    await expect(palette(page)).toHaveCount(1);
    /* Nothing waits for a chunk any more, so the field owns the keyboard on
       the same frame the dialog appears. Radix marks the rest of the app
       aria-hidden while the modal is up, so this is the only combobox. */
    await expect(page.getByRole("combobox")).toBeFocused();
  });

  test("holding the chord keeps one palette open on the same element", async ({
    page,
  }) => {
    await openApp(page);

    /* Playwright sets `repeat` on every `down()` after the first for a key
       that is already held — the same flag the OS sets, which is the one the
       shell now drops. */
    await page.keyboard.down("Meta");
    await page.keyboard.down("k");
    await expect(palette(page)).toBeVisible();
    await tagDialog(page);

    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.down("k");
    }
    await page.keyboard.up("k");
    await page.keyboard.up("Meta");

    await expect(palette(page)).toHaveCount(1);
    await expect(palette(page)).toHaveAttribute(
      "data-flicker-probe",
      "same-node",
    );
  });

  /* The rule itself, driven directly: a burst of synthesised repeats. This
     does not depend on how the harness models a held key, so it fails if the
     guard is removed even where `keyboard.down` stops setting `repeat`. */
  test("synthesised auto-repeats are ignored outright", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press("Meta+k");
    await expect(palette(page)).toBeVisible();
    await tagDialog(page);

    await page.evaluate(() => {
      for (let repeat = 0; repeat < 25; repeat += 1) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "k",
            metaKey: true,
            repeat: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    });

    await expect(palette(page)).toHaveCount(1);
    await expect(palette(page)).toHaveAttribute(
      "data-flicker-probe",
      "same-node",
    );
  });

  test("a second real press closes it, and Escape does too", async ({
    page,
  }) => {
    await openApp(page);

    await page.keyboard.press("Meta+k");
    await expect(palette(page)).toBeVisible();
    // The chord is still a toggle; only repeats stopped counting.
    await page.keyboard.press("Meta+k");
    await expect(palette(page)).toHaveCount(0);

    await page.keyboard.press("Meta+k");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);

    /* And the page underneath is reachable again: a modal dialog that failed
       to release focus would swallow this click. */
    const meetings = sidebarNav(page).getByRole("button", {
      name: "Meetings",
      exact: true,
    });
    await meetings.click();
    await expect(meetings).toHaveAttribute("aria-current", "page");
  });
});

test.describe("the palette's content", () => {
  test("groups destinations and actions, and filtering narrows to one", async ({
    page,
  }) => {
    await openApp(page);
    await page.keyboard.press("Meta+k");

    await expect(page.getByRole("group", { name: "Navigation" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Actions" })).toBeVisible();

    const options = page.getByRole("option");
    const before = await options.count();
    expect(before).toBeGreaterThan(2);

    await page.getByRole("combobox").fill("Import audio");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveText(/Import audio/);

    await page.getByRole("combobox").fill("zzzzzz");
    await expect(options).toHaveCount(0);
    await expect(page.getByText("No commands found")).toBeVisible();
  });

  /* One destination, one name. The palette used to label these two rows from
   * the section registry — "Overview" and "History" — for the destinations the
   * rail spells "Capture" and "Library", and the palette is the surface where
   * both spellings would have been readable at once. */
  test("destinations are named exactly as the rail names them", async ({
    page,
  }) => {
    await openApp(page);

    const railLabels = await sidebarNav(page)
      .getByRole("button")
      .allInnerTexts();
    expect(railLabels).toEqual([
      "Capture",
      "Library",
      "Meetings",
      "People",
      "Settings",
    ]);

    await page.keyboard.press("Meta+k");
    const destinations = page
      .getByRole("group", { name: "Navigation" })
      .getByRole("option");
    const paletteLabels = await destinations.allInnerTexts();

    // Modes and Models keep no rail row; every destination stays in the palette.
    expect(paletteLabels.map((label) => label.trim()).sort()).toEqual([
      "Capture",
      "Library",
      "Meetings",
      "Models",
      "Modes",
      "People",
      "Settings",
    ]);
    expect(paletteLabels).not.toContain("Overview");
    expect(paletteLabels).not.toContain("History");
  });

  test("a destination navigates and closes the palette", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Meta+k");

    await page.getByRole("option", { name: "Modes", exact: true }).click();

    await expect(palette(page)).toHaveCount(0);
    /* Modes is a railless destination: the pane changes, and no rail button
     * claims the page. */
    await expect(page.getByRole("list", { name: "Your modes" })).toBeVisible();
    await expect(sidebarNav(page).locator('[aria-current="page"]')).toHaveCount(
      0,
    );
  });
});

/* The palette's only animation. Motion is gone from this path, so what is
 * asserted is the CSS the kit's dialog already ships: `animate-in` resolves
 * `enter var(--tw-duration, .15s)`, and Tailwind's `duration-150` is what
 * pins it at 150ms instead of the kit's default 200. */
test.describe("the palette's motion", () => {
  const entrance = (page: Page) =>
    palette(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return { duration: style.animationDuration, name: style.animationName };
    });

  test("enters on a 150ms fade and scale", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press("Meta+k");
    await expect(palette(page)).toBeVisible();

    expect(await entrance(page)).toEqual({ duration: "0.15s", name: "enter" });
  });

  test("a device that asked to reduce motion gets no travel", async ({
    page,
  }) => {
    await installTauriMock(page);
    /* `emulateMedia`, not the `reducedMotion` fixture option: the fixture did
       not reach `window.matchMedia` in this harness, which would have made the
       assertions below pass for the wrong reason. */
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(
      sidebarNav(page).getByRole("button", { name: "Capture", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);

    await page.keyboard.press("Meta+k");
    await expect(palette(page)).toBeVisible();

    /* App.css collapses every CSS animation to 0.01ms for this device, so the
       palette is at its resting size on the first frame rather than growing
       into it — and a resting `zoom-in-95` leaves no transform behind. */
    const { duration } = await entrance(page);
    expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.001);
    await expect
      .poll(async () =>
        palette(page).evaluate((el) => getComputedStyle(el).transform),
      )
      .toBe("none");
  });
});
