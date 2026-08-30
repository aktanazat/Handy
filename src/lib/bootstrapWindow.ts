import type { Theme } from "@/bindings";

/**
 * What one Sona window does before its React tree mounts.
 *
 * Three routes serve three windows — / (settings), /overlay (recording HUD),
 * /agent-panel (companion) — and each is its own webview, so each has to
 * bootstrap itself. That sequence was copied into all three route factories and
 * had drifted four ways with nothing written down about why. It lives here now,
 * and every difference between the windows is an argument at the call site, so a
 * window that skips a step has to say so out loud.
 *
 * None of this can run during the static export: `platform()`, the settings IPC
 * and `localStorage` all need a live webview. That is what each caller's
 * `ssr: false` buys, and why this is an async function rather than module
 * side-effects — the imports below must not be hoisted into the export build.
 */
export interface BootstrapWindowOptions {
  /**
   * Polyfill `Object.hasOwn` for react-markdown on macOS < 12.3 (lib/compat).
   * Every window runs the same webview engine, so the constraint is the same in
   * all three; the overlay went without only because the call was never ported.
   */
  compatShims: boolean;
  /**
   * Write `data-platform` on the root element. Exactly one stylesheet reads that
   * attribute — App.css's per-platform scrollbars — and exactly one route
   * imports App.css, so this is the settings window's flag alone. Setting it
   * anywhere else is an attribute nothing can match.
   */
  platformAttr: boolean;
  /**
   * Follow `theme-changed` from whichever window changed the setting. The
   * settings window is that window: it emits the event, so listening to itself
   * would only re-apply what it just applied.
   */
  followThemeChanges: boolean;
}

export const bootstrapWindow = async ({
  compatShims,
  platformAttr,
  followThemeChanges,
}: BootstrapWindowOptions): Promise<void> => {
  // Registers the language bundles and applies the persisted locale. First,
  // because every string rendered after this point is read through i18n.
  await import("@/i18n");

  /* Deferred deliberately, not for code splitting: a static import of any of
   * these would run at module scope during `next build`'s static export, where
   * there is no webview and `platform()` throws. They resolve in parallel, the
   * way each route factory used to resolve them. */
  const [{ installCompatShims }, { platform }, theme, { listen }] =
    await Promise.all([
      import("@/lib/compat"),
      import("@tauri-apps/plugin-os"),
      import("@/lib/utils/theme"),
      import("@tauri-apps/api/event"),
    ]);

  if (compatShims) {
    installCompatShims();
  }

  if (platformAttr) {
    document.documentElement.dataset.platform = platform();
  }

  // The layout's inline script already applied the last-known theme before
  // paint; this reconciles it with the persisted setting once that loads.
  theme.applyTheme(theme.getStoredTheme());
  void theme.syncThemeFromSettings();

  if (followThemeChanges) {
    void listen<Theme>("theme-changed", (event) =>
      theme.applyTheme(event.payload),
    );
  }
};
