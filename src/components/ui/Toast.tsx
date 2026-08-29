import React from "react";
import { Toaster as SonnerToaster } from "sonner";

/* The app's single toast surface. Mount once at the shell root; raise
 * messages with `toast` from sonner.
 *
 * Copy rules, because a toast is mostly its sentence:
 *   - pick the method by how the event was experienced, not by status code —
 *     a cancel is .message(), a partial success is .warning();
 *   - completions are "{Noun} {past-participle}" — "Snippet saved", never
 *     "Snippet saved successfully";
 *   - errors are two sentences and the second one is the way out —
 *     "Couldn't transcribe. Try again.";
 *   - sentence case, and no trailing period on a single-sentence toast.
 *
 * Raised as a raised surface rather than a card: it floats over the page, so
 * it earns both the hairline and the shadow. */
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
          "min-h-8 px-4 text-[13px] font-medium rounded-control border border-inverse-background bg-inverse-background text-inverse-text hover:bg-accent-hover hover:border-accent-hover cursor-pointer whitespace-nowrap",
        cancelButton:
          "min-h-8 px-4 text-[13px] font-medium rounded-control border border-border bg-control hover:bg-control-hover cursor-pointer whitespace-nowrap",
      },
    }}
  />
);
