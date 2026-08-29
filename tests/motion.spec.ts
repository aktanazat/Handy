import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { MODES_SNAPSHOT } from "./support/tauri-fixtures";
import { installTauriMock, type JsonValue } from "./support/tauri-mock";

/* The three Motion conversions, in a real browser with a real frame loop.
 *
 * Everything provable without a DOM is proved in the unit tests; what needs
 * Chromium is the part that only exists on screen — that a spring actually
 * travels instead of snapping, that the tab mark is one element moving between
 * segments rather than two fading, and that a pointer drag ends in the backend
 * command carrying the order it produced.
 *
 * "It animated" is asserted by sampling the property once per frame and
 * requiring distinct intermediate values. A snap never appears between the two
 * endpoints; a spring appears there repeatedly. That difference is what these
 * tests are for, and reading it needs no sleep and no timing guess. */

const MODE_IDS = MODES_SNAPSHOT.modes.map((mode) => mode.id);
const SUBNAV = ".app-subnav-inner";
const TAB_MARK = `${SUBNAV} [role="tab"] span[aria-hidden="true"]`;

/**
 * The mark's left edge, waited for rather than asserted non-null.
 *
 * The mark mounts with the tablist but lays out one frame later, so a locator
 * that already resolves can still have no box. Every read goes through here so
 * that wait lives in one place instead of each caller's `!`.
 */
const markX = async (page: Page): Promise<number> => {
  const mark = page.locator(TAB_MARK);
  await expect(mark).toBeVisible();
  const box = await mark.boundingBox();
  if (box === null) throw new Error("the tab mark is visible but has no box");
  return box.x;
};

/** MODES_SNAPSHOT reordered, which is what the backend answers a reorder with. */
const reorderedSnapshot = (orderedIds: readonly string[]) => ({
  ...MODES_SNAPSHOT,
  modes: orderedIds.map((id) => {
    const mode = MODES_SNAPSHOT.modes.find((candidate) => candidate.id === id);
    if (!mode) throw new Error(`no fixture mode ${id}`);
    return mode;
  }),
  revision: MODES_SNAPSHOT.revision + 1,
});

/* Command arguments cross the Tauri bridge as JSON, so JSON is their exact
 * value contract — the same one `tauri-mock` states for its responses. */
type CommandArgs = Record<string, JsonValue>;

interface Invocation {
  command: string;
  args: CommandArgs;
}

/**
 * Records every command the app invokes, with its arguments.
 *
 * Registered after the mock so it wraps the mock's `invoke` instead of being
 * overwritten by it: `addInitScript` runs in registration order.
 */
async function recordInvocations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // SAFETY: the Tauri globals are planted by the mock; Window does not
    // declare them, so an assertion is the only way to reach one.
    const tauri = window as Window & {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args?: CommandArgs) => Promise<JsonValue>;
      };
      __invocations?: Invocation[];
    };
    const calls: Invocation[] = [];
    tauri.__invocations = calls;
    const inner = tauri.__TAURI_INTERNALS__.invoke;
    tauri.__TAURI_INTERNALS__.invoke = (command, args) => {
      calls.push({ command, args: args ?? {} });
      return inner(command, args);
    };
  });
}

const invocations = (page: Page): Promise<Invocation[]> =>
  page.evaluate(() => {
    // SAFETY: planted by recordInvocations in the same page.
    const recorded = window as Window & { __invocations?: Invocation[] };
    return recorded.__invocations ?? [];
  });

/**
 * Samples one element's position or transform once per animation frame.
 *
 * The sampler runs in the page so no frame is lost to a round trip, and it is
 * installed before the interaction that starts the animation. Positions come
 * back as hundredths of a pixel so the samples stay comparable as strings.
 */
