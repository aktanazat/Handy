import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/vg/tooltip";
import { commands, type AgentPanelStatusV1 } from "@/bindings";
import { AppContent, type AppContentProps } from "@/App";
import { ChatPill, toggleAgentPanel } from "./ChatPill";

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

describe("the chat pill's three states", () => {
  test("enabled and paired: one live pill, named for the agent", () => {
    const markup = paint(<ChatPill enabled paired />);

    expect(markup).toContain(`>${en.chat.open}</button>`);
    expect(markup).toContain(`aria-label="${en.chat.label}"`);
    expect(markup).not.toContain("aria-disabled");
    // The shape: a pill on the raised surface inside a hairline, not a card.
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("border-gray-alpha-400");
    expect(markup).toContain("bg-raised");
    expect(markup).toContain("hover:bg-gray-alpha-100");
    // The kit's focus ring, not one of its own.
    expect(markup).toContain("focus-visible:ring-[3px]");
  });

  /* Unpaired is the state a first run is in: the panel is on, nothing would
   * answer a turn yet. The pill stays visible and inert — hiding it here would
   * make the fix undiscoverable — and the reason is the tooltip's, which is why
   * the sentence itself must not be printed into the pill. */
  test("unpaired: inert, still focusable, and the reason is a tooltip", () => {
    const markup = paint(<ChatPill enabled paired={false} />);

    expect(markup).toContain('aria-disabled="true"');
    /* `asChild` puts the trigger's behaviour on the pill itself, so the pill
     * carries the tooltip's own state attribute rather than a wrapper — and it
     * is inert without ever taking `disabled`, which is what keeps it
     * focusable and so keeps the reason reachable by keyboard. */
    expect(markup).toContain('data-state="closed"');
    expect(markup).not.toMatch(/\sdisabled(=|\s|>)/);
    // Said once, in the tooltip, which is portalled and so not in this markup.
    expect(markup).not.toContain(en.chat.unpaired);
    // Dimmed type rather than opacity, like every disabled row in the app,
    // and no hover wash on something that does nothing.
    expect(markup).toContain("text-gray-800");
    expect(markup).not.toContain("opacity-");
    expect(markup).not.toContain("hover:bg-gray-alpha-100");
  });

  test("disabled by setting: no pill at all, not a dimmed one", () => {
    expect(paint(<ChatPill enabled={false} paired />)).toBe("");
    expect(paint(<ChatPill enabled={false} paired={false} />)).toBe("");
  });
});

describe("the aurora glyph", () => {
  /* Three arcs of one ring, one theme variable each, and nothing that moves:
   * the wash on Capture is the surface allowed to animate, and the tokens are
   * the only place these hues are written down. */
  test("is a static stroked ring in the three aurora tokens", () => {
    const markup = paint(<ChatPill enabled paired />);

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

const PANEL_STATUS: AgentPanelStatusV1 = {
  invalidation_id: 1,
  relay_status: "ready",
  panel_open: false,
  conversation: [],
  turn: null,
  proposal: null,
  geometry: null,
};

const label = (key: string): string => key;

/* The press, against the panel's own commands. The status read is what decides
 * the verb, so a panel that is already open must be closed rather than opened
 * a second time. */
describe("what a press means", () => {
  const withStubbedPanel = async (
    panelOpen: boolean,
    run: () => Promise<void>,
  ): Promise<string[]> => {
    const original = {
      status: commands.agentPanelStatus,
      open: commands.agentPanelOpen,
      close: commands.agentPanelClose,
    };
    const calls: string[] = [];
    commands.agentPanelStatus = async () => {
      calls.push("status");
      return {
        status: "ok",
        data: { ...PANEL_STATUS, panel_open: panelOpen },
      };
    };
    commands.agentPanelOpen = async () => {
      calls.push("open");
      return { status: "ok", data: PANEL_STATUS };
    };
    commands.agentPanelClose = async () => {
      calls.push("close");
      return { status: "ok", data: PANEL_STATUS };
    };
    try {
      await run();
    } finally {
      commands.agentPanelStatus = original.status;
      commands.agentPanelOpen = original.open;
      commands.agentPanelClose = original.close;
    }
    return calls;
  };

  test("a closed panel is opened", async () => {
    const calls = await withStubbedPanel(false, () =>
      // SAFETY: the stub resolves only chat.* keys, the sole lookups the
      // toggle performs; a full TFunction here would test i18next, not us.
      toggleAgentPanel(label as never),
    );
    expect(calls).toEqual(["status", "open"]);
  });

  test("an open panel is closed, not opened again", async () => {
    const calls = await withStubbedPanel(true, () =>
      // SAFETY: same single-key stub as the open case above.
      toggleAgentPanel(label as never),
    );
    expect(calls).toEqual(["status", "close"]);
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
  agentPanel: AppContentProps["agentPanel"] = { enabled: true, paired: true },
): string => {
  const restore = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_OS_PLUGIN_INTERNALS__: { os_type: "macos" } },
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
    const markup = shell("overview", { enabled: false, paired: false });

    expect(markup).not.toContain('data-slot="chat-pill"');
  });
});
