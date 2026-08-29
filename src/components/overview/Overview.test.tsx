import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { HistoryUpdatePayload } from "@/bindings";
import { Overview, subscribeToHistoryWrites } from "./Overview";

/* First paint of the page, before any effect has run: what someone sees in the
 * moment between opening Capture and the history reads landing. The names
 * asserted here are the ones the shell, the command palette and the
 * end-to-end suite look up.
 *
 * Inline resources initialise synchronously, so no beforeAll hook is needed
 * (the repo's bun:test shim declares neither hooks nor `expect().not`). */

const localeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

/* @tauri-apps/plugin-os reads its platform off a window global that the Tauri
 * runtime injects. Static rendering has no window, so the hero's keycap
 * formatting would throw before it could be inspected. The event globals beside
 * it are the ones `@tauri-apps/api` calls through when this page subscribes:
 * `transformCallback` hands the page's own handler straight back, so the
 * `listen` invoke carries it and the test can deliver a write the way the
 * webview does. */
const listens: {
  event: string;
  handler: (message: { payload: HistoryUpdatePayload }) => void;
}[] = [];
const unlistens: string[] = [];

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    __TAURI_OS_PLUGIN_INTERNALS__: { os_type: "macos" },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    __TAURI_INTERNALS__: {
      transformCallback: (
        handler: (message: { payload: HistoryUpdatePayload }) => void,
      ) => handler,
      invoke: async (
        command: string,
        args: {
          event: string;
          handler: (message: { payload: HistoryUpdatePayload }) => void;
        },
      ) => {
        if (command === "plugin:event|listen") {
          listens.push({ event: args.event, handler: args.handler });
          return listens.length;
        }
        if (command === "plugin:event|unlisten") {
          unlistens.push(args.event);
        }
        return null;
      },
    },
  },
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

const markup = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <Overview />
  </I18nextProvider>,
);

describe("Overview first paint", () => {
  test("keeps the hero status heading and both primary actions", () => {
    expect(markup).toContain('id="overview-status"');
    expect(markup).toContain("Ready");
    expect(markup).toContain("New meeting");
    expect(markup).toContain("Import audio");
  });

  test("says the shortcut is missing instead of showing empty keycaps", () => {
    expect(markup).toContain("Shortcut unavailable");
  });

  /* The meeting promise is a product commitment the wave was asked to make
   * self-evident, so it is asserted as copy rather than as markup. */
  test("states what a meeting recording does, beside the button that does it", () => {
    expect(markup).toContain("ov-hero-action");
    expect(markup).toContain(
      "Records your Mac&#x27;s audio locally. Nothing joins the call.",
    );
  });

  /* The gesture sentence describes the chord. With no chord bound there is no
   * gesture to describe, and printing one would claim a capability the install
   * does not have — the same class of lie as the old unconditional hint line. */
  test("claims no gesture while no shortcut is bound", () => {
    expect(markup.includes("Tap to toggle")).toBe(false);
    expect(markup).toContain("Set a shortcut");
    expect(markup).toContain('data-testid="overview-shortcut"');
  });

  test("renders the instrument strip with all four labelled cells", () => {
    expect(markup).toContain('aria-label="Capture instrument"');
    for (const cell of ["engine", "input", "shortcut", "mode"]) {
      expect(markup).toContain(`data-cell="${cell}"`);
    }
    expect(markup).toContain(">Engine</dt>");
    expect(markup).toContain(">Input</dt>");
    expect(markup).toContain(">Shortcut</dt>");
    expect(markup).toContain(">Mode</dt>");
  });

  /* Every value in the strip is a measurement, and a measurement snaps: a
   * transition on one of these would paint numbers the backend never sent. */
  test("marks every strip value as never-animated", () => {
    expect(markup).toContain("ov-strip-datum type-data snap-measured");
  });

  test("names an unmeasured input level rather than printing a zero", () => {
    expect(markup).toContain("not measured");
    expect(markup).toContain('data-absent="true"');
    expect(markup).toContain("16 kHz");
  });

  test("reports an unbound chord as unset, in the strip and not as a blank", () => {
    expect(markup).toContain(">not set<");
  });

  /* The accent's containment boundary and the text column's reserved width are
   * the same number, published once so they cannot drift apart. */
  test("publishes one containment share for the accent and the layout", () => {
    expect(markup).toContain("--shader-hero-clear:62%");
  });

  test("loads behind placeholders, with no update banner and no numbers", () => {
    expect(markup).toContain("ui-skeleton");
    expect(markup.includes("is available. This install is on")).toBe(false);
    expect(markup.includes("Could not check for updates")).toBe(false);
    expect(markup.includes("ov-stat-value")).toBe(false);
  });

  /* The banned copy: an empty region used to apologise for a query that had
   * actually succeeded. Neither the apology nor the old separate hint line may
   * come back. */
  test("carries no apology copy and no orphaned hint line", () => {
    expect(markup.includes("could not be loaded just now")).toBe(false);
    expect(markup.includes("Nothing recent")).toBe(false);
    expect(markup.includes("ov-hero-facts")).toBe(false);
  });
});

/* The page's measured cells — decode throughput, input amplitudes, dictation
 * counters — all come from one read wave per mount, so before this subscription
 * a dictation that landed while Capture was open kept reporting the capture
 * before it until someone left the page and came back. The `listen` call goes
 * through the real `@tauri-apps/api` path here, so the event name asserted is
 * the generated one the Rust emit publishes and not a string this test made up.
 */
const entry = {
  id: 7,
  file_name: "sona-1.wav",
  timestamp: 1,
  saved: false,
  title: "Recording 1",
  transcription_text: "hello",
  post_processed_text: null,
  post_process_requested: false,
  parent_id: null,
};

describe("Capture stays live while it is open", () => {
  test("re-reads on a saved capture and on a removal, never on a star", async () => {
    let reads = 0;
    const unlisten = await subscribeToHistoryWrites(() => {
      reads += 1;
    });
    expect(listens.map((listener) => listener.event)).toEqual([
      "history-update-payload",
    ]);

    const deliver = (payload: HistoryUpdatePayload) =>
      listens[0].handler({ payload });

    deliver({ action: "added", entry });
    expect(reads).toBe(1);
    deliver({ action: "updated", entry });
    expect(reads).toBe(2);
    deliver({ action: "deleted", id: entry.id });
    expect(reads).toBe(3);

    /* Capture never draws the saved star and its counters do not distinguish a
     * starred row, so a toggle must not cost a read wave. */
    deliver({ action: "toggled", id: entry.id });
    expect(reads).toBe(3);

    await unlisten();
    expect(unlistens).toEqual(["history-update-payload"]);
  });
});
