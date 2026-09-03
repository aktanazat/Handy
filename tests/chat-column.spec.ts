import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installTauriMock, type JsonValue } from "./support/tauri-mock";
import {
  APP_SETTINGS,
  CAPTURE_AT_FULL_HEIGHT,
  HISTORY_ENTRIES,
  HISTORY_RECEIPTS,
  HISTORY_STATS,
} from "./support/tauri-fixtures";

/* The chat, as a column of the window.
 *
 * The main window is hard-locked at 900x800 — `inner_size`, `min_inner_size` and
 * `max_inner_size` are the same pair in src-tauri/src/lib.rs, and `resizable` is
 * false — so a chat that is genuinely part of this window can only be paid for
 * out of the two columns already in it. That is what this suite measures: 220 +
 * 680 with the chat closed, 48 + 512 + 340 with it open, the page still beside
 * the answer rather than under it, and every destination still honest at 512.
 *
 * Geometry is read from the browser rather than from classes, because the number
 * that matters is the one the compositor arrived at: a `w-[340px]` that a flex
 * parent shrinks, or a column that lays out on top of the page instead of beside
 * it, both pass a class assertion and fail a reader.
 */

const WINDOW = { width: 900, height: 800 };
const RAIL_NAMED = 220;
const RAIL_GLYPH = 48;
const CHAT = 340;
/** 900 - 48 - 340. The page's whole budget with the chat open. */
const PAGE_NARROW = WINDOW.width - RAIL_GLYPH - CHAT;
const PAGE_WIDE = WINDOW.width - RAIL_NAMED;

/* Paired, because an unpaired chat row is inert on purpose: nothing would
 * answer a turn, and the reason is a tooltip rather than a column. */
const PAIRED_SETTINGS = {
  ...APP_SETTINGS,
  agent_panel_paired: true,
  meeting_remote_intelligence_enabled: true,
};

const LOADING = "Loading…";

/* Something on every page, because an empty state cannot overflow and a suite
 * that only ever measures one is a suite that measures nothing. Capture's full
 * week comes from the fixture the fold suite uses; the other three are given
 * the shapes their bindings name — `PaginatedHistory`, `PaginatedMeetings`,
 * `PeopleListResult` — with realistically long strings in the fields a 512pt
 * column has to fit: a full meeting title, a two-part surname, an address. */
const POPULATED = {
  ...CAPTURE_AT_FULL_HEIGHT,
  get_settings: PAIRED_SETTINGS,
  get_app_settings: PAIRED_SETTINGS,
  get_history_entries: HISTORY_ENTRIES,
  get_history_stats: HISTORY_STATS,
  get_history_run_receipts: HISTORY_RECEIPTS,
  meeting_list: {
    entries: [
      {
        kind: "meeting",
        session_id: "meeting-1",
        title: "Quarterly planning with the platform and billing teams",
        phase: "review_ready",
        created_at_utc_ms: 1_756_136_400_000,
        capture_completeness: "complete",
        processing_status: { kind: "succeeded" },
        recorded_duration_ms: 3_600_000,
      },
    ],
    has_more: false,
  },
  people_list: {
    schema_version: 1,
    revision: 1,
    entries: [
      {
        person: {
          id: "person-1",
          display_name: "Aleksandra Wojciechowska-Nowak",
          aliases: ["Ola"],
          calendar_emails: ["aleksandra.wojciechowska@example.com"],
          created_at_utc_ms: 1_756_136_400_000,
          updated_at_utc_ms: 1_756_136_400_000,
        },
        meetings_count: 12,
        last_meeting_at_utc_ms: 1_756_136_400_000,
        suggested_count: 0,
        confirmed_count: 12,
        evidence_sources: ["calendar", "speaker"],
        last_meeting: {
          session_id: "meeting-1",
          title: "Quarterly planning with the platform and billing teams",
          at_ms: 1_756_136_400_000,
          headline: {
            kind: "summary",
            text: "Agreed the billing migration lands before the freeze.",
          },
        },
      },
    ],
  },
};