async function sampleFrames(
  page: Page,
  selector: string,
  read: "transform" | "x" | "y",
  frames: number,
): Promise<void> {
  await page.evaluate(
    ({ selector: sel, read: mode, frames: count }) => {
      const samples: string[] = [];
      // SAFETY: the sampler's own scratch slot on the page's window.
      const scratch = window as Window & { __samples?: string[] };
      scratch.__samples = samples;
      let remaining = count;
      const step = () => {
        const element = document.querySelector(sel);
        if (element) {
          const box = element.getBoundingClientRect();
          samples.push(
            mode === "transform"
              ? getComputedStyle(element).transform
              : String(Math.round((mode === "x" ? box.x : box.y) * 100)),
          );
        }
        remaining -= 1;
        if (remaining > 0) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    { selector, read, frames },
  );
}

const samples = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    // SAFETY: planted by sampleFrames in the same page.
    const scratch = window as Window & { __samples?: string[] };
    return scratch.__samples ?? [];
  });

/** The horizontal scale a `matrix(a, b, c, d, e, f)` transform applies. */
const scaleOf = (transform: string): number => {
  const matrix = transform.match(/matrix\(([^)]+)\)/);
  return matrix ? Number(matrix[1].split(",")[0]) : 1;
};

/** Distinct sampled positions strictly between two endpoints. */
const midwayStops = (
  raw: readonly string[],
  from: number,
  to: number,
): number => {
  const lo = Math.min(from, to) + 1;
  const hi = Math.max(from, to) - 1;
  return new Set(
    raw.map((value) => Number(value) / 100).filter((at) => at > lo && at < hi),
  ).size;
};

/**
 * Waits until Motion has finished with an element.
 *
 * Motion writes `transform: none` once a spring or a layout projection has
 * landed, and writes no transform at all when it had nothing to animate — the
 * reduced-motion case. Either is settled. Reading a position before it is the
 * mistake this helper exists to prevent: a mid-flight endpoint makes the
 * interval between the two endpoints too small to contain anything.
 */
const settled = async (page: Page, selector: string) => {
  await expect
    .poll(async () =>
      page.locator(selector).evaluate((el) => {
        // SAFETY: every selector here names an element Motion styles inline.
        const styled = el as HTMLElement;
        return styled.style.transform;
      }),
    )
    .toMatch(/^(none)?$/);
};

const openApp = async (page: Page, section: string) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: section, exact: true });
  await expect(button).toBeVisible();
  await button.click();
};

test.describe("command palette", () => {
  test("opens on a spring and settles centred at full size", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Modes", exact: true }),
    ).toBeVisible();

    await sampleFrames(page, ".command-palette", "transform", 45);
    await page.keyboard.press("Meta+k");

    const dialog = page.locator(".command-palette");
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () =>
        scaleOf(
          await dialog.evaluate((el) => getComputedStyle(el).transform),
        ).toFixed(3),
      )
      .toBe("1.000");

    const scales = (await samples(page)).map(scaleOf);
    /* A spring passes through the interval repeatedly. An instant open never
       appears in it, and a two-keyframe tween appears once. */
    const growing = new Set(scales.filter((scale) => scale > 0.9 && scale < 1));
    expect(growing.size).toBeGreaterThanOrEqual(3);

    /* Motion owns the transform now, so the centring translate has to survive
       composition with the scale or the palette lands half a width right. */
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(
      Math.abs(box!.x + box!.width / 2 - viewport!.width / 2),
    ).toBeLessThan(2);
  });

  test("filtering slides a surviving row into the gap", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Modes", exact: true }).waitFor();
    await page.keyboard.press("Meta+k");

    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThan(2);

    /* The last option survives a query built from its own label, and rows above
       it drop out, so it has somewhere to travel. Sampling by id follows the
       same element across the re-render. */
    const survivor = options.last();
    const id = await survivor.getAttribute("id");
    const label = ((await survivor.textContent()) ?? "").trim();
    expect(id).not.toBeNull();
    const startY = (await survivor.boundingBox())!.y;

    await sampleFrames(page, `[id="${id}"]`, "y", 60);
    await page.keyboard.type(label.slice(0, 5));

    const moved = page.locator(`[id="${id}"]`);
    await expect(moved).toBeVisible();
    await settled(page, `[id="${id}"]`);

    const endY = (await moved.boundingBox())!.y;
    expect(endY).not.toBe(startY);
    expect(
      midwayStops(await samples(page), startY, endY),
    ).toBeGreaterThanOrEqual(3);
  });

  test("Escape closes it and leaves the page interactive", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Modes", exact: true }).waitFor();

    await page.keyboard.press("Meta+k");
    await expect(page.locator(".command-palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".command-palette")).toHaveCount(0);

    /* The exit spring held the native modal open while it played, so the page
       underneath has to be reachable again once it is gone. */
    await page.getByRole("button", { name: "Modes", exact: true }).click();
    await expect(page.locator(".modes-list")).toBeVisible();
  });
});

