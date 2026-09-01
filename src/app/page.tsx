"use client";

import dynamic from "next/dynamic";
import { LaunchShell } from "@/components/LaunchShell";
import { TooltipProvider } from "@/components/vg/tooltip";
import { bootstrapWindow } from "@/lib/bootstrapWindow";
import { waitForBackendReady } from "@/lib/launchTrace";
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
    const backendReady = waitForBackendReady();
    const [{ default: App }, { useModelStore }] = await Promise.all([
      import("@/App"),
      import("@/stores/modelStore"),
      bootstrapWindow({
        compatShims: true,
        followThemeChanges: false,
      }),
      backendReady,
    ]);

    // Manager construction starts only after LaunchShell paints. Keep the
    // static shell until the complete catalog snapshot is available so the
    // full app never renders a transient empty model list.
    await useModelStore.getState().initialize();

    return App;
  },
  { ssr: false, loading: () => <LaunchShell /> },
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
