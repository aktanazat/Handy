/* The localStorage key the theme preference is mirrored to.
 *
 * Its own module because it has two consumers that cannot share one: the
 * pre-hydration inline script in `src/app/layout.tsx`, which is a server
 * component and must stay free of `@/bindings` and of anything that touches
 * `window`; and `src/lib/utils/theme.ts`, which imports `commands` from
 * `@/bindings` and does both the read and the write at runtime.
 *
 * The key is only ever a mirror. `AppSettings.theme` is the source of truth;
 * this exists so the root layout can resolve the palette synchronously before
 * first paint instead of flashing the wrong one while settings load. Renaming
 * it in one place and not the other is silent — no type error, no failing
 * test, just a wrong palette on every cold boot — which is why the literal
 * lives here and both sides read it.
 */
export const THEME_STORAGE_KEY = "sona.theme";