test.describe("segmented tab indicator", () => {
  test("slides between segments as one element", async ({ page }) => {
    await installTauriMock(page);
    await openApp(page, "Library");

    const tabs = page.locator(SUBNAV).getByRole("tab");
    await expect(tabs.first()).toBeVisible();

    /* One mark on the strip, not one per segment: that is what makes it a
       shared layout element rather than two crossfading pseudo-elements. */
    await expect(page.locator(TAB_MARK)).toHaveCount(1);
    const from = await markX(page);

    await sampleFrames(page, TAB_MARK, "x", 45);
    await tabs.nth(1).click();

    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await settled(page, TAB_MARK);
    await expect(page.locator(TAB_MARK)).toHaveCount(1);

    const to = await markX(page);
    expect(to).not.toBe(from);
    expect(midwayStops(await samples(page), from, to)).toBeGreaterThanOrEqual(
      3,
    );

    /* And it lands on the segment, not near it: `inset-0` puts it on the
       segment's padding box, one border pixel in. */
    const segment = (await tabs.nth(1).boundingBox())!;
    expect(Math.abs(to - segment.x)).toBeLessThanOrEqual(1);
  });

  test("the mark follows keyboard selection too", async ({ page }) => {
    await installTauriMock(page);
    await openApp(page, "Library");

    const tabs = page.locator(SUBNAV).getByRole("tab");
    await expect(tabs.first()).toBeVisible();
    const before = await markX(page);

    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");

    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect.poll(async () => markX(page)).not.toBe(before);
  });
});

