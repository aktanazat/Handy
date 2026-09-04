"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { TooltipProvider } from "@/components/vg/tooltip";
import { bootstrapWindow } from "@/lib/bootstrapWindow";
import { followAppearanceMaterial } from "@/overlay/overlayEvents";
import "./overlay-window.css";
import "@/overlay/RecordingOverlay.css";

/* The recording HUD. Its own webview, so it owns its own bootstrap — ported
 * from the old src/overlay/main.tsx — and, like every window here, none of it
 * can run during the static export. */
const RecordingOverlayWindow = dynamic(
  async () => {
    const [{ default: RecordingOverlay }] = await Promise.all([
      import("@/overlay/RecordingOverlay"),
      bootstrapWindow({
        compatShims: true,
        followThemeChanges: true,
      }),
    ]);

    return RecordingOverlay;
  },
  { ssr: false },
);

export default function OverlayWindowRoute() {
  useEffect(() => {
    const subscription = followAppearanceMaterial();
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);
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
