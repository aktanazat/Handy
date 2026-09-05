import React from "react";
import { cn } from "@/lib/cn";

interface EmptyStateRowProps {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** An absence, inside the row grammar: one sentence in the Meta tier and the
 * one action that fills it. No glyph, no illustration, no nested card — a
 * section with nothing in it says so once, quietly, and an icon over that
 * sentence is decoration. */
export const EmptyStateRow: React.FC<EmptyStateRowProps> = ({
  children,
  action,
  className,
}) => (
  <div
    data-slot="people-empty-row"
    className={cn(
      "flex min-h-14 flex-wrap items-center gap-4 px-6 py-3.5 text-[13px] leading-[18px] text-gray-900",
      className,
    )}
  >
    <span className="min-w-0 flex-1 text-pretty">{children}</span>
    {action ?? null}
  </div>
);
