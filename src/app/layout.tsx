import type { Metadata, Viewport } from "next";
import { THEME_STORAGE_KEY } from "@/lib/themeStorageKey";
import "./globals.css";

/* The shell every Sona window is served from. Each window is a route under this
 * layout — / (settings), /overlay (recording HUD), /consent (meeting consent) —
 * and each one exports its own title, so this file only owns the document. */

export const metadata: Metadata = {
  title: "Sona",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/* Resolve the palette before first paint. Light is the document fallback; the
 * existing bootstrap switches to dark when the saved choice or macOS appearance
 * calls for it. This stays in agreement with resolveTheme() in
 * src/lib/utils/theme.ts. */
const THEME_BOOTSTRAP = `(function(){var s;try{s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){s=null}document.documentElement.dataset.theme=s==="light"||s==="dark"?s:window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /* `lang`/`dir` are the boot values; i18n rewrites both on the live document
     * once a locale loads, which is also why hydration warnings are suppressed
     * here — the theme script has already moved `data-theme` by then. */
    <html lang="en" dir="ltr" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
