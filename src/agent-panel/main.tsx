import React from "react";
import ReactDOM from "react-dom/client";
import { platform } from "@tauri-apps/plugin-os";
import { AgentPanelApp } from "./AgentPanelApp";
import { installCompatShims } from "@/lib/compat";
import {
  applyTheme,
  getStoredTheme,
  syncThemeFromSettings,
} from "@/lib/utils/theme";
import type { Theme } from "@/bindings";
import { listen } from "@tauri-apps/api/event";
import "@/i18n";
import "./AgentPanel.css";

installCompatShims();

// The companion panel is a separate webview: it sets its own platform hint,
// last-known theme (shared localStorage) before render, then reconciles with
// the persisted setting and follows live changes, mirroring the overlay.
document.documentElement.dataset.platform = platform();
applyTheme(getStoredTheme());
syncThemeFromSettings();
listen<Theme>("theme-changed", (event) => applyTheme(event.payload));

// SAFETY: index.html always renders a #root div before this module loads,
// so the element exists and is an HTMLElement by the time createRoot runs.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AgentPanelApp />
  </React.StrictMode>,
);
