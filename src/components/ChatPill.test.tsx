import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/vg/tooltip";
import { AppContent, type AppContentProps } from "@/App";
import { ChatPill } from "./ChatPill";

/* The shell's one standing affordance, and the three things about it that are
 * not allowed to drift: which states it has, what a press means, and where it
 * sits.
 *
 * The copy comes from the shipped en bundle rather than a fixture, so a missing
 * `chat.*` key fails here as a raw key in the markup instead of on a screen.
 * `renderToStaticMarkup` runs no effects and no events, which is why the press
 * is pinned against the exported verb with stubbed commands. */

const localeFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

// SAFETY: the en bundle is repo-owned and check:translations pins these keys;
// the narrow states the shape this test reads, not a guess about foreign data.
const en = JSON.parse(fs.readFileSync(localeFile, "utf8")) as {
  chat: Record<"open" | "label" | "unpaired", string>;
};

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeFile, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const paint = (node: React.ReactElement): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  );

const occurrences = (markup: string, needle: string): number =>
  markup.split(needle).length - 1;

const noop = () => undefined;

describe("the chat pill's three states", () => {
  test("enabled and paired: one live pill, named for the agent", () => {
    const markup = paint(
      <ChatPill enabled paired open={false} onOpen={noop} />,
    );

    expect(markup).toContain(`>${en.chat.open}</button>`);
    expect(markup).toContain(`aria-label="${en.chat.label}"`);
    expect(markup).not.toContain("aria-disabled");
    /* The sheet is a region this button shows and hides, so the button says
     * which state it is in rather than leaving the reader to infer it from a
     * strip that may be mid-slide. */
    expect(markup).toContain('aria-expanded="false"');
    // The shape: a pill on the raised surface inside a hairline, not a card.
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("border-gray-alpha-400");
    expect(markup).toContain("bg-raised");
    expect(markup).toContain("hover:bg-gray-alpha-100");
    // The kit's focus ring, not one of its own.
    expect(markup).toContain("focus-visible:ring-[3px]");
  });

  /* Open, the pill stays mounted solely for the shell-owned opacity transition.
   * It is inert and absent from the accessibility tree; the column's X remains
   * the one reachable control that closes the fold. */
  test("with the column showing: the fading pill is not reachable", () => {
    const markup = paint(<ChatPill enabled paired open onOpen={noop} />);

    expect(markup).toContain('data-slot="chat-pill"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("inert");
    expect(markup).toContain("pointer-events-none");
  });

  /* Unpaired is the state a first run is in: the agent is on, nothing would
   * answer a turn yet. The pill stays visible and inert — hiding it here would
   * make the fix undiscoverable — and the reason is the tooltip's, which is why
   * the sentence itself must not be printed into the pill. */
  test("unpaired: inert, still focusable, and the reason is a tooltip", () => {
    const markup = paint(
      <ChatPill enabled paired={false} open={false} onOpen={noop} />,
    );

    expect(markup).toContain('aria-disabled="true"');
    /* `asChild` puts the trigger's behaviour on the pill itself, so the pill
     * carries the tooltip's own state attribute rather than a wrapper — and it
     * is inert without ever taking `disabled`, which is what keeps it
     * focusable and so keeps the reason reachable by keyboard. */
    expect(markup).toContain('data-state="closed"');
    expect(markup).not.toMatch(/\sdisabled(=|\s|>)/);
    /* An inert pill claims no expanded state: it controls nothing. */
    expect(markup).not.toContain("aria-expanded");
    // Said once, in the tooltip, which is portalled and so not in this markup.
    expect(markup).not.toContain(en.chat.unpaired);
    // Dimmed type rather than opacity, like every disabled row in the app,
    // and no hover wash on something that does nothing.
    expect(markup).toContain("text-gray-800");
    expect(markup).not.toContain("opacity-");
    expect(markup).not.toContain("hover:bg-gray-alpha-100");
  });

  test("disabled by setting: no pill at all, not a dimmed one", () => {
    expect(
      paint(<ChatPill enabled={false} paired open={false} onOpen={noop} />),
    ).toBe("");
    expect(
      paint(
        <ChatPill enabled={false} paired={false} open={false} onOpen={noop} />,
      ),
    ).toBe("");
  });
});

describe("the aurora glyph", () => {
  /* Three arcs of one ring, one theme variable each, and nothing that moves:
   * the wash on Capture is the surface allowed to animate, and the tokens are
   * the only place these hues are written down. */
  test("is a static stroked ring in the three aurora tokens", () => {
    const markup = paint(
      <ChatPill enabled paired open={false} onOpen={noop} />,
    );

    for (const hue of ["--aurora-blue", "--aurora-cyan", "--aurora-violet"]) {
      expect(occurrences(markup, `stroke:var(${hue})`)).toBe(1);
    }
    expect(occurrences(markup, "<circle")).toBe(3);
    expect(markup).toContain('viewBox="0 0 14 14"');
    expect(markup).toContain('fill="none"');
    // A ring of three equal arcs: one third drawn, two thirds skipped.
    expect(markup).toContain('stroke-dasharray="13.09 26.18"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("animate");
    expect(markup).not.toContain("gradient");
  });
});

/* What a press means, now that it means one thing.
 *
 * The pill used to read the backend to decide whether to open or close a
 * second window, and then it was a toggle over the shell's own boolean. It is
 * a door now: it is only reachable while the column is closed, so a press only
 * ever opens, and closing belongs to the column's X and to Escape. What is
 * worth pinning is that the press reaches the shell at all, and that an
 * unpaired pill's press does not. `renderToStaticMarkup` runs no events, so
 * that is asserted through the handler the markup does or does not carry. */
describe("what a press means", () => {
  const hasHandler = (markup: string): boolean =>
    markup.includes('aria-disabled="true"') === false;

  test("a paired pill is wired to the shell's opener", () => {
    expect(
      hasHandler(paint(<ChatPill enabled paired open={false} onOpen={noop} />)),
    ).toBe(true);
  });

  test("an unpaired pill carries no press at all", () => {
    expect(
      hasHandler(
        paint(<ChatPill enabled paired={false} open={false} onOpen={noop} />),
      ),
    ).toBe(false);
  });
});

/* Where it sits, at the level that decides it.
 *
 * The pill is mounted once by the shell, inside the content pane and above the
 * pane's scroll owner. Both halves of that matter: inside the scroll owner it
 * would scroll away with the page, and mounted per route it would be twelve
 * pills with twelve chances to disagree. Neither is visible from the component
 * itself, so the shell is rendered here.
 *
 * The shell drags in the sidebar, which reads the OS off Tauri's window
 * globals, so a `window` has to exist for the length of this render — and only
 * for that length. Motion decides whether a render is a client render by
 * whether `window` existed when it was imported, so a global left standing at
 * module scope changes how other suites render in the same process. */
const shell = (
  section: AppContentProps["currentSection"],
  agentPanel: AppContentProps["agentPanel"] = {
    enabled: true,
    paired: true,
    remoteIntelligence: true,
  },
  /** The rail measures its traffic-light clearance from this; the pane's drag
   * band is not allowed to. */
  osType: "macos" | "windows" = "macos",
  chatOpen = false,
): string => {
  const restore = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_OS_PLUGIN_INTERNALS__: { os_type: osType } },
  });
  try {
    return paint(
      <AppContent
        onboardingStep="done"
        onAccessibilityComplete={() => undefined}
        onModelSelected={() => undefined}
        direction="ltr"
        currentSection={section}
        onSectionChange={() => undefined}
        onOpenMeeting={() => undefined}
        loadingLabel="Loading"
        meetingInvalidation={0}
        meetingNavigationRequest={null}
        meetingStartRequest={0}
        personRequest={null}
        commandOpen={false}
        commandActions={[]}
        commandSeed={null}
        agentPanel={agentPanel}
        chatOpen={chatOpen}
        onChatOpenChange={() => undefined}
        onCommandOpenChange={() => undefined}
        onCommandOpen={() => undefined}
      />,
    );
  } finally {
    if (restore) Object.defineProperty(globalThis, "window", restore);
    else Reflect.deleteProperty(globalThis, "window");
  }
};

