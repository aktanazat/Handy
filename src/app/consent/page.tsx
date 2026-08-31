"use client";

import dynamic from "next/dynamic";
import { TooltipProvider } from "@/components/vg/tooltip";
import { bootstrapWindow } from "@/lib/bootstrapWindow";
import "./consent-window.css";

const ConsentPanelWindow = dynamic(
  async () => {
    const [{ default: ConsentPanel }] = await Promise.all([
      import("@/consent/ConsentPanel"),
      bootstrapWindow({
        compatShims: true,
        platformAttr: false,
        followThemeChanges: true,
      }),
    ]);
    return ConsentPanel;
  },
  { ssr: false },
);

export default function ConsentWindowRoute() {
  return (
    <div id="root">
      <TooltipProvider>
        <ConsentPanelWindow />
      </TooltipProvider>
    </div>
  );
}
