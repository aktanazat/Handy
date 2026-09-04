import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/vg/tooltip";
import { useSettingsStore } from "@/stores/settingsStore";
import { APP_SETTINGS } from "../../../../tests/support/tauri-fixtures";
import { PrivacyContextSettings } from "./PrivacyContextSettings";

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: {
      translation: {
        settings: {
          general: {
            commandMode: {
              description:
                "Hold the command shortcut and say what to change about the text you have selected.",
            },
          },
          privacy: {
            context: {
              ceiling: {
                label: "Global context ceiling",
                values: {
                  none: "Off",
                  target: "App",
                  target_and_selection: "Selection",
                  full: "Full",
                },
                error: "The context ceiling could not be saved.",
              },
              sources: {
                none: "Reads nothing from your other apps.",
              },
              urlCapture: {
                label: "Capture browser URLs",
                description:
                  "Include the frontmost browser URL when context allows it.",
                error: "The URL capture setting could not be saved.",
              },
            },
          },
        },
      },
    },
  },
  interpolation: { escapeValue: false },
});

const paint = (commandModeEnabled: boolean): string => {
  const settings: ReturnType<typeof useSettingsStore.getState>["settings"] = {
    ...APP_SETTINGS,
    command_mode_enabled: commandModeEnabled,
  };
  useSettingsStore.setState({ settings, isUpdating: {} });

  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <PrivacyContextSettings />
      </TooltipProvider>
    </I18nextProvider>,
  );
};

describe("the privacy context notice", () => {
  test("names the selected-text exception when command mode is enabled", () => {
    const markup = paint(true);

    expect(markup).toContain(
      "Hold the command shortcut and say what to change about the text you have selected.",
    );
    expect(markup).not.toContain("Reads nothing from your other apps.");
  });

  test("keeps the automatic-context promise when command mode is disabled", () => {
    const markup = paint(false);

    expect(markup).toContain("Reads nothing from your other apps.");
    expect(markup).not.toContain(
      "Hold the command shortcut and say what to change about the text you have selected.",
    );
  });
});
