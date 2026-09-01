"use client";

import { useEffect } from "react";
import { RouteSkeleton } from "@/components/RouteSkeleton";
import { PAGE_COLUMN } from "@/components/settings/rows";
import { cn } from "@/lib/cn";
import { reportFirstDomPaint } from "@/lib/launchTrace";
import type { LanguageDirection } from "@/lib/utils/rtl";

interface LaunchShellProps {
  direction?: LanguageDirection;
  loadingLabel?: string;
}

export const LaunchShell = ({ direction, loadingLabel }: LaunchShellProps) => {
  useEffect(reportFirstDomPaint, []);

  return (
    <div
      data-slot="launch-shell"
      dir={direction}
      aria-busy="true"
      aria-hidden={loadingLabel === undefined ? true : undefined}
      className="app-shell relative flex h-screen cursor-default select-none bg-background-200"
    >
      <aside
        aria-hidden="true"
        className="glass-surface flex w-[220px] flex-none flex-col border-e border-gray-alpha-400 bg-background-200 px-[10px]"
      >
        <div className="h-[38px] flex-none" data-tauri-drag-region />
      </aside>
      <main className="settings-main relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          data-slot="drag-band"
          data-tauri-drag-region
          className="absolute inset-x-0 top-0 z-0 h-12"
        />
        <div data-slot="page-scroll" className="flex-1 overflow-hidden">
          <div className={cn(PAGE_COLUMN, "py-12")}>
            <RouteSkeleton label={loadingLabel ?? ""} />
          </div>
        </div>
      </main>
    </div>
  );
};
