import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installTauriMock } from "./support/tauri-mock";
import { APP_SETTINGS, CAPTURE_AT_FULL_HEIGHT } from "./support/tauri-fixtures";

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

/* One page of the query plane, one row per kind it produces. The shape is
 * `QuerySearchPage` in src/bindings.ts. */
const planeRow = (kind: string, id: string, title: string) => ({
  kind,
  id,
  title,
  snippet: `why ${title} is in front of you`,
  when_utc_ms: 1_786_699_920_000,
  link: `sona://${kind}/${id}`,
});

const SEARCH_PAGE = {
  schema_version: 1,
  entries: [
    planeRow("meeting", "meeting-1", "Weekly planning"),
    planeRow("person", "person-1", "Stephen Kowalski"),
    planeRow("dictation", "7", "A dictated note"),
    planeRow("loop", "meeting-1:loop:a", "Send the tier comparison"),
  ],
  next_cursor: null,
};

/* The ask row is gated on the panel toggle, a pairing and D14's consent, and
 * the install that reported this had all three. */
const PAIRED_SETTINGS = {
  ...APP_SETTINGS,
  agent_panel_paired: true,
  meeting_remote_intelligence_enabled: true,
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

    /* Two characters in, the field is a corpus search as well as a filter, so
       the one sentence covers both halves: no command matched and the plane
       came back with nothing. "No commands found" would answer half the
       question the reader just asked. */
    await page.getByRole("combobox").fill("zzzzzz");
    await expect(options).toHaveCount(0);
    await expect(page.getByText("Nothing matched “zzzzzz”.")).toBeVisible();
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

  /* The keyboard half of the same contract: typing narrows to one destination,
   * which cmdk selects, and Enter is the press. */
  test("Enter on the one matched destination navigates too", async ({
    page,
  }) => {
    await openApp(page);
    await page.keyboard.press("Meta+k");

    await page.getByRole("combobox").fill("Settings");
    const option = page.getByRole("option", { name: "Settings", exact: true });
    await expect(option).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("Enter");

    await expect(palette(page)).toHaveCount(0);
    await expect(
      sidebarNav(page).getByRole("button", { name: "Settings", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  /* ⌘K's second half, which nothing covered until a live run reported it
   * broken. Two characters in, the field is a search of the corpus, and the
   * plane's page becomes one titled section per kind.
   *
   * "notes" is the word the live corpus actually answered — it returned a
   * Meetings section — so it is the word typed here, and the empty-corpus case
   * below keeps the "sync" that reported the finding. Two readings of one
   * surface: a page of rows becomes sections, and no page becomes a sentence. */
  test("a page from the query plane becomes one section per kind", async ({
    page,
  }) => {
    await installTauriMock(page, {
      responses: { sona_query_search: SEARCH_PAGE },
    });
    await page.goto("/");
    await expect(
      sidebarNav(page).getByRole("button", { name: "Capture", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Meta+k");
    await page.getByRole("combobox").fill("notes");

    for (const heading of ["Meetings", "People", "Dictations", "Open loops"]) {
      await expect(page.getByRole("group", { name: heading })).toBeVisible();
    }
    await expect(
      page.getByRole("option", { name: /Weekly planning/ }),
    ).toBeVisible();
    /* A row that matched semantically shares no letter with what was typed, so
       the list may reorder the plane's rows but may never filter one away. */
    await expect(page.getByText("Nothing matched")).toHaveCount(0);
  });

  /* The live report: typing a real word rendered the Ask row and nothing else,
   * which reads exactly like a broken search. It was not — the corpus had no
   * match — but the palette had no way to say so: `CommandEmpty` is cmdk's
   * "no rows at all" branch, and the Ask row is a row, so on a paired install
   * that branch can never fire. */
  test("a corpus that matched nothing says so beside the ask row", async ({
    page,
  }) => {
    await installTauriMock(page, {
      responses: {
        get_settings: PAIRED_SETTINGS,
        get_app_settings: PAIRED_SETTINGS,
      },
    });
    await page.goto("/");
    await expect(
      sidebarNav(page).getByRole("button", { name: "Capture", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Meta+k");
    await page.getByRole("combobox").fill("sync");

    // The row that used to be the only thing on screen.
    await expect(page.getByRole("option", { name: /Ask Sona/ })).toBeVisible();
    await expect(page.getByText("Nothing matched “sync”.")).toBeVisible();
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

/* The fold.
 *
 * The window is hard-locked at 900x800 (src-tauri/src/lib.rs), so "below the
 * fold" is one fixed number rather than a guess about somebody's monitor: it is
 * whatever the shell's one scroll region cannot show at rest.
 *
 * Capture is the default route and the page that has to answer at a glance, so
 * the promise it keeps is its numbers: the hero and the Activity band are read
 * without a scroll. The feed under them is a list that grows with the corpus,
 * so the whole page fitting is not a promise this route can keep at all — it
 * was pinned as one, the fixture behind it held a single feed row, and the
 * shipped build cut the Activity charts off at the bottom edge while this suite
 * stayed green. Every other route may scroll, because Library, Meetings and
 * Settings are logs and a log that runs past the window is still a log. What no
 * route may do is put a section where scrolling never reaches it. */
test.describe("the fold at the shipped window size", () => {
  test.use({ viewport: { width: 900, height: 800 } });

  const LOADING = "Loading…";
  const DESTINATIONS = [
    "Capture",
    "Library",
    "Modes",
    "Meetings",
    "People",
    "Settings",
    "Models",
  ] as const;

  interface FoldSection {
    name: string;
    top: number;
    bottom: number;
  }
  interface FoldReport {
    /** What the window shows of the scroll region, in CSS pixels. */
    visible: number;
    /** What scrolling covers. Equal to `visible` when nothing scrolls. */
    content: number;
    /**
     * What the route actually draws: its column's own height, padding
     * included. Read separately from `content` because Capture's column is
     * `min-h-full` and centred, so its box is the window's height whether the
     * page fills it or not — the number that answers "does this fit" is this
     * one.
     */
    natural: number;
    /** Every named section, offset from the top of the scrollable content. */
    sections: FoldSection[];
  }

  /* `main` holds exactly one child and that child is the region every page
   * scrolls inside (App.tsx), so this needs no class and no test id. The
   * sections are the pages' own `region` landmarks, which is what a reader
   * loses a whole one of when a route hides content. */
  const measureFold = (page: Page): Promise<FoldReport> =>
    page.getByRole("main").evaluate((main) => {
      // The Chat pill sits before the scroll owner in `main`, so the region is
      // addressed by its slot rather than by position.
      // SAFETY: the slot is App.tsx's rendered <div>; evaluate types the tree
      // as bare Element, so the narrow restores what the DOM guarantees.
      const region = main.querySelector(
        '[data-slot="page-scroll"]',
      ) as HTMLElement;
      const origin = region.getBoundingClientRect().top - region.scrollTop;
      const nameOf = (node: HTMLElement): string => {
        const label = node.getAttribute("aria-label");
        if (label !== null) return label;
        const ids = node.getAttribute("aria-labelledby");
        if (ids === null) return "(unnamed)";
        return ids
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
      };

      /* The route's own column is the last child of the region that draws
       * anything: the shell's banner column sits before it and collapses to
       * nothing on the ordinary path.
       *
       * Its height is measured first-drawn-child-top to last-drawn-child-bottom
       * rather than off its own box, because Capture's column is `min-h-full`
       * and centred — its box is the window's height whether the page fills it
       * or not. Gaps fall inside that span, the column's own padding is added
       * back around it, and its box height is the ceiling. Hidden children are
       * skipped at both levels: the collapsed banner here, and the settings
       * hub's inactive tab panel, which reports an all-zero box. */
      // SAFETY: children of a rendered element are HTMLElements here; the
      // browser-context Element typing is the only thing being widened past.
      const drawn = (Array.from(region.children) as HTMLElement[]).filter(
        (child) => child.getClientRects().length > 0,
      );
      const column = drawn[drawn.length - 1];
      const children =
        // SAFETY: same Element-to-HTMLElement restoration as `drawn` above.
        (Array.from(column?.children ?? []) as HTMLElement[]).filter(
          (child) => child.getClientRects().length > 0,
        );
      const first = children[0]?.getBoundingClientRect();
      const last = children[children.length - 1]?.getBoundingClientRect();
      const box = column?.getBoundingClientRect().height ?? 0;
      const edges = column === undefined ? null : getComputedStyle(column);
      const span =
        first === undefined || last === undefined || edges === null
          ? box
          : last.bottom -
            first.top +
            Number.parseFloat(edges.paddingTop) +
            Number.parseFloat(edges.paddingBottom);

      return {
        visible: region.clientHeight,
        content: region.scrollHeight,
        natural: Math.round(Math.min(box, span)),
        sections: Array.from(
          region.querySelectorAll<HTMLElement>(
            'section[aria-label], section[aria-labelledby], [role="region"]',
          ),
        ).map((section) => {
          const box = section.getBoundingClientRect();
          return {
            name: nameOf(section),
            top: Math.round(box.top - origin),
            bottom: Math.round(box.bottom - origin),
          };
        }),
      };
    });

  const openDestination = async (page: Page, name: string) => {
    await page.keyboard.press("Meta+k");
    await expect(palette(page)).toBeVisible();
    await page.getByRole("option", { name, exact: true }).click();
    await expect(palette(page)).toHaveCount(0);
    // The route's chunk has landed: the Suspense skeleton announces itself,
    // and so does any page that waits on a command of its own.
    await expect(page.getByRole("status", { name: LOADING })).toHaveCount(0);
  };

  const sectionNamed = (report: FoldReport, name: string): FoldSection => {
    const section = report.sections.find((entry) => entry.name === name);
    if (section === undefined) {
      throw new Error(
        `no "${name}" section on this page; saw ${report.sections
          .map((entry) => entry.name)
          .join(", ")}`,
      );
    }
    return section;
  };

  /* Capture's three numbers are what the page is opened for, so they are what
   * the window has to show without a scroll. The feed under them is a list
   * that grows, so it is what scrolls — the whole page fitting is not a
   * promise this route can keep, and pinning it as one is how the shipped
   * build ended up with the charts cut off by the bottom edge instead. */
  test("Capture keeps its numbers above the fold and scrolls the feed", async ({
    page,
  }) => {
    await installTauriMock(page, { responses: CAPTURE_AT_FULL_HEIGHT });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "What Sona did", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Activity" })).toBeVisible();

    const report = await measureFold(page);
    const activity = sectionNamed(report, "Activity");
    const feed = sectionNamed(report, "What Sona did");
    /* Recorded on the run so the numbers behind these thresholds stay readable
     * without re-deriving them by hand. */
    test.info().annotations.push({
      type: "fold",
      description: `Capture: draws ${report.natural}px, window shows ${report.visible}px, scrolls ${report.content}px, Activity ends at ${activity.bottom}px`,
    });

    /* The band is read from the top of the page, unscrolled, and clears the
     * fold by a margin so its bottom card reads as a card rather than as a cut
     * edge. */
    expect(report.visible - activity.bottom).toBeGreaterThanOrEqual(16);
    // And the feed is below it, which is what makes the scroll the feed's.
    expect(feed.top).toBeGreaterThanOrEqual(activity.bottom);
  });

  /* The same page, read once more with the chat column open.
   *
   * The column is part of the layout rather than a strip over it, so opening it
   * narrows the page: at the locked 900px the rail collapses to its glyph strip
   * and the content keeps what the column leaves. A window this size cannot
   * scroll sideways out of a column that does not fit — there is no wider
   * monitor to fall back on and no way to drag the window bigger — and it will
   * not show a scrollbar either, because the shell's row is `overflow-hidden`
   * all the way down. A column that overlaps the page and a column clipped off
   * the window's edge both look identical to `scrollWidth`, which is why the
   * scroll is only half of what this reads.
   *
   * The other half is that the three columns are three columns: the chat and
   * the page are horizontally disjoint, and both are inside the window. That is
   * this suite's own subject — content nobody can reach, which is what the rest
   * of the fold measures vertically — and it pins nothing the chat owns: not
   * its width, not which edge it opens against. Vertical fit is not re-asserted
   * here, because a narrower page reflows the feed and the feed is what this
   * route scrolls anyway. */
  test("Capture fits sideways with the chat column open", async ({ page }) => {
    await installTauriMock(page, {
      responses: {
        ...CAPTURE_AT_FULL_HEIGHT,
        get_settings: PAIRED_SETTINGS,
        get_app_settings: PAIRED_SETTINGS,
      },
    });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Activity" })).toBeVisible();

    /* The pill is the way in, and it needs the pairing above to be live at
     * all. It becomes unreachable once the column is open — the column's own
     * close button owns the way back out — so it is pressed once and not read
     * again. */
    await page
      .getByRole("button", { name: "Chat with the Sona agent" })
      .click();
    const column = page.locator('[data-slot="chat-sheet"]');
    await expect(column).toBeVisible();
    /* The root travel gate clears from its offset transition's own
     * `transitionend`; the sheet is only a consumer of that clock. */
    const shell = page.locator(".app-shell");
    await expect(shell).toHaveAttribute("data-shell-moving", "true");
    await expect(shell).not.toHaveAttribute("data-shell-moving", "true");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    const sideways = await page.evaluate(() => {
      const spanOf = (selector: string) => {
        const node = document.querySelector(selector);
        if (node === null) throw new Error(`no ${selector} on this page`);
        const box = node.getBoundingClientRect();
        return { left: Math.round(box.left), right: Math.round(box.right) };
      };
      // SAFETY: the slot is App.tsx's rendered scroll owner, which is on the
      // page by the time the Activity band inside it is visible.
      const pane = document.querySelector(
        '[data-slot="page-scroll"]',
      ) as HTMLElement;
      return {
        windowShows: document.documentElement.clientWidth,
        windowDraws: document.documentElement.scrollWidth,
        paneDraws: pane.scrollWidth,
        paneShows: pane.clientWidth,
        page: spanOf('[data-slot="page-scroll"]'),
        chat: spanOf('[data-slot="chat-sheet"]'),
      };
    });
    test.info().annotations.push({
      type: "fold",
      description: `Capture with the chat column open: window ${sideways.windowShows}px, page ${sideways.page.left}–${sideways.page.right}px, chat ${sideways.chat.left}–${sideways.chat.right}px, page draws ${sideways.paneDraws}px across ${sideways.paneShows}px`,
    });

    // Nothing sideways to scroll, on the window or inside the page.
    expect(sideways.windowDraws).toBeLessThanOrEqual(sideways.windowShows);
    expect(sideways.paneDraws).toBeLessThanOrEqual(sideways.paneShows);
    // Both columns inside the window, since a clipped one leaves no scroll.
    expect(sideways.chat.left).toBeGreaterThanOrEqual(0);
    expect(sideways.chat.right).toBeLessThanOrEqual(sideways.windowShows);
    expect(sideways.page.left).toBeGreaterThanOrEqual(0);
    expect(sideways.page.right).toBeLessThanOrEqual(sideways.windowShows);
    /* And they are beside each other rather than one on top of the other: the
     * page under an opaque column is the unreachable content this whole suite
     * exists to catch. Either order passes; the chat picks its own edge. */
    const disjoint =
      sideways.page.right <= sideways.chat.left ||
      sideways.chat.right <= sideways.page.left;
    expect(
      disjoint,
      `the chat column (${sideways.chat.left}–${sideways.chat.right}px) overlaps the page (${sideways.page.left}–${sideways.page.right}px)`,
    ).toBe(true);
  });

  test("no route puts a section where scrolling never reaches it", async ({
    page,
  }) => {
    await installTauriMock(page, { responses: CAPTURE_AT_FULL_HEIGHT });
    await page.goto("/");
    await expect(
      sidebarNav(page).getByRole("button", { name: "Capture", exact: true }),
    ).toBeVisible();

    for (const destination of DESTINATIONS) {
      await openDestination(page, destination);
      const report = await measureFold(page);
      test.info().annotations.push({
        type: "fold",
        description: `${destination}: draws ${report.natural}px, window shows ${report.visible}px, scrolls ${report.content}px`,
      });

      for (const section of report.sections) {
        expect(
          section.top,
          `${destination}: "${section.name}" starts above the scroll region`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          section.bottom,
          `${destination}: "${section.name}" ends past what scrolling reaches`,
        ).toBeLessThanOrEqual(report.content);
      }
    }
  });
});