/* Every destination the rail carries. Modes and Models are railless and reached
 * through the palette, and both are settings pages with the same column as
 * Settings — these five are the ones a reader is in when they open the chat. */
const DESTINATIONS = [
  "Capture",
  "Library",
  "Meetings",
  "People",
  "Settings",
] as const;

test.use({ viewport: WINDOW });

const sidebarNav = (page: Page) =>
  page.getByRole("navigation", { name: "Main navigation" });
const palette = (page: Page) => page.getByRole("dialog");
const column = (page: Page) => page.locator('[data-slot="chat-sheet"]');
const shell = (page: Page) => page.locator(".app-shell");
const frame = (page: Page) => page.locator('[data-slot="chat-frame"]');
/* The rail's chat row: found by its accessible name, which is the part of the
 * door that is not allowed to change silently. The outgoing visual rail during
 * travel is `aria-hidden` and `inert`, so a role query never sees its twin. */
const chatRow = (page: Page) =>
  page.getByRole("button", { name: "Chat with the Sona agent" });

const openApp = async (page: Page, extra: Record<string, JsonValue> = {}) => {
  await installTauriMock(page, { responses: { ...POPULATED, ...extra } });
  await page.goto("/");
  // The rail is the app's first paint; waiting on it replaces every sleep.
  await expect(
    sidebarNav(page).getByRole("button", { name: "Capture", exact: true }),
  ).toBeVisible();
};

/** Settled rather than mid-travel. The root itself says when its one clock has
 * finished: the gate is raised in the commit that changes the registered
 * values and lowered by that root transition's `transitionend`, so it cannot
 * race an unrelated animation elsewhere in the app or reject when one is
 * cancelled. */
const settle = async (page: Page) => {
  await expect(shell(page)).not.toHaveAttribute("data-shell-moving", "true");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
};

const openChat = async (page: Page) => {
  await chatRow(page).click();
  await expect(column(page)).toBeVisible();
  await settle(page);
};

interface Columns {
  /** What the window shows, which nothing in the app may change. */
  windowShows: number;
  windowHeight: number;
  rail: number;
  pane: number;
  chat: number;
  band: number;
  paneSpan: { left: number; right: number };
  chatSpan: { left: number; right: number };
}

const measure = (page: Page): Promise<Columns> =>
  page.evaluate(() => {
    const spanOf = (selector: string) => {
      const node = document.querySelector(selector);
      if (node === null) throw new Error(`no ${selector} in the shell`);
      const box = node.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
        width: Math.round(box.width),
      };
    };
    const rail = spanOf('[data-slot="sidebar"]');
    const pane = spanOf('[data-slot="page-scroll"]');
    const chat = spanOf('[data-slot="chat-sheet"]');
    const band = spanOf('[data-slot="drag-band"]');
    return {
      windowShows: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
      rail: rail.width,
      pane: pane.width,
      chat: chat.width,
      band: band.width,
      paneSpan: { left: pane.left, right: pane.right },
      chatSpan: { left: chat.left, right: chat.right },
    };
  });

/* The transform technique reserves the new pane width in the press commit.
 * These samples read five compositor frames while the root still travels:
 * every value must already be the target width, never an in-between layout. */
