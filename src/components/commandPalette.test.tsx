import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { destinationIcons } from "@/lib/navIcons";
import {
  commandActionIcons,
  groupPaletteActions,
  isCommandPaletteChord,
  type CommandPaletteAction,
} from "./commandPaletteActions";
import {
  buildNavigationActions,
  RAIL_SECTIONS,
  SECTION_ORDER,
  SECTIONS_CONFIG,
} from "./sidebarSections";
import { Sidebar } from "./Sidebar";

/* The shell's standing proof.
 *
 * There is no DOM in this suite — every component test in this repo renders to
 * static markup — so the palette itself is not here: it is a Radix dialog and
 * portals to a document that does not exist. What is here is the pair of pure
 * rules the palette is built on, and the sidebar's rendered markup. */

const localeFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeFile, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

/** One keydown, as the four fields the predicate reads. */
const chord = (
  overrides: Partial<Parameters<typeof isCommandPaletteChord>[0]> = {},
) => ({ key: "k", metaKey: true, ctrlKey: false, repeat: false, ...overrides });

describe("the palette chord", () => {
  test("Cmd+K and Ctrl+K both summon it", () => {
    expect(isCommandPaletteChord(chord())).toBe(true);
    expect(
      isCommandPaletteChord(chord({ metaKey: false, ctrlKey: true })),
    ).toBe(true);
  });

  /* The flicker, stated as a rule. The chord toggles, so every keydown the
   * listener accepts is one open-or-close. A held key repeats keydown at the
   * OS repeat rate, which is why holding it used to strobe the palette rather
   * than leave it open — and why an accepted repeat is a bug, not a nicety. */
  test("an auto-repeat is not a second press", () => {
    expect(isCommandPaletteChord(chord({ repeat: true }))).toBe(false);
    expect(
      isCommandPaletteChord(
        chord({ metaKey: false, ctrlKey: true, repeat: true }),
      ),
    ).toBe(false);
  });

  test("the modifier is required and the letter is not case-sensitive", () => {
    expect(isCommandPaletteChord(chord({ key: "K" }))).toBe(true);
    expect(isCommandPaletteChord(chord({ metaKey: false }))).toBe(false);
    expect(isCommandPaletteChord(chord({ key: "j" }))).toBe(false);
    expect(isCommandPaletteChord(chord({ key: "Escape" }))).toBe(false);
  });
});

const action = (
  id: string,
  group: CommandPaletteAction["group"],
): CommandPaletteAction => ({
  id,
  group,
  label: id,
  icon: commandActionIcons.openRecordings,
  run: () => undefined,
});

describe("palette grouping", () => {
  test("destinations come before verbs, whatever order the registry is in", () => {
    const grouped = groupPaletteActions([
      action("run-thing", "actions"),
      action("go-somewhere", "navigation"),
    ]);
    expect(grouped.map((section) => section.group)).toEqual([
      "navigation",
      "actions",
    ]);
    expect(grouped[0].items.map((item) => item.id)).toEqual(["go-somewhere"]);
    expect(grouped[1].items.map((item) => item.id)).toEqual(["run-thing"]);
  });

  test("a group nothing contributed to is not rendered at all", () => {
    const grouped = groupPaletteActions([action("go-somewhere", "navigation")]);
    expect(grouped.map((section) => section.group)).toEqual(["navigation"]);
  });

  test("every action survives grouping exactly once", () => {
    const actions = [
      action("a", "navigation"),
      action("b", "actions"),
      action("c", "navigation"),
    ];
    expect(
      groupPaletteActions(actions).flatMap((section) =>
        section.items.map((item) => item.id),
      ),
    ).toEqual(["a", "c", "b"]);
  });
});

/* One registry, two surfaces. The rail and the palette used to hold their own
 * copies of these destinations, plus a third copy in the section registry that
 * nothing read and that had gone stale, still calling these two "Overview" and
 * "History" for the places that ship as "Capture" and "Library". These tests
 * pin the derivation itself, not a second transcription of the list: what they
 * hard-code is the shipped names and order a reader can check against the app. */
