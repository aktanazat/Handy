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
import {
  askSona,
  ASK_VALUE,
  canAsk,
  groupQueryRows,
  openRow,
  paletteFilter,
  resultHeadingKeys,
  resultIcons,
  RESULT_KINDS,
  rowValue,
  searchCorpus,
  SEARCH_LIMIT,
} from "./commandPaletteSearch";
import {
  commands,
  type AgentPanelSendTurnRequestV1,
  type AgentPanelStatusV1,
  type QueryRow,
} from "@/bindings";

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

  /* Modes and Models are the destinations with no rail row, and Models lands
   * last in the palette because the registry lists it last: the palette's
   * order is the registry's order, not a sort. */
  test("the rail is the registry minus the palette-only destinations", () => {
    expect(RAIL_SECTIONS).toEqual([
      "overview",
      "history",
      "meetings",
      "people",
      "settings",
    ]);
    expect(
      SECTION_ORDER.filter((section) => !RAIL_SECTIONS.includes(section)),
    ).toEqual(["modes", "models"]);
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

    expect(paletteLabels.filter((label) => railLabels.includes(label))).toEqual(
      railLabels,
    );
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
          currentSection={activeSection}
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
      "Meetings",
      "People",
      "Settings",
    ]);
  });

  /* aria-current is the selection; the styling reads the same current route. */
  test("aria-current names exactly one route", () => {
    const markup = renderSidebar("meetings");
    expect([...markup.matchAll(/aria-current="page"/g)]).toHaveLength(1);
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

  /* The rail uses shared theme tokens, not hand-rolled shell CSS. */
  test("carries theme utilities and no legacy shell classes", () => {
    const markup = renderSidebar();
    expect(markup).not.toContain("app-sidebar");
    expect(markup).toContain("bg-background-200");
    expect(markup).toContain("border-gray-alpha-400");
    expect(markup).toContain("hover:bg-gray-alpha-100");
    expect(markup).toContain("bg-background-100");
    expect(markup).toContain("focus-visible:ring-blue-700");
    // Violet is dead, and so is every accent-soft fill it used to tint.
    expect(markup).not.toContain("violet");
    expect(markup).not.toContain("accent-soft");
  });
});

/* ⌘K's second half: the corpus. The palette itself still cannot be rendered
 * here — Radix portals to a document this runner does not have — so what is
 * pinned is every rule the surface reads: how a page becomes sections, what the
 * list may never filter away, when the ask row exists, and what a chosen row
 * and a chosen ask actually do to the backend. */

const WHEN = 1_786_699_920_000;

const queryRow = (
  kind: QueryRow["kind"],
  id: string,
  when_utc_ms = WHEN,
): QueryRow => ({
  kind,
  id,
  title: `${id} title`,
  snippet: `${id} snippet`,
  when_utc_ms,
  link: `sona://${kind}/${id}`,
});

const PANEL_STATUS: AgentPanelStatusV1 = {
  invalidation_id: 1,
  relay_status: "ready",
  panel_open: true,
  conversation: [],
  turn: null,
  proposal: null,
  geometry: null,
};

describe("what a page of the query plane looks like in the palette", () => {
  test("sections come in one order, and a kind nothing matched has none", () => {
    const sections = groupQueryRows([
      queryRow("loop", "l-1"),
      queryRow("meeting", "m-1"),
      queryRow("dictation", "7"),
    ]);

    expect(sections.map((section) => section.kind)).toEqual([
      "meeting",
      "dictation",
      "loop",
    ]);
    expect(RESULT_KINDS).toEqual(["meeting", "person", "dictation", "loop"]);
  });

  /* Relevance decided membership; recency decided the page order
   * (`query/mod.rs`). Re-sorting inside a section would be this surface
   * inventing a second answer to a question the plane refuses to guess at. */
  test("the plane's page order survives inside a section", () => {
    const [meetings] = groupQueryRows([
      queryRow("meeting", "newest", WHEN),
      queryRow("meeting", "older", WHEN - 5_000),
      queryRow("meeting", "oldest", WHEN - 9_000),
    ]);

    expect(meetings.rows.map((row) => row.id)).toEqual([
      "newest",
      "older",
      "oldest",
    ]);
  });

  /* `QueryRowKind` declares six nouns; no scope produces these two, so a
   * section for them would be a heading that can never have a row under it. */
  test("the kinds no scope produces are not sections", () => {
    expect(
      groupQueryRows([queryRow("series", "s-1"), queryRow("receipt", "r-1")]),
    ).toEqual([]);
  });

  test("every section heading and glyph is a shipped one", () => {
    for (const kind of RESULT_KINDS) {
      expect(i18n.exists(resultHeadingKeys[kind])).toBe(true);
      expect(i18n.t(resultHeadingKeys[kind])).not.toBe("");
    }
    // Meetings, People and Library wear the same glyph here as in the rail.
    expect(resultIcons.meeting).toBe(destinationIcons.meetings);
    expect(resultIcons.person).toBe(destinationIcons.people);
    expect(resultIcons.dictation).toBe(destinationIcons.history);
  });

  /* A meeting can come back from the semantic half of the plane without sharing
   * one letter with what was typed. cmdk would score that zero and hide it. */
  test("a plane row is never filtered out; an action keeps cmdk's own score", () => {
    const row = queryRow("meeting", "m-1");
    expect(paletteFilter(rowValue(row), "what did I promise Steven", [])).toBe(
      1,
    );
    expect(paletteFilter(ASK_VALUE, "what did I promise Steven", [])).toBe(1);
    expect(paletteFilter("Import audio", "import audio", [])).toBeGreaterThan(
      0,
    );
    expect(paletteFilter("Import audio", "zzzzzz", [])).toBe(0);
  });

  test("a row's value is its address, so no two rows collide", () => {
    expect(rowValue(queryRow("meeting", "m-1"))).not.toBe(
      rowValue(queryRow("dictation", "m-1")),
    );
  });
});