describe("the shell's corner", () => {
  test("one pill per window, on every route, outside the scroll owner", () => {
    for (const section of ["overview", "settings"] as const) {
      const markup = shell(section);
      const pill = markup.indexOf('data-slot="chat-pill"');
      const scroll = markup.indexOf('data-slot="page-scroll"');

      expect(occurrences(markup, 'data-slot="chat-pill"')).toBe(1);
      expect(pill).toBeGreaterThan(markup.indexOf("<main"));
      // Before the scroll owner opens is the one place it cannot be inside it.
      expect(pill).toBeLessThan(scroll);
    }
  });

  test("the pane it is measured against is the positioned one", () => {
    const markup = shell("overview");
    const main = /<main class="([^"]*)"/.exec(markup)?.[1] ?? "";

    expect(main).toContain("relative");
    expect(markup).toContain("absolute top-[7px] end-[28px]");
  });

  /* The pill's band is the 42px every page leaves above its first heading. The
   * banner strip is the one thing in the pane that could grow into it, so it
   * starts where page content starts rather than 14px higher. */
  test("the banner strip starts below the pill's band", () => {
    expect(shell("overview")).toContain("pt-12");
  });

  test("the setting still decides whether the corner is used", () => {
    const markup = shell("overview", {
      enabled: false,
      paired: false,
      remoteIntelligence: false,
    });

    expect(markup).not.toContain('data-slot="chat-pill"');
  });
});