describe("the section registry", () => {
  test("is the palette's destination list, in its own order", () => {
    const actions = buildNavigationActions(
      (key) => i18n.t(key),
      () => undefined,
    );

    expect(actions.map((item) => item.id)).toEqual([
      "nav-overview",
      "nav-history",
      "nav-modes",
      "nav-meetings",
      "nav-people",
      "nav-settings",
      "nav-models",
    ]);
    expect(actions.map((item) => item.label)).toEqual([
      "Capture",
      "Library",
      "Modes",
      "Meetings",
      "People",
      "Settings",
      "Models",
    ]);
    // Every destination is a destination; none of them is a verb.
    expect(actions.every((item) => item.group === "navigation")).toBe(true);
  });

  /* Models is the only destination with no rail row, and it lands last in the
   * palette because the registry lists it last: the palette's order is the
   * registry's order, not a sort. */
  test("the rail is the registry minus the palette-only destinations", () => {
    expect(RAIL_SECTIONS).toEqual([
      "overview",
      "history",
      "modes",
      "meetings",
      "people",
      "settings",
    ]);
    expect(
      SECTION_ORDER.filter((section) => !RAIL_SECTIONS.includes(section)),
    ).toEqual(["models"]);
    expect(SECTION_ORDER[SECTION_ORDER.length - 1]).toBe("models");
  });

  /* The stale-name failure, as a rule: the two destinations the rail renamed
   * must not carry the registry's old keys, and those keys must be gone from the
   * bundle entirely so nothing can quietly resolve them again. */
  test("no destination answers to two names", () => {
    const railLabels = RAIL_SECTIONS.map((section) =>
      i18n.t(SECTIONS_CONFIG[section].labelKey),
    );
    const paletteLabels = buildNavigationActions(
      (key) => i18n.t(key),
      () => undefined,
    ).map((item) => item.label);

    expect(paletteLabels.slice(0, railLabels.length)).toEqual(railLabels);
    expect(railLabels).not.toContain("Overview");
    expect(railLabels).not.toContain("History");
    expect(i18n.exists("sidebar.overview")).toBe(false);
    expect(i18n.exists("sidebar.history")).toBe(false);
  });

  /* One glyph per concept. Both navigation surfaces resolve this same map, so
   * a destination cannot drift to a second icon in one of them. */
  test("every destination names a distinct shared glyph", () => {
    const icons = SECTION_ORDER.map((section) => destinationIcons[section]);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

/* `useOsType` reads the Tauri OS plugin's global during render, and there is
 * no DOM here, so the global is planted for exactly the synchronous render
 * that needs it and then put back.
 *
 * Module scope would be the obvious place and is the wrong one: Motion decides
 * whether a render is a client render by whether `window` existed when it was
 * imported, so a global left standing here changes how lib/motion's own suite
 * renders in the same process. It did, measurably, before this was scoped. */
const renderSidebar = (activeSection: "overview" | "meetings" = "overview") => {
  const restore = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_OS_PLUGIN_INTERNALS__: { os_type: "macos" } },
  });
  try {
    return renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <Sidebar
          activeSection={activeSection}
          onSectionChange={() => undefined}
          onOpenCommand={() => undefined}
        />
      </I18nextProvider>,
    );
  } finally {
    if (restore) Object.defineProperty(globalThis, "window", restore);
    else Reflect.deleteProperty(globalThis, "window");
  }
};

describe("Sidebar", () => {
  test("every destination is a button, in the fixed order", () => {
    const markup = renderSidebar();
    const labels = [...markup.matchAll(/>([A-Za-z ]+)<\/button>/g)].map(
      (match) => match[1],
    );
    expect(labels).toEqual([
      "Capture",
      "Library",
      "Modes",
      "Meetings",
      "People",
      "Settings",
    ]);
  });

  /* aria-current is the selection; the styling hangs off it rather than off a
   * second class, so asserting the attribute also pins the appearance. */
  test("aria-current names exactly one route", () => {
    const markup = renderSidebar("meetings");
    expect([...markup.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    expect(markup).toContain('aria-current="page" class=');
    expect(markup).toMatch(/aria-current="page"[^>]*>.*?Meetings<\/button>/);
  });

  test("the search row is a button that names the palette and shows its chord", () => {
    const markup = renderSidebar();
    expect(markup).toContain('aria-label="Search"');
    // One chip spelling the whole chord, matching the reference product's
    // search affordance — not two caps with a seam between them.
    expect(markup).toContain("\u2318 K</kbd>");
    expect([...markup.matchAll(/<kbd/g)]).toHaveLength(1);
  });

  /* The rail is Geist tokens now, not hand-rolled CSS: no `app-sidebar*` class
   * survives, so a rule left behind in a stylesheet cannot quietly restyle it.
   * The tokens themselves are asserted because they are the contract — page
   * surface on the rail, alpha-grey wash on hover, blue only on focus. */
  test("carries Geist utilities and no legacy shell classes", () => {
    const markup = renderSidebar();
    expect(markup).not.toContain("app-sidebar");
    expect(markup).toContain("bg-background-200");
    expect(markup).toContain("border-gray-alpha-400");
    expect(markup).toContain("hover:bg-gray-alpha-100");
    expect(markup).toContain("aria-[current=page]:bg-gray-alpha-200");
    expect(markup).toContain("focus-visible:ring-blue-700");
    // Violet is dead, and so is every accent-soft fill it used to tint.
    expect(markup).not.toContain("violet");
    expect(markup).not.toContain("accent-soft");
  });
});
