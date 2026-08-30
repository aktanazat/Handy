import React from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import RecordingOverlay from "./RecordingOverlay";
import { followAppearanceMaterial } from "./overlayEvents";
import {
  applyTheme,
  getStoredTheme,
  syncThemeFromSettings,
} from "@/lib/utils/theme";
import type { Theme } from "@/bindings";
import "@/i18n";

// The overlay is a separate webview from the settings window, so it owns its
// own `data-material`: only the idle pill takes Glass, and every recording
// state stays solid so nothing bleeds through the level meter.
void followAppearanceMaterial();
// A separate webview from the settings window, so the overlay has to set
// `data-theme` on its own document: last-known theme before render (shared
// localStorage) to avoid a flash, reconcile with the persisted setting in case
// the overlay booted first, then follow live changes.
applyTheme(getStoredTheme());
syncThemeFromSettings();
listen<Theme>("theme-changed", (event) => applyTheme(event.payload));

const root = document.getElementById("root");
if (root === null) {
  throw new Error("overlay.html is missing its #root mount point");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <RecordingOverlay />
  </React.StrictMode>,
);
