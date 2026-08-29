import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { Dropdown, type DropdownOption } from "./Dropdown";

/* The trigger is the only place a settings row reports which option is in
 * effect. Every device and model row in the app passes a persisted value
 * against a list built at render time, so the two lists disagreeing is a
 * routine state, not an error path: a microphone gets unplugged, a model gets
 * deleted, an enumeration has not resolved yet. What the trigger says in that
 * state is the whole subject of this file. */

const localeFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

/* Inline resources initialise synchronously, so no beforeAll hook is needed
 * (the repo's bun:test shim declares neither hooks nor `expect().not`, which
 * is why the negative assertions below go through `.includes()`). */
const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeFile, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const OPTIONS: DropdownOption[] = [
  { value: "Default", label: "Default" },
  { value: "MacBook Pro Microphone", label: "MacBook Pro Microphone" },
];

const render = (selectedValue: string | null, options = OPTIONS): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <Dropdown
        options={options}
        selectedValue={selectedValue}
        onSelect={() => undefined}
        placeholder="Select a microphone"
      />
    </I18nextProvider>,
  );

/* Only the closed trigger, never the open listbox, which repeats every label. */
const trigger = (html: string): string => html.slice(0, html.indexOf("<svg"));

describe("Dropdown trigger", () => {
  test("names the option in effect", () => {
    expect(trigger(render("MacBook Pro Microphone"))).toContain(
      "MacBook Pro Microphone",
    );
  });

  test("names a configured value the option list does not carry", () => {
    // The device was unplugged; the setting still says Yeti Nano and the row
    // has to keep saying so.
    const html = trigger(render("Yeti Nano"));
    expect(html).toContain("Yeti Nano");
    expect(html.includes("Select a microphone")).toBe(false);
  });

  test("names it even when the list has not been enumerated at all", () => {
    const html = trigger(render("Yeti Nano", []));
    expect(html).toContain("Yeti Nano");
  });

  test("claims nothing about why the value is missing", () => {
    // The primitive sees an option list. It cannot tell a device enumeration
    // confirmed gone from one whose enumeration failed or is still in flight,
    // so it must not label either.
    const html = trigger(render("Yeti Nano"));
    const lowered = html.toLowerCase();
    expect(lowered.includes("unavailable")).toBe(false);
    expect(lowered.includes("missing")).toBe(false);
  });

  test("shows the placeholder only when nothing is selected", () => {
    expect(trigger(render(null))).toContain("Select a microphone");
    expect(trigger(render(""))).toContain("Select a microphone");
  });
});