const samplePaneWidths = (page: Page): Promise<number[]> =>
  page.evaluate(async () => {
    const pane = document.querySelector('[data-slot="page-scroll"]');
    if (pane === null) throw new Error("no page scroll owner");

    const widths: number[] = [];
    for (let frame = 0; frame < 5; frame += 1) {
      widths.push(Math.round(pane.getBoundingClientRect().width));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    return widths;
  });

interface Sideways {
  draws: number;
  shows: number;
  windowDraws: number;
  windowShows: number;
  /** The first few boxes that reach past the page's own edges, if any. */
  spills: string[];
}

/**
 * Whether the page fits the width it was left.
 *
 * Two readings, because one of them can hide the other. The scroll numbers catch
 * content that pushes the page sideways; the box walk catches content that
 * reaches past the pane's edges while an ancestor's `overflow` quietly eats the
 * evidence, which is the shape a too-wide card takes inside this shell. A node
 * whose clipping is somebody's decision — anything under an `overflow` that is
 * not `visible`, which is every `truncate` and every scroller in the app — is
 * skipped: that is a design, not a defect.
 */
const sideways = (page: Page): Promise<Sideways> =>
  page.evaluate(() => {
    // SAFETY: the slot is App.tsx's rendered scroll owner, and the caller has
    // already waited for the route inside it.
    const pane = document.querySelector(
      '[data-slot="page-scroll"]',
    ) as HTMLElement;
    const edges = pane.getBoundingClientRect();
    const clipped = (node: HTMLElement): boolean => {
      for (
        let parent = node.parentElement;
        parent !== null && parent !== pane;
        parent = parent.parentElement
      ) {
        if (getComputedStyle(parent).overflowX !== "visible") return true;
      }
      return false;
    };

    const spills: string[] = [];
    for (const node of Array.from(pane.querySelectorAll<HTMLElement>("*"))) {
      if (node.getClientRects().length === 0) continue;
      if (clipped(node)) continue;
      const box = node.getBoundingClientRect();
      if (box.right <= edges.right + 0.5 && box.left >= edges.left - 0.5)
        continue;
      spills.push(
        `<${node.tagName.toLowerCase()} class="${node.getAttribute("class") ?? ""}"> spans ${Math.round(box.left)}–${Math.round(box.right)}px`,
      );
    }

    return {
      draws: pane.scrollWidth,
      shows: pane.clientWidth,
      windowDraws: document.documentElement.scrollWidth,
      windowShows: document.documentElement.clientWidth,
      spills: spills.slice(0, 4),
    };
  });

const openDestination = async (page: Page, name: string) => {
  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeVisible();
  await page.getByRole("option", { name, exact: true }).click();
  await expect(palette(page)).toHaveCount(0);
  // The route's chunk has landed: the Suspense skeleton announces itself, and
  // so does any page that waits on a command of its own.
  await expect(page.getByRole("status", { name: LOADING })).toHaveCount(0);
};

test.describe("the shell's three columns", () => {
  test("closed: the named rail and the whole page, and no column", async ({
    page,
  }) => {
    await openApp(page);

    const shell = await measure(page);

    expect(shell.rail).toBe(RAIL_NAMED);
    expect(shell.pane).toBe(PAGE_WIDE);
    // Mounted so it has somewhere to open from, and taking no width until it
    // does — the page is exactly what it was before any of this.
    expect(shell.chat).toBe(0);
    expect(shell.rail + shell.pane).toBe(WINDOW.width);
    await expect(column(page)).toBeHidden();
    await expect(chatRow(page)).toBeVisible();
  });

  test("open: 48 + 512 + 340, beside each other, same window", async ({
    page,
  }) => {
    await openApp(page);
    await test.info().attach("chat-column-closed", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await openChat(page);

    const shell = await measure(page);
    test.info().annotations.push({
      type: "columns",
      description: `rail ${shell.rail}px, page ${shell.paneSpan.left}–${shell.paneSpan.right}px (${shell.pane}px), chat ${shell.chatSpan.left}–${shell.chatSpan.right}px (${shell.chat}px)`,
    });

    expect(shell.rail).toBe(RAIL_GLYPH);
    expect(shell.pane).toBe(PAGE_NARROW);
    expect(shell.chat).toBe(CHAT);
    expect(shell.rail + shell.pane + shell.chat).toBe(WINDOW.width);
    /* Beside, not over: the page's trailing edge is the column's leading edge,
     * and the column ends at the window's own edge. A page under an opaque
     * column is the thing this cutover exists to remove. */
    expect(shell.paneSpan.right).toBe(shell.chatSpan.left);
    expect(shell.chatSpan.right).toBe(WINDOW.width);
    /* And the window itself never moved. The chat used to be a second webview
     * kept in geometric lockstep with this one; the point of a column is that
     * there is nothing to keep in step. */
    expect(shell.windowShows).toBe(WINDOW.width);
    expect(shell.windowHeight).toBe(WINDOW.height);
    await test.info().attach("chat-column-open", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

  test("the pane keeps one full-width drag band at the narrowed width", async ({
    page,
  }) => {
    await openApp(page);
    expect((await measure(page)).band).toBe(PAGE_WIDE);

    await openChat(page);
    /* The window is still movable with the chat open: the band is the pane's
     * own top strip, so it narrows with the pane instead of disappearing under
     * a column that used to lie across it. */
    expect((await measure(page)).band).toBe(PAGE_NARROW);
    await expect(
      page.locator('[data-slot="drag-band"][data-tauri-drag-region]'),
    ).toHaveCount(1);
  });

  test("closing gives the page and the rail's words back", async ({ page }) => {
    await openApp(page);
    await openChat(page);

    await page.getByRole("button", { name: "Close chat" }).click();
    await settle(page);

    const shell = await measure(page);
    expect(shell.rail).toBe(RAIL_NAMED);
    expect(shell.pane).toBe(PAGE_WIDE);
    expect(shell.chat).toBe(0);
    /* And the door is back where the press started, with focus on it: whoever
     * closed the column with its X had the element under their focus taken off
     * screen, and a keyboard reader may not be left on the body. */
    await expect(chatRow(page)).toBeVisible();
    await expect(chatRow(page)).toBeFocused();
  });
});

/* The shell's one clock.
 *
 * Grid tracks would make the rail, page and chat look like one movement, but
 * interpolating them still re-lays out the flexing page on every frame. This
 * shell takes the layout jump in the press frame instead: 48/512/340 on open
 * and 220/680/0 on close are complete before the first animation frame. One
 * registered transition on the root then drives the fixed frame's transform
 * and the two fixed-width rail forms' opacity. The tests read computed styles
 * and browser transition events rather than classes because a class can say
 * the right thing while a later CSS rule gives a pane a second clock. */
test.describe("the shell's one travel", () => {
  const travelOf = (page: Page, selector: string) =>
    page.locator(selector).evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        properties: style.transitionProperty,
        durations: style.transitionDuration
          .split(",")
          .map((value) => Number.parseFloat(value)),
        easing: style.transitionTimingFunction,
      };
    });

  /* The root's sampled spring is intentionally slightly underdamped. The
   * resolved `linear()` is the only timing function the shell travel owns. */
  const SHELL_SPRING = "linear(";

  test("the shell root is the sole transition owner", async ({ page }) => {
    await openApp(page);

    const clock = await travelOf(page, ".app-shell");
    expect(
      clock.properties
        .split(",")
        .map((property) => property.trim())
        .sort(),
    ).toEqual(
      [
        "--shell-chat-offset",
        "--shell-rail-enter-opacity",
        "--shell-rail-exit-opacity",
      ].sort(),
    );
    expect(clock.durations.every((value) => value === 0.3)).toBe(true);
    expect(clock.easing).toContain(SHELL_SPRING);
    await expect(frame(page)).toHaveCSS("contain", "layout style");
    await expect(frame(page)).toHaveCSS("will-change", "auto");

    /* Every box that decides the page's geometry snaps. `none`, rather than a
     * missing utility whose initial property is `all`, pins that a broad future
     * rule cannot make a second width transition in the pane or rail. */
    for (const selector of [
      '[data-slot="sidebar"]',
      "main.settings-main",
      '[data-slot="page-scroll"]',
      '[data-slot="chat-sheet"]',
      '[data-slot="chat-frame"]',
    ]) {
      expect((await travelOf(page, selector)).properties).toBe("none");
    }
  });

  test("the intent gate keeps the root clock and rail crossfade together", async ({
    page,
  }) => {
    await openApp(page);
    await shell(page).evaluate((node) => {
      node.dataset.shellTransitionRuns = "";
      node.addEventListener("transitionrun", (event) => {
        const target = event.target;
        const targetName =
          target === node
            ? "shell"
            : target instanceof HTMLElement
              ? (target.getAttribute("data-slot") ?? "")
              : "";
        const prior = node.dataset.shellTransitionRuns;
        const run = `${targetName}:${event.propertyName}`;
        node.dataset.shellTransitionRuns =
          prior === "" ? run : `${prior},${run}`;
      });
    });

    await chatRow(page).click();
    await expect(shell(page)).toHaveAttribute("data-shell-moving", "true");
    await expect(frame(page)).toHaveCSS("will-change", "transform");
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCSS(
      "will-change",
      "opacity",
    );
    await expect(page.locator('[data-slot="sidebar-ghost"]')).toHaveCSS(
      "will-change",
      "opacity",
    );
    /* The gate reaches into the sheet while the root remains the sole owner.
     * A focus or hover wash inside it cannot start another clock half-way
     * through the slide. */
    await expect(page.getByRole("button", { name: "Close chat" })).toHaveCSS(
      "transition-property",
      "none",
    );
    await expect(
      page.locator('[data-slot="page-scroll"] button').first(),
    ).toHaveCSS("transition-property", "none");

    await expect
      .poll(() =>
        shell(page).evaluate((node) => {
          const runs = node.dataset.shellTransitionRuns;
          if (runs === undefined || runs === "") return [];
          return runs
            .split(",")
            .map((run) => {
              const [target, property] = run.split(":");
              return { property, target };
            })
            .sort((left, right) => left.property.localeCompare(right.property));
        }),
      )
      .toEqual([
        { property: "--shell-chat-offset", target: "shell" },
        { property: "--shell-rail-enter-opacity", target: "shell" },
        { property: "--shell-rail-exit-opacity", target: "shell" },
      ]);

    await settle(page);
    await expect(shell(page)).not.toHaveAttribute("data-shell-moving", "true");
    await expect(frame(page)).toHaveCSS("will-change", "auto");
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCSS(
      "will-change",
      "auto",
    );
    await expect(page.locator('[data-slot="sidebar-ghost"]')).toHaveCount(0);
  });

  test("a mounted closed column does not begin travelling", async ({
    page,
  }) => {
    await openApp(page);

    const transitions = await shell(page).evaluate((node) =>
      node
        .getAnimations({ subtree: true })
        .filter(
          (animation): animation is CSSTransition =>
            animation instanceof CSSTransition,
        )
        .map((transition) => transition.transitionProperty),
    );

    expect(transitions).toEqual([]);
    await expect(shell(page)).not.toHaveAttribute("data-shell-moving", "true");
  });

  test("the page and rail reach their final geometry in the press frame", async ({
    page,
  }) => {
    await openApp(page);

    await chatRow(page).click();
    await expect(shell(page)).toHaveAttribute("data-shell-moving", "true");
    expect(await samplePaneWidths(page)).toEqual(
      Array.from({ length: 5 }, () => PAGE_NARROW),
    );
    expect(await measure(page)).toMatchObject({
      rail: RAIL_GLYPH,
      pane: PAGE_NARROW,
      chat: CHAT,
    });
    /* The outgoing named rail is a separate, non-interactive fixed-width
     * visual during the same root transition; it does not make the page wait
     * to reach 512. */
    expect(
      (await page.locator('[data-slot="sidebar-ghost"]').boundingBox())?.width,
    ).toBe(RAIL_NAMED);
    await settle(page);

    await page.getByRole("button", { name: "Close chat" }).click();
    await expect(shell(page)).toHaveAttribute("data-shell-moving", "true");
    expect(await samplePaneWidths(page)).toEqual(
      Array.from({ length: 5 }, () => PAGE_WIDE),
    );
    expect(await measure(page)).toMatchObject({
      rail: RAIL_NAMED,
      pane: PAGE_WIDE,
      chat: 0,
    });
    expect(
      (await page.locator('[data-slot="sidebar-ghost"]').boundingBox())?.width,
    ).toBe(RAIL_GLYPH);
    await settle(page);
  });

  test("a device that asked to reduce motion gets no travel", async ({
    page,
  }) => {
    await installTauriMock(page, {
      responses: {
        get_settings: PAIRED_SETTINGS,
        get_app_settings: PAIRED_SETTINGS,
      },
    });
    /* `emulateMedia`, not the `reducedMotion` fixture option: the fixture did
       not reach `window.matchMedia` in this harness, which would have made the
       assertions below pass for the wrong reason. */
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(
      sidebarNav(page).getByRole("button", { name: "Capture", exact: true }),
    ).toBeVisible();

    await chatRow(page).click();

    expect((await travelOf(page, ".app-shell")).properties).toBe("none");
    expect((await travelOf(page, '[data-slot="chat-frame"]')).properties).toBe(
      "none",
    );
    expect(
      await shell(page).evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((animation) => animation instanceof CSSTransition).length,
      ),
    ).toBe(0);
    await expect(shell(page)).not.toHaveAttribute("data-shell-moving", "true");
    // And it is simply there, at its width, on the frame after the press.
    expect(await measure(page)).toMatchObject({
      rail: RAIL_GLYPH,
      pane: PAGE_NARROW,
      chat: CHAT,
    });
  });
});

test.describe("the gestures that open and close it", () => {
  test("the rail's row is the door, and only the column's X and Esc close it", async ({
    page,
  }) => {
    await openApp(page);
    await openChat(page);

    /* One control for one fold. The door stays in the rail and says the column
     * is showing, rather than vanishing from under the pointer that pressed
     * it; what it does not become is a second closer. */
    await expect(chatRow(page)).toHaveCount(1);
    await expect(chatRow(page)).toHaveAttribute("aria-expanded", "true");
    await expect(chatRow(page)).not.toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("button", { name: "Close chat" }),
    ).toBeVisible();

    /* And pressing it again is the same request, not the opposite one: the
     * column is still open and still 340 wide. */
    await chatRow(page).click();
    await settle(page);
    expect((await measure(page)).chat).toBe(CHAT);
  });

  /* Opening moves focus into the column, which is what makes Escape reach it at
   * all: the key is bound on the column rather than on the window, so that a
   * palette or a dialog over it keeps Escape first. */
  test("opening it puts the caret in the field, and Esc closes from there", async ({
    page,
  }) => {
    await openApp(page);
    await openChat(page);

    const field = page.getByRole("textbox", { name: "Ask about Sona" });
    await expect(field).toBeFocused();

    await page.keyboard.press("Escape");
    await settle(page);

    expect((await measure(page)).chat).toBe(0);
    await expect(chatRow(page)).toBeVisible();
  });

  /* The palette's own way in. It is the same fold: a second surface that opened
   * a column of its own would be the duplication this cutover removed. */
  test("the palette's agent row opens the same column", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press("Meta+k");
    await expect(palette(page)).toBeVisible();
    await page.getByRole("option", { name: "Open agent", exact: true }).click();
    await expect(palette(page)).toHaveCount(0);
    await settle(page);

    expect(await measure(page)).toMatchObject({
      rail: RAIL_GLYPH,
      pane: PAGE_NARROW,
      chat: CHAT,
    });
    await expect(column(page)).toHaveCount(1);
  });
});

