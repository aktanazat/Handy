"use client";

import dynamic from "next/dynamic";
import { TooltipProvider } from "@/components/vg/tooltip";
import { bootstrapWindow } from "@/lib/bootstrapWindow";

/* The companion panel, ported from the old src/agent-panel/main.tsx. A separate
 * webview again: it reconciles the theme the layout's inline script applied and
 * follows live theme changes from the settings window. */
const AgentPanelWindow = dynamic(
  async () => {
    const [{ AgentPanelApp }] = await Promise.all([
      import("@/agent-panel/AgentPanelApp"),
      bootstrapWindow({
        compatShims: true,
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
