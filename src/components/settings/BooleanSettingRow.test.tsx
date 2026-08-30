import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/vg/tooltip";
import type { AppSettings } from "@/bindings";
import { useSettingsStore } from "@/stores/settingsStore";
import { BooleanSettingRow } from "./BooleanSettingRow";
import { AlwaysOnMicrophone } from "./AlwaysOnMicrophone";
import { AudioFeedback } from "./AudioFeedback";
import { AutostartToggle } from "./AutostartToggle";
import { ExperimentalToggle } from "./ExperimentalToggle";
import { MuteWhileRecording } from "./MuteWhileRecording";
import { PushToTalk } from "./PushToTalk";
import { ShowTrayIcon } from "./ShowTrayIcon";
import { ShowWhatsNewOnUpdate } from "./ShowWhatsNewOnUpdate";
import { StartHidden } from "./StartHidden";

/* Nine toggle rows were the same five statements written nine times, and they
 * had already drifted on the one thing they had to agree about: what an ABSENT
 * setting reads as. `getSetting` returns `undefined` until the first load
 * resolves, so that fallback is literally what the user sees on first paint.
 *
 * Three idioms were in the tree — `?? false`, `|| false`, `?? true` — and the
 * first two are indistinguishable, which is why nobody noticed. They come
 * apart the moment a row defaults to TRUE, and two rows do: with `||` a stored
 * `false` is read as missing and the switch flips back on under the user. That
 * is the case the third test below is here for; it is the reason this row
 * exists rather than nine copies. */

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: {
      translation: {
        row: { label: "Show tray icon", hint: "It stays reachable." },
      },
    },
  },
  interpolation: { escapeValue: false },
});

const paint = (
  settings: AppSettings,
  props: {
    settingKey: "show_tray_icon" | "push_to_talk";
    defaultValue?: boolean;
    hintKey?: string;
  },
  updating: Record<string, boolean> = {},
): string => {
  useSettingsStore.setState({ settings, isUpdating: updating });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <BooleanSettingRow labelKey="row.label" {...props} />
      </TooltipProvider>
    </I18nextProvider>,
  );
};

/* What the switch reports to assistive tech, which is also the only readable
 * statement of on/off in the markup. */
const state = (markup: string): string =>
  /role="switch" aria-checked="([^"]*)"/.exec(markup)?.[1] ?? "";

describe("a boolean settings row", () => {
  test("reads a stored true as on and a stored false as off", () => {
    expect(
      state(paint({ push_to_talk: true }, { settingKey: "push_to_talk" })),
    ).toBe("true");
    expect(
      state(paint({ push_to_talk: false }, { settingKey: "push_to_talk" })),
    ).toBe("false");
  });

  test("falls back to off when there is no setting yet", () => {
    expect(state(paint({}, { settingKey: "push_to_talk" }))).toBe("false");
  });

  test("a row that defaults on still reports a stored false as off", () => {
    // `getSetting(k) || true` would answer on here, which is the bug the nine
    // hand-written copies were one edit away from shipping.
    expect(
      state(
        paint(
          { show_tray_icon: false },
          { settingKey: "show_tray_icon", defaultValue: true },
        ),
      ),
    ).toBe("false");
    expect(
      state(paint({}, { settingKey: "show_tray_icon", defaultValue: true })),
    ).toBe("true");
  });

  test("names its switch by the row label, for assistive tech", () => {
    const markup = paint({}, { settingKey: "show_tray_icon" });
    const controlId = /<label for="([^"]+)"/.exec(markup)?.[1];

    expect(markup).toContain("Show tray icon</label>");
    expect(markup).toContain(`id="${controlId ?? "?"}"`);
    expect(markup).toContain('data-slot="switch"');
  });

  test("a hint is a tooltip affordance, never printed into the row", () => {
    const markup = paint(
      {},
      { settingKey: "show_tray_icon", hintKey: "row.hint" },
    );

    expect(markup).not.toContain("It stays reachable.");
    expect(markup).toContain('data-slot="tooltip-trigger"');
    expect(markup).toContain('aria-label="Show tray icon"');
  });

  test("locks the switch while its write is in flight", () => {
    const markup = paint(
      {},
      { settingKey: "show_tray_icon" },
      {
        show_tray_icon: true,
      },
    );

    expect(
      /<button[^>]*data-slot="switch"[^>]*>/.exec(markup)?.[0] ?? "",
    ).toContain('disabled=""');
  });
});

/* Nine rows now declare their copy and their default as data, which a
 * type-check cannot read: a mistyped `labelKey` ships as a raw dotted string
 * and a dropped `defaultValue` silently reverses a row. i18next falls back
 * silently, so nothing else in the build would notice. */
describe("the nine toggles the extraction absorbed", () => {
  const catalogue = JSON.parse(
    fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "i18n",
        "locales",
        "en",
        "translation.json",
      ),
      "utf8",
    ),
  );
  const shipped = createInstance();
  void shipped.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: catalogue } },
    interpolation: { escapeValue: false },
    parseMissingKeyHandler: () => "__MISSING__",
  });

  /* Every row, and every row's UNSET reading — which is the value the nine
   * copies disagreed about and the only thing `defaultValue` decides. */
  const ROWS: [string, React.ReactElement, boolean][] = [
    ["autostart", <AutostartToggle />, false],
    ["tray icon", <ShowTrayIcon />, true],
    ["mute while recording", <MuteWhileRecording />, false],
    ["always-on microphone", <AlwaysOnMicrophone />, false],
    ["start hidden", <StartHidden />, false],
    ["experimental", <ExperimentalToggle />, false],
    ["what's new on update", <ShowWhatsNewOnUpdate />, true],
    ["audio feedback", <AudioFeedback />, false],
    ["push to talk", <PushToTalk />, false],
  ];

  for (const [name, row, onWhenUnset] of ROWS) {
    test(`${name} names itself in shipped English and reads ${onWhenUnset ? "on" : "off"} unset`, () => {
      useSettingsStore.setState({ settings: {}, isUpdating: {} });
      const markup = renderToStaticMarkup(
        <I18nextProvider i18n={shipped}>
          <TooltipProvider>{row}</TooltipProvider>
        </I18nextProvider>,
      );
      const label = /<label [^>]*>([^<]*)</.exec(markup)?.[1] ?? "";

      expect(markup).not.toContain("__MISSING__");
      expect(label.length).toBeGreaterThan(0);
      // A raw i18n key leaking through would carry its dots.
      expect(label).not.toContain(".");
      expect(state(markup)).toBe(String(onWhenUnset));
    });
  }
});