test.describe("the rail, collapsed for the column", () => {
  test("every destination survives as a glyph that still says its name", async ({
    page,
  }) => {
    await openApp(page);
    await openChat(page);

    const nav = sidebarNav(page);
    for (const name of DESTINATIONS) {
      const row = nav.getByRole("button", { name, exact: true });
      await expect(row).toBeVisible();
      // 8 + 32 + 8 is the rail's 48: the row is a square, not a truncated line.
      const box = await row.boundingBox();
      expect(box?.width).toBe(32);
      expect(box?.height).toBe(32);
    }
    // Still one selected route, and still the one the shell is showing.
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(
      nav.getByRole("button", { name: "Capture", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("a glyph still navigates, and the column stays open across the route", async ({
    page,
  }) => {
    await openApp(page);
    await openChat(page);

    await sidebarNav(page)
      .getByRole("button", { name: "People", exact: true })
      .click();
    await expect(page.getByRole("status", { name: LOADING })).toHaveCount(0);

    await expect(
      sidebarNav(page).getByRole("button", { name: "People", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    expect((await measure(page)).chat).toBe(CHAT);
  });

  test("the name is recoverable: hovering a glyph says it", async ({
    page,
  }) => {
    await openApp(page);
    await openChat(page);

    await sidebarNav(page)
      .getByRole("button", { name: "Meetings", exact: true })
      .hover();
    await expect(page.getByRole("tooltip")).toHaveText("Meetings");
  });
});

/* Every page, at the width the column leaves it.
 *
 * 512 is 200 less than these pages have ever been laid out in, and the promise
 * the directive makes is that what is left is usable rather than merely present:
 * the 760 column narrows, grids stack, and nothing is pushed off the side where
 * no scroll reaches it. */
test.describe("the pages at 512", () => {
  test("no destination overflows sideways with the column open", async ({
    page,
  }) => {
    await openApp(page);
    await openChat(page);

    for (const destination of DESTINATIONS) {
      await openDestination(page, destination);
      const fit = await sideways(page);
      test.info().annotations.push({
        type: "columns",
        description: `${destination} at ${fit.shows}px: draws ${fit.draws}px${fit.spills.length === 0 ? "" : `, spills ${fit.spills.join("; ")}`}`,
      });

      expect(fit.shows).toBe(PAGE_NARROW);
      expect(
        fit.draws,
        `${destination}: the page draws ${fit.draws}px across ${fit.shows}px`,
      ).toBeLessThanOrEqual(fit.shows);
      expect(
        fit.spills,
        `${destination}: boxes reaching past the page's own edges`,
      ).toEqual([]);
      // And nothing reached the window either, which is where a scrollbar
      // would have appeared on a window that cannot have one.
      expect(fit.windowDraws).toBeLessThanOrEqual(fit.windowShows);
    }
  });
});

/* What the column has to keep. It was a 420pt slide-over and is now a 340pt
 * column, and the whole surface — history, scope, composer, the states where
 * nothing would answer — has to arrive intact at the narrower width. */
test.describe("the chat at 340", () => {
  test("the header, the scope row and the composer are all there", async ({
    page,
  }) => {
    await openApp(page);
    await openChat(page);

    const chat = column(page);
    await expect(chat).toContainText(
      "Ask what you said or agreed, or what to change.",
    );
    await expect(
      chat.getByRole("button", { name: "Recent chats" }),
    ).toBeVisible();
    await expect(chat.getByRole("button", { name: "New chat" })).toBeVisible();
    await expect(
      chat.getByRole("radiogroup", { name: "Who answers" }),
    ).toBeVisible();
    await expect(chat.getByRole("radio")).toHaveCount(2);
    await expect(chat.getByPlaceholder("Ask anything")).toBeVisible();
    await expect(chat.getByRole("button", { name: "Send" })).toBeVisible();
  });

  test("the history popover still opens beside the column", async ({
    page,
  }) => {
    await openApp(page);
    await openChat(page);

    await column(page).getByRole("button", { name: "Recent chats" }).click();
    // Portalled, so it is read off the page rather than out of the column.
    await expect(page.getByText("No earlier chats yet.")).toBeVisible();
  });

  /* A conversation with everything in it: a question, an answer carrying a
   * `sona://` address, a work disclosure with a step, and a settings card with
   * Apply on it. These are the four things the surface draws that were laid out
   * for 420pt, and this is the width they have now. */
  const ANSWERED = {
    agent_panel_status: {
      invalidation_id: 2,
      relay_status: "ready",
      conversation_id: "conversation-1",
      conversation: [
        { role: "user", message: "Where did we agree that?" },
        {
          role: "assistant",
          message: "In sona://meeting/meeting-1, just before the break.",
        },
        { role: "user", message: "Turn off filler-word removal for Email." },
        {
          role: "assistant",
          message: "Disable filler-word removal for Email mode.",
        },
      ],
      turn: {
        turn_id: "turn-1",
        workspace: "sona_config",
        state: "succeeded",
        event_cursor: 2,
        started_at_utc_ms: 1_756_136_400_000,
        completed_at_utc_ms: 1_756_136_403_000,
        steps: [
          {
            id: "step-1",
            label: "Read the Email mode's post-processing settings",
            state: "done",
            started_after_ms: 0,
            ended_after_ms: 2_400,
          },
        ],
      },
      proposal: {
        proposal_id: "proposal-1",
        summary: "Disable filler-word removal for Email mode.",
        rationale:
          "You asked for verbatim transcripts in that mode, and filler-word removal rewrites them.",
        actions: [{ key: "remove_filler_words", value: "false" }],
        follow_up_question: null,
        source_settings_revision: 7,
        confirmation: "automatic",
        state: "pending",
        receipt_id: null,
        applied_revision: null,
      },
    },
  };

  test("an answered turn keeps its card, its disclosure and its link", async ({
    page,
  }) => {
    await openApp(page, ANSWERED);
    await openChat(page);

    const chat = column(page);
    await expect(chat).toContainText("Turn off filler-word removal for Email.");
    // The card takes the row whose words it already is, and carries Apply.
    await expect(chat.locator('[data-slot="chat-proposal"]')).toHaveCount(1);
    /* Read in full, wrapped, not cut: the card is the only place this sentence
     * appears, so Apply has to sit under all of it. */
    await expect(chat).toContainText(
      "Disable filler-word removal for Email mode.",
    );
    await expect(chat.getByRole("button", { name: "Apply" })).toBeVisible();
    await expect(chat).toContainText("remove_filler_words");
    // An address in an answer is a press, at this width as at the last one.
    await expect(
      chat.getByRole("button", { name: "sona://meeting/meeting-1" }),
    ).toBeVisible();
    /* The work line is a disclosure, closed, with the step inside it. It is a
     * button with `aria-expanded` rather than a <summary>: WebKit's
     * accessibility layer exposes no press action on a summary element, so a
     * live accessibility run could not open this list, and the app ships in a
     * WKWebView. Read here as the reader meets it — press it and the steps
     * appear — because that is the half a <summary> could not keep. */
    const work = chat.locator('[data-slot="chat-steps-toggle"]');
    await expect(work).toHaveCount(1);
    await expect(work).toHaveAttribute("aria-expanded", "false");
    await expect(chat).toContainText("Worked for 3s");
    /* The list stays in the document and is `hidden` while closed — that is
     * what keeps it out of the accessibility tree and the tab order while
     * leaving `aria-controls` pointing at a node that exists — so what is read
     * here is visibility, not presence. */
    const steps = chat.locator('[data-slot="chat-step"]');
    await expect(steps).toHaveCount(1);
    await expect(steps).toBeHidden();

    await work.click();
    await expect(work).toHaveAttribute("aria-expanded", "true");
    await expect(steps).toBeVisible();
  });

  test("nothing inside the column overflows its own 340", async ({ page }) => {
    for (const conversation of [{}, ANSWERED]) {
      await openApp(page, conversation);
      await openChat(page);

      const spills = await column(page).evaluate((node) => {
        const edges = node.getBoundingClientRect();
        return Array.from(node.querySelectorAll<HTMLElement>("*"))
          .filter((child) => child.getClientRects().length > 0)
          .filter((child) => {
            const box = child.getBoundingClientRect();
            return box.right > edges.right + 0.5 || box.left < edges.left - 0.5;
          })
          .map(
            (child) =>
              `<${child.tagName.toLowerCase()} class="${child.getAttribute("class") ?? ""}">`,
          )
          .slice(0, 4);
      });

      expect(spills).toEqual([]);
    }
  });
});
