import type { NextConfig } from "next";

/* Sona ships as a Tauri app, so Next is only a static site generator here:
 * `next build` emits plain HTML/JS into out/, which tauri.conf.json serves as
 * frontendDist. There is no Node server at runtime, hence output: "export".
 *
 * Each window is a route (/, /overlay, /agent-panel) and every route mounts its
 * root through next/dynamic with ssr: false, because the components talk to
 * Tauri IPC on import and prerendering has no IPC host. trailingSlash keeps the
 * export at out/<route>/index.html, which is what a file:// webview resolves.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // The floating dev badge sits on top of the app chrome in the Tauri webview.
  devIndicators: false,
  // The typecheck gate `tsc && vite build` used to be. Lint is not part of a
  // build in Next 16 (the `eslint` key was removed with `next lint`); it stays
  // its own `bun run lint`.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