/* The shell's three columns, which is what "the chat is part of the window"
 * comes down to.
 *
 * The window is a fixed 900x800 (src-tauri/src/lib.rs) and nothing in the app
 * resizes it, so the chat's 340 has to come out of the two columns already
 * there: the rail gives up its words for 48 and the page keeps 512. The
 * arithmetic belongs to the shell rather than to any one of the three, which
 * is why all three are read here. */
describe("the shell's three columns", () => {
  test("closed: the named rail, the full page, and a column 0 wide", () => {
    const markup = shell("overview");

    expect(markup).toContain("w-[220px]");
    expect(markup).not.toContain("w-[48px]");
    /* Mounted so it has somewhere to open from, and taking no width until it
     * does — the page is the full pane, exactly as it was before any of this. */
    expect(occurrences(markup, 'data-slot="chat-sheet"')).toBe(1);
    expect(markup).toContain("pointer-events-none w-0");
  });

  test("open: rail 48, page between, chat 340 — in that order", () => {
    const markup = shell("overview", undefined, "macos", true);
    const rail = markup.indexOf('data-slot="sidebar"');
    const pane = markup.indexOf("<main");
    const column = markup.indexOf('data-slot="chat-sheet"');

    expect(markup).toContain("w-[48px]");
    expect(markup).not.toContain("w-[220px]");
    expect(markup).toContain("w-[340px]");
    // Source order is column order: rail, then pane, then chat.
    expect(rail).toBeLessThan(pane);
    expect(pane).toBeLessThan(column);
    /* Beside the pane and not inside it. A column that opens before `</main>`
     * is a column whose width was never taken off the page, which is a page
     * underneath the chat rather than next to it — the whole regression this
     * cutover is about. */
    expect(column).toBeGreaterThan(markup.indexOf("</main>"));
  });

  test("open: one inert pill fades while one X owns the closing", () => {
    const markup = shell("overview", undefined, "macos", true);

    expect(occurrences(markup, 'data-slot="chat-pill"')).toBe(1);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("pointer-events-none");
    expect(occurrences(markup, 'data-slot="chat-close"')).toBe(1);
  });

  /* An agent switched off has no column, so there is nothing for the rail to
   * make room for and nothing to narrow the page for. */
  test("switched off, an open fold narrows nothing", () => {
    const markup = shell(
      "overview",
      { enabled: false, paired: false, remoteIntelligence: false },
      "macos",
      true,
    );

    expect(markup).toContain("w-[220px]");
    expect(markup).not.toContain("w-[48px]");
    expect(markup).toContain("pointer-events-none w-0");
  });

  /* The pane's own handle is not the chat's: the drag band is 512 wide with the
   * column open, and it is still the pane's full width, because the column is
   * beside the pane rather than over part of it. */
  test("open: the pane keeps one full-width drag band", () => {
    const markup = shell("overview", undefined, "macos", true);

    expect(occurrences(markup, 'data-slot="drag-band"')).toBe(1);
    expect(markup).toContain("absolute inset-x-0 top-0 z-0 h-12");
  });
});