test.describe("mode list reorder", () => {
  const swapped = [MODE_IDS[1], MODE_IDS[0], ...MODE_IDS.slice(2)];

  /**
   * Drags the second row up past the first, in steps, and holds.
   *
   * `hover()` rather than a computed `mouse.move`: navigating to Modes runs a
   * view transition, and while one is playing the real DOM is replaced by
   * snapshot pseudo-elements, so a raw pointer press at the row's coordinates
   * lands on `<html>` and no gesture ever starts. Playwright's actionability
   * wait is what makes the press hit the row.
   */
  const dragSecondRowUp = async (page: Page) => {
    const row = page.locator(".modes-list-row").nth(1);
    await row.hover();
    const box = (await row.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.down();
    /* Past the halfway point of the row above, in steps, so Motion sees a real
       gesture with a velocity rather than one teleport. */
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(x, y - (box.height * step) / 8);
    }
  };

  const openModes = async (page: Page) => {
    await openApp(page, "Modes");
    const rows = page.locator(".modes-list-row");
    await expect(rows).toHaveCount(MODE_IDS.length);
    /* The draggable list is an async chunk, and this attribute only exists once
       it has landed — so waiting on it also proves the lazy boundary resolves
       and that the plain fallback was replaced. */
    await expect(rows.first()).toHaveAttribute("data-reorderable", "true");
    return rows;
  };

  test("dragging a row commits the new order to the backend", async ({
    page,
  }) => {
    await installTauriMock(page, {
      responses: { reorder_modes: reorderedSnapshot(swapped) },
    });
    await recordInvocations(page);
    await openModes(page);

    await dragSecondRowUp(page);
    /* The dragged row, not row 1: onReorder has already moved it. */
    await expect(page.locator(".modes-list-row[data-dragging]")).toHaveCount(1);
    await page.mouse.up();

    await expect
      .poll(async () =>
        (await invocations(page)).some(
          (call) => call.command === "reorder_modes",
        ),
      )
      .toBe(true);

    const call = (await invocations(page)).find(
      (entry) => entry.command === "reorder_modes",
    );
    expect(call?.args.orderedIds).toEqual(swapped);
    expect(call?.args.expectedRevision).toBe(MODES_SNAPSHOT.revision);
  });

  test("the committed order is the order the list then shows", async ({
    page,
  }) => {
    await installTauriMock(page, {
      responses: { reorder_modes: reorderedSnapshot(swapped) },
    });
    await openModes(page);

    await dragSecondRowUp(page);
    await page.mouse.up();

    await expect
      .poll(async () =>
        (await page.locator(".modes-list-name").first().textContent())?.trim(),
      )
      .toBe(MODES_SNAPSHOT.modes[1].name);
  });

  test("the keyboard route commits the same full order", async ({ page }) => {
    await installTauriMock(page, {
      responses: { reorder_modes: reorderedSnapshot(swapped) },
    });
    await recordInvocations(page);
    const rows = await openModes(page);

    await rows.nth(1).locator("summary").click();
    await page
      .getByRole("menuitem", { name: /move up/i })
      .first()
      .click();

    await expect
      .poll(
        async () =>
          (await invocations(page)).find(
            (entry) => entry.command === "reorder_modes",
          )?.args.orderedIds,
      )
      .toEqual(swapped);
  });

  test("held rows suppress the hover wash, and release restores it", async ({
    page,
  }) => {
    await installTauriMock(page, {
      responses: { reorder_modes: reorderedSnapshot(swapped) },
    });
    await openModes(page);

    await dragSecondRowUp(page);
    /* While a row is held the list suppresses every hover wash, because the
       pointer is not choosing the rows it passes over. */
    await expect(page.locator(".modes-list")).toHaveAttribute(
      "data-dragging",
      "true",
    );
    await page.mouse.up();
    await expect(page.locator(".modes-list")).not.toHaveAttribute(
      "data-dragging",
      "true",
    );
  });
});

test.describe("reduced motion", () => {
  /**
   * `page.emulateMedia`, not the `reducedMotion` fixture option: the fixture
   * did not reach `window.matchMedia` in this harness, which would have made
   * both assertions below pass for the wrong reason. The queries are asserted
   * first so the emulation can never go quiet again.
   */
  const emulateReduce = async (page: Page) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("button", { name: "Modes", exact: true }).waitFor();
    expect(
      await page.evaluate(
        () => window.matchMedia("(prefers-reduced-motion)").matches,
      ),
    ).toBe(true);
  };

  test("the palette appears at full size with no travel", async ({ page }) => {
    await installTauriMock(page);
    await emulateReduce(page);

    await sampleFrames(page, ".command-palette", "transform", 40);
    await page.keyboard.press("Meta+k");
    await expect(page.locator(".command-palette")).toBeVisible();
    /* The palette rests at translateX(-50%), not `none`, because Motion owns
       the centring translate too — so settling is read off the scale. */
    await expect
      .poll(async () =>
        scaleOf(
          await page
            .locator(".command-palette")
            .evaluate((el) => getComputedStyle(el).transform),
        ).toFixed(3),
      )
      .toBe("1.000");

    /* Motion resolves positional keys instantly for a device that asked to
       reduce motion, so the scale is never anywhere but 1. */
    const scales = (await samples(page)).map(scaleOf);
    expect(scales.filter((scale) => scale < 0.999)).toEqual([]);
  });

  test("the tab mark arrives without sliding", async ({ page }) => {
    await installTauriMock(page);
    await emulateReduce(page);
    await page.getByRole("button", { name: "Library", exact: true }).click();

    const tabs = page.locator(SUBNAV).getByRole("tab");
    await expect(tabs.first()).toBeVisible();
    const from = await markX(page);

    await sampleFrames(page, TAB_MARK, "x", 40);
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await settled(page, TAB_MARK);

    const to = await markX(page);
    expect(to).not.toBe(from);
    expect(midwayStops(await samples(page), from, to)).toBe(0);
  });
});
