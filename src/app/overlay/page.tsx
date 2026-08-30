"use client";

import dynamic from "next/dynamic";
import { TooltipProvider } from "@/components/vg/tooltip";
import { bootstrapWindow } from "@/lib/bootstrapWindow";
import "./overlay-window.css";
import "@/overlay/RecordingOverlay.css";

/* The recording HUD. Its own webview, so it owns its own bootstrap — ported
 * from the old src/overlay/main.tsx — and, like every window here, none of it
 * can run during the static export.
 *
 * It skips `platformAttr` because nothing here reads `data-platform`: the only
 * rules keyed off it live in App.css, which only the settings window imports. */
const RecordingOverlayWindow = dynamic(
  async () => {
    const [{ default: RecordingOverlay }, { followAppearanceMaterial }] =
      await Promise.all([
        import("@/overlay/RecordingOverlay"),
        import("@/overlay/overlayEvents"),
        bootstrapWindow({
          compatShims: true,
          platformAttr: false,
          followThemeChanges: true,
        }),
      ]);

    /* The overlay is a separate webview from the settings window, so it owns its
     * own `data-material`: only the idle pill takes Glass, and every recording
     * state stays solid so nothing bleeds through the level meter. This used to
     * run before the theme steps; `data-material` and `data-theme` are separate
     * attributes and this call is voided either way, so the order between them
     * was never load-bearing. */
    void followAppearanceMaterial();

    return RecordingOverlay;
  },
  { ssr: false },
);

export default function OverlayWindowRoute() {
  /* One provider per window, like the other two roots. The settings primitives
   * this HUD shares render their hints through a Radix tooltip, which throws
   * without a provider above it — so this is load-bearing, not symmetry. */
  return (
    <div id="root">
      <TooltipProvider>
        <RecordingOverlayWindow />
      </TooltipProvider>
    </div>
  );
}
