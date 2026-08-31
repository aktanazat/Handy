"use client";

import dynamic from "next/dynamic";
import { TooltipProvider } from "@/components/vg/tooltip";
import { bootstrapWindow } from "@/lib/bootstrapWindow";
import "@/App.css";

/* The settings window. Everything the old src/main.tsx did before createRoot
 * happens in this factory: it is the only place that runs in the browser and
 * still finishes before <App /> renders. None of it can run during the static
 * export — the settings IPC and localStorage need a live webview — which is
 * what ssr: false buys.
 *
 * This is the window that OWNS the theme: it emits `theme-changed` for the
 * other two, so it does not listen for it. */
const MainWindow = dynamic(
  async () => {
    const [{ default: App }, { useModelStore }] = await Promise.all([
      import("@/App"),
      import("@/stores/modelStore"),
      bootstrapWindow({
        compatShims: true,
        followThemeChanges: false,
      }),
    ]);

    // Loads models and installs their event listeners.
    useModelStore.getState().initialize();

    return App;
  },
  { ssr: false },
);

export default function MainWindowRoute() {
  /* #root stays the app's mount element: styles/base.css sizes it and turns it
   * transparent under the glass material, and the shell measures against it.
   * TooltipProvider is mounted once per window here, so no surface has to
   * bring its own. */
  return (
    <div id="root">
      <TooltipProvider>
        <MainWindow />
      </TooltipProvider>
    </div>
  );
}
