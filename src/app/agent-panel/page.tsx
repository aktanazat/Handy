"use client";

import dynamic from "next/dynamic";
import { TooltipProvider } from "@/components/vg/tooltip";
import { bootstrapWindow } from "@/lib/bootstrapWindow";

/* The companion panel, ported from the old src/agent-panel/main.tsx. A separate
 * webview again: it reconciles the theme the layout's inline script applied and
 * follows live theme changes from the settings window.
 *
 * It used to write `data-platform` too. Nothing here could read it — that
 * attribute is only matched by App.css, which only the settings window imports —
 * so the write is gone rather than kept for symmetry. */
const AgentPanelWindow = dynamic(
  async () => {
    const [{ AgentPanelApp }] = await Promise.all([
      import("@/agent-panel/AgentPanelApp"),
      bootstrapWindow({
        compatShims: true,
        platformAttr: false,
        followThemeChanges: true,
      }),
    ]);

    return AgentPanelApp;
  },
  { ssr: false },
);

export default function AgentPanelWindowRoute() {
  return (
    <div id="root">
      <TooltipProvider>
        <AgentPanelWindow />
      </TooltipProvider>
    </div>
  );
}
