import { commands, type Theme } from "@/bindings";
import { THEME_STORAGE_KEY } from "@/lib/themeStorageKey";

/**
 * Appearance theme handling.
 *
 * `styles/theme.css` is authored dark-as-base with `[data-theme="light"]` as
 * the only override, so `data-theme` is always resolved to a concrete palette
 * here rather than being left off for the cascade to guess:
 *  - `light` / `dark` set it directly.
 *  - `system` resolves once against `prefers-color-scheme` and then follows the
 *    OS live, because CSS alone can no longer see the preference.
 *
 * The choice is persisted in `AppSettings` (source of truth) and mirrored to
 * localStorage under `THEME_STORAGE_KEY` so the inline script in
 * `src/app/layout.tsx` can apply it synchronously before first paint, avoiding
 * a flash of the wrong palette. The key itself lives in
 * `src/lib/themeStorageKey.ts` and is interpolated into that script, so the two
 * sides cannot drift; `resolveTheme` below still has to agree with the script's
 * branch logic by hand.
 */

export const THEME_OPTIONS: Theme[] = ["system", "light", "dark"];

/** The two palettes `data-theme` can actually name. */
export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/* The only caller is `getStoredTheme`, decoding what localStorage returns. */
const isTheme = (value: string | null): value is Theme =>
  value === "system" || value === "light" || value === "dark";

/** Collapse a preference into the palette that should be on the root. */
export const resolveTheme = (theme: Theme): ResolvedTheme => {
  if (theme !== "system") return theme;
  try {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  } catch {
    // matchMedia is missing in non-browser environments; the CSS base is dark,
    // so match it.
    return "dark";
  }
};

/* One live subscription at a time. `system` needs it so the window repaints
 * when macOS crosses its light/dark switch; the explicit palettes drop it so a
 * pinned theme costs nothing. */
let unsubscribeFromOs: (() => void) | null = null;

const followOs = (): void => {
  if (unsubscribeFromOs) return;
  try {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      document.documentElement.dataset.theme = event.matches ? "dark" : "light";
    };
    query.addEventListener("change", onChange);
    unsubscribeFromOs = () => query.removeEventListener("change", onChange);
  } catch {
    // No matchMedia: the resolved palette above is as good as it gets.
  }
};

/** Apply a theme to the document root and remember it for the next launch. */
export const applyTheme = (theme: Theme): void => {
  document.documentElement.dataset.theme = resolveTheme(theme);
  if (theme === "system") {
    followOs();
  } else {
    unsubscribeFromOs?.();
    unsubscribeFromOs = null;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage may be unavailable (e.g. private mode); the setting still
    // persists in AppSettings, so this only costs a one-frame flash on boot.
  }
};

/** Read the last-applied theme for synchronous boot-time application. */
export const getStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // ignore
  }
  return "system";
};

/** Apply the persisted theme from AppSettings (the source of truth). */
export const syncThemeFromSettings = async (): Promise<void> => {
  try {
    const result = await commands.getAppSettings();
    if (result.status === "ok") {
      applyTheme(result.data.theme ?? "system");
    }
  } catch (e) {
    console.warn("Failed to sync theme from settings:", e);
  }
};
