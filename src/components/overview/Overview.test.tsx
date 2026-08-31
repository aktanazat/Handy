import { afterAll, describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/vg/tooltip";
import { CaptureHero, Overview, type CaptureHeroProps } from "./Overview";

/* Capture's whole contract: one hero card, and nothing else on the page.
 *
 * Every assertion here is either the hero's own content — the state word, the
 * chord drawn exactly once, the two actions and the promise attached to the
 * first of them — or a guard against a deleted surface coming back. Keys
 * resolve through the real English bundle, so a pruned key shows up here as a
 * missing sentence rather than as a silent inline default.
 *
 * The chord states are rendered through `CaptureHero` rather than through the
 * page, because the page reads its settings from a zustand store and zustand
 * answers a server render with the store's *initial* state. So `Overview` can
 * only ever be statically rendered as its first paint — which is exactly what
 * the page-level block below asserts, and no place to put a bound chord. */

const localeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

/* @tauri-apps/plugin-os reads its platform off a window global the Tauri
 * runtime injects, and the keycaps are macOS glyphs because of it. Static
 * rendering has no window, so without this the hero throws before it can be
 * inspected. Nothing else is needed: `renderToStaticMarkup` runs no effect, so
 * the page reaches no command.
 *
 * Installed at module scope (a module-scope render below needs it at import
 * time) and RESTORED in afterAll: a leaked bare `window` makes every later
 * test file in the same process believe it is in a browser — framer-motion
 * then initialises its reduced-motion listener against a window with no
 * `matchMedia` and pins the device preference to false, which broke
 * motion.test.tsx only in full-suite order. */
const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { __TAURI_OS_PLUGIN_INTERNALS__: { os_type: "macos" } },
});
afterAll(() => {
  if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeRoot, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

/* The tooltip provider is the one the route root mounts, so a render without
 * it is a render the app never performs — Radix's tooltip refuses to mount
 * outside a provider. */
const render = (node: React.ReactElement): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  );

const occurrences = (markup: string, needle: string): number =>
  markup.split(needle).length - 1;

const hero = (overrides: Partial<CaptureHeroProps> = {}): string =>
  render(
    <CaptureHero
      isRecording={false}
      binding="option_left+space"
      pushToTalk={true}
      importing={false}
      onNewMeeting={() => {}}
      onImportAudio={() => {}}
      onChangeShortcut={() => {}}
      {...overrides}
    />,
  );

describe("the Capture hero", () => {
  test("names the state the app is in, and nothing repeats it", () => {
    const markup = hero();

    expect(markup).toContain('id="overview-status"');
    expect(markup).toContain("Ready");
    expect(markup).toContain('aria-live="polite"');
    /* Not recording: the attribute is absent rather than false, and the word is
     * the page's whole answer — no second indicator restating it. */
    expect(markup.includes("data-recording")).toBe(false);
    /* Written in px on purpose: `:root { font-size: 14px }` makes `text-2xl`
     * 21px here, which would leave the app's default route with a smaller
     * headline than every other page's h1 (settings/rows.tsx uses 24px). */
    expect(markup).toContain("text-[24px]");
    expect(markup.includes("text-2xl")).toBe(false);
  });

  test("switches the state word while the backend is recording", () => {
    const markup = hero({ isRecording: true });

    expect(markup).toContain("Listening");
    expect(markup).toContain('data-recording="true"');
    expect(markup.includes(">Ready<")).toBe(false);
  });

  test("draws the bound chord exactly once, with its gesture", () => {
    const markup = hero();

    /* The macOS glyph is in the keycaps and nowhere else; the spelled-out form
     * is the button's title, one hover away. */
    expect(occurrences(markup, "\u2325")).toBe(1);
    expect(occurrences(markup, "<kbd")).toBe(2);
    expect(markup).toContain(">Space</kbd>");
    expect(markup).toContain('title="Left Option + Space"');
    expect(occurrences(markup, "tap to toggle \u00b7 hold to talk")).toBe(1);
    expect(occurrences(markup, 'data-testid="overview-shortcut"')).toBe(1);
    expect(markup).toContain('aria-label="Change dictation shortcut"');
  });

  test("stops claiming a hold when push-to-talk is off", () => {
    const markup = hero({ pushToTalk: false });

    expect(occurrences(markup, "tap to toggle")).toBe(1);
    expect(markup.includes("hold to talk")).toBe(false);
  });

  test("offers to bind a chord instead of drawing empty keycaps", () => {
    const markup = hero({ binding: null });

    expect(markup).toContain("Set a shortcut");
    expect(occurrences(markup, 'data-testid="overview-shortcut"')).toBe(1);
    expect(markup.includes("<kbd")).toBe(false);
    expect(markup.includes("tap to toggle")).toBe(false);
  });

  test("carries both actions, with the promise wired to the one it is about", () => {
    const markup = hero();

    expect(markup).toContain("New meeting");
    expect(markup).toContain("Import audio");
    /* What is assertable here is the WIRING: New meeting is the tooltip's
     * trigger. The sentence itself is not, and must not be — a closed Radix
     * tooltip renders nothing, so the only way to see the copy in a static
     * render would be to keep a second permanent copy of it in the markup,
     * which is production code existing for a test. Radix opens the tooltip on
     * focus and describes the trigger from the content, so the promise reaches
     * keyboard and screen-reader users through the primitive. */
    expect(markup).toContain('data-slot="tooltip-trigger"');
    expect(markup.includes("Nothing joins the call.")).toBe(false);
    expect(markup.includes("aria-describedby")).toBe(false);
  });

  /* Regression, caught by rendering the compiled sheet: a shadcn `ghost` button
   * has no border and no fill at rest, so both of these read as prose — "Import
   * audio" as a caption beside New meeting, "Set a shortcut" as a sentence
   * fragment where it is the only control that fixes an unbound install. Every
   * secondary control on this card is bordered. */
  test("draws its secondary controls as buttons, never as borderless ghosts", () => {
    for (const markup of [hero(), hero({ binding: null })]) {
      expect(markup.includes('data-variant="ghost"')).toBe(false);
    }
    expect(occurrences(hero(), 'data-variant="outline"')).toBe(1);
    expect(occurrences(hero({ binding: null }), 'data-variant="outline"')).toBe(
      2,
    );
  });

  test("locks the import action while its dialog is open", () => {
    expect(hero({ importing: true })).toContain('disabled=""');
    expect(hero().includes('disabled=""')).toBe(false);
  });

  test("is one flat Geist card", () => {
    const markup = hero();
    /* The card's own attributes, not its contents: vg's bordered button ships a
     * hairline shadow of its own, and that is the kit's business. What must
     * stay flat is this page surface. */
    const card = markup.slice(0, markup.indexOf(">") + 1);

    expect(card).toContain("rounded-card");
    expect(card).toContain("border-gray-alpha-400");
    expect(card).toContain("bg-background-100");
    expect(card).toContain('aria-labelledby="overview-status"');
    expect(card.includes("shadow")).toBe(false);
    /* Geist never nests a card inside a card. */
    expect(occurrences(markup, "<section")).toBe(1);
    expect(occurrences(markup, "rounded-card")).toBe(1);
  });
});

/* The kill list, as assertions. Each deleted surface said something another
 * page already says — the sidebar chip, the Library's cards, the Library's
 * list — and the page column is one hero wide precisely because none of them
 * may come back to it. */
describe("the Capture page", () => {
  const markup = render(<Overview />);

  test("is one placed, narrow, vertically centered column", () => {
    expect(markup).toContain("max-w-[560px]");
    expect(markup).toContain("mx-auto");
    expect(markup).toContain("min-h-full");
    expect(markup).toContain("justify-center");
    expect(occurrences(markup, "<section")).toBe(1);
  });

  test("draws no instrument strip", () => {
    expect(markup.includes("Capture instrument")).toBe(false);
    expect(markup.includes("data-cell=")).toBe(false);
    expect(markup.includes(">Engine</dt>")).toBe(false);
    expect(markup.includes("not measured")).toBe(false);
  });

  test("draws no activity header, stat cards or chart", () => {
    expect(markup.includes("Activity")).toBe(false);
    expect(markup.includes("Usage summary")).toBe(false);
    expect(markup.includes("all time")).toBe(false);
    expect(markup.includes("Current streak")).toBe(false);
    expect(markup.includes("Dictations per day")).toBe(false);
    // Only the two action glyphs remain; a chart would add another SVG.
    expect(occurrences(markup, "<svg")).toBe(2);
  });

  test("draws no recent activity list and no empty-state pitch", () => {
    expect(markup.includes("Recent activity")).toBe(false);
    expect(markup.includes("See all")).toBe(false);
    expect(markup.includes("No captures yet")).toBe(false);
    expect(markup.includes("Open Library")).toBe(false);
  });

  test("has no page-local stylesheet classes and no legacy page shell", () => {
    /* overview.css is deleted; Tailwind utilities are the only styling left. */
    expect(markup.includes("ov-")).toBe(false);
    expect(markup.includes("settings-page")).toBe(false);
    expect(markup.includes("type-display")).toBe(false);
    expect(markup.includes("snap-measured")).toBe(false);
  });

  test("shows no update notice before the check has answered", () => {
    expect(markup.includes("is available. This install is on")).toBe(false);
    expect(markup.includes("Could not check for updates")).toBe(false);
  });
});
