import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Microlabel } from "@/components/settings/rows";

/**
 * A task that is one row until a reader needs it.
 *
 * Cloud sync is three one-time tasks and a meeting-level share panel: laid out
 * flat they would bury the settings around them, and the kit has no
 * collapsible, so this is `<details>` — no JavaScript, keyboard and screen
 * reader behaviour for free. The summary is a settings row: label left, the
 * state that decides whether you open it on the right.
 */
export const CloudDisclosure: React.FC<{
  label: string;
  /** The measured state a reader checks before opening this. */
  fact?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ label, fact, children, className }) => (
  <details className={cn("group", className)}>
    <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-4 px-4 py-2.5 text-[13px] text-gray-1000 transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
      {label}
      <span className="flex shrink-0 items-center gap-3">
        {fact ? <Microlabel>{fact}</Microlabel> : null}
        <ChevronDown
          aria-hidden="true"
          className="size-4 text-gray-700 transition-transform group-open:rotate-180"
        />
      </span>
    </summary>
    <div className="divide-y divide-gray-alpha-400 border-t border-gray-alpha-400">
      {children}
    </div>
  </details>
);