/* The band the pill sits in is also the window's handle, which is why it is
 * pinned in the same file: the two share 42px of chrome and one hit-test
 * order, and the pill is the interactive thing inside a drag region that a
 * drag region would be most likely to swallow.
 *
 * The mechanism itself is Tauri's: a mousedown whose target carries
 * `data-tauri-drag-region` invokes `plugin:window|start_dragging`, which
 * `core:window:allow-start-dragging` in capabilities/default.json permits.
 * Nothing else in the pane claims a pixel of the band, so if the attribute
 * leaves this strip the window stops moving — the regression these tests
 * exist for. */
describe("the pane's drag band", () => {
  const openTag = (markup: string, slot: string): string =>
    new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`).exec(markup)?.[0] ?? "";

  test("the strip carries the drag region on every route", () => {
    for (const section of ["overview", "settings"] as const) {
      const markup = shell(section);
      const band = openTag(markup, "drag-band");

      expect(occurrences(markup, 'data-slot="drag-band"')).toBe(1);
      expect(band).toContain("data-tauri-drag-region");
      // The pane's own top band: full width, page-content height, behind the
      // pill. A strip that stops being those is a strip nobody can grab.
      expect(band).toContain("absolute inset-x-0 top-0 z-0 h-12");
      // Inside the pane and above its scroll owner, so it neither scrolls
      // away nor lands twelve times.
      const index = markup.indexOf('data-slot="drag-band"');
      expect(index).toBeGreaterThan(markup.indexOf("<main"));
      expect(index).toBeLessThan(markup.indexOf('data-slot="page-scroll"'));
    }
  });

  /* The pill is a button in the middle of a drag region's band. Tauri would
   * hand a bare-attribute strip the drag only when the strip is the mousedown
   * target itself, and the pill outranks it anyway — but an attribute copied
   * onto the pill would make the one interactive thing up there drag the
   * window instead of opening the agent. */
  test("the pill does not carry it", () => {
    const markup = shell("overview");
    const pill = openTag(markup, "chat-pill");

    expect(pill).toContain("<button");
    expect(pill).not.toContain("data-tauri-drag-region");
    expect(pill).toContain("z-10");
  });

  /* The rail's clearance is platform-shaped; the pane's handle is not. A drag
   * region is inert where the native title bar survives, so gating it would
   * buy a branch and lose nothing. */
  test("it is unconditional, not macOS-only", () => {
    const band = openTag(shell("overview", undefined, "windows"), "drag-band");

    expect(band).toContain("data-tauri-drag-region");
  });

  /* Turning the agent off removes the pill. It must not remove the handle. */
  test("it survives the pill being switched off", () => {
    const markup = shell("overview", {
      enabled: false,
      paired: false,
      remoteIntelligence: false,
    });

    expect(openTag(markup, "drag-band")).toContain("data-tauri-drag-region");
  });
});