describe("the ask row", () => {
  const paired = { enabled: true, paired: true };

  test("needs text, the panel toggle, and a pairing", () => {
    expect(canAsk("what did I promise Steven", paired)).toBe(true);
    expect(canAsk("   ", paired)).toBe(false);
    expect(canAsk("", paired)).toBe(false);
  });

  /* An unpaired panel has nowhere to send the question, so offering to ask
   * would be a promise the app cannot keep. */
  test("an unpaired or disabled panel hides it", () => {
    expect(canAsk("steven", { enabled: true, paired: false })).toBe(false);
    expect(canAsk("steven", { enabled: false, paired: true })).toBe(false);
    expect(canAsk("steven", { enabled: false, paired: false })).toBe(false);
  });
});

describe("what the palette asks the backend", () => {
  test("one search of every scope, one page, no cursor", async () => {
    const original = commands.sonaQuerySearch;
    const calls: unknown[][] = [];
    commands.sonaQuerySearch = async (scope, query, limit, cursor) => {
      calls.push([scope, query, limit, cursor]);
      return {
        status: "ok",
        data: {
          schema_version: 1,
          entries: [queryRow("meeting", "m-1")],
          next_cursor: null,
        },
      };
    };

    try {
      const outcome = await searchCorpus("steven");
      expect(calls).toEqual([["all", "steven", SEARCH_LIMIT, null]]);
      expect(outcome).toEqual({
        status: "rows",
        rows: [queryRow("meeting", "m-1")],
      });
    } finally {
      commands.sonaQuerySearch = original;
    }
  });

  /* Unavailable, invalid, unknown cursor: nothing a reader of a search box can
   * act on differently, so the surface reads one failure. */
  test("a refused search is one failure, not four", async () => {
    const original = commands.sonaQuerySearch;
    commands.sonaQuerySearch = async () => ({
      status: "error",
      error: "unavailable",
    });

    try {
      expect(await searchCorpus("steven")).toEqual({ status: "failed" });
    } finally {
      commands.sonaQuerySearch = original;
    }
  });

  test("choosing a row hands its address to the one dispatch", async () => {
    const original = commands.sonaOpenLink;
    const opened: string[] = [];
    commands.sonaOpenLink = async (link) => {
      opened.push(link);
      return true;
    };

    try {
      await openRow(queryRow("loop", "m-1:loop:abc"));
      // The loop's meeting is derived in `deeplink.rs`, never here.
      expect(opened).toEqual(["sona://loop/m-1:loop:abc"]);
    } finally {
      commands.sonaOpenLink = original;
    }
  });
});

describe("asking Sona", () => {
  test("the turn carries the pack that was just built", async () => {
    const originalPack = commands.sonaQueryPack;
    const originalOpen = commands.agentPanelOpen;
    const originalSend = commands.agentPanelSendTurn;
    const sent: AgentPanelSendTurnRequestV1[] = [];
    let opens = 0;
    commands.sonaQueryPack = async (question) => ({
      status: "ok",
      data: {
        schema_version: 1,
        pack: `sona context pack 1\nquestion: ${question}\nquotes: 1 of 1`,
        sources: [queryRow("meeting", "m-1")],
      },
    });
    commands.agentPanelOpen = async () => {
      opens += 1;
      return { status: "ok", data: PANEL_STATUS };
    };
    commands.agentPanelSendTurn = async (request) => {
      sent.push(request);
      return { status: "ok", data: PANEL_STATUS };
    };

    try {
      expect(await askSona("what did I promise Steven", "de")).toBe("sent");
      expect(opens).toBe(1);
      expect(sent).toHaveLength(1);
      expect(sent[0].message).toBe("what did I promise Steven");
      expect(sent[0].workspace).toBe("sona_chat");
      expect(sent[0].locale).toBe("de");
      expect(sent[0].context_pack).toBe(
        "sona context pack 1\nquestion: what did I promise Steven\nquotes: 1 of 1",
      );
    } finally {
      commands.sonaQueryPack = originalPack;
      commands.agentPanelOpen = originalOpen;
      commands.agentPanelSendTurn = originalSend;
    }
  });

  /* Without evidence the model would answer from its own priors and cite
   * nothing, which is the failure "ask your history" exists to end. */
  test("no pack, no question", async () => {
    const originalPack = commands.sonaQueryPack;
    const originalSend = commands.agentPanelSendTurn;
    let sends = 0;
    commands.sonaQueryPack = async () => ({
      status: "error",
      error: "unavailable",
    });
    commands.agentPanelSendTurn = async () => {
      sends += 1;
      return { status: "ok", data: PANEL_STATUS };
    };

    try {
      expect(await askSona("what did I promise Steven", "en")).toBe("failed");
      expect(sends).toBe(0);
    } finally {
      commands.sonaQueryPack = originalPack;
      commands.agentPanelSendTurn = originalSend;
    }
  });
});
