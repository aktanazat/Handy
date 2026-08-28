import React from "react";
import { Toaster as SonnerToaster } from "sonner";

/* The app's single toast surface. Mount once at the shell root; raise
 * messages with `toast` from sonner. Styling is unstyled+classNames so
 * toasts are the same hairline surface as everything else. */
export const Toaster: React.FC = () => (
  <SonnerToaster
    theme="system"
    toastOptions={{
      unstyled: true,
      classNames: {
        toast:
          "bg-surface border border-border rounded-panel px-4 py-3 flex items-center gap-3 text-[13px] shadow-[var(--shadow-popover)]",
        title: "font-medium text-text-primary",
        description: "text-text-secondary",
        actionButton:
          "min-h-8 px-2.5 text-[13px] font-medium rounded-control border border-border bg-control hover:bg-control-hover cursor-pointer whitespace-nowrap",
      },
    }}
  />
);
