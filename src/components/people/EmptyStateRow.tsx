import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface EmptyStateRowProps {
  icon: LucideIcon;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Empty states stay inside the row grammar: one glyph, one sentence, and an
 * optional recovery action. No illustration or nested card. */
export const EmptyStateRow: React.FC<EmptyStateRowProps> = ({
  icon: Icon,
  children,
  action,
  className,
}) => (
  <div
    data-slot="people-empty-row"
    className={cn(
      "flex min-h-16 items-center gap-3 px-4 py-3 text-[13px] leading-5 text-gray-800",
      className,
    )}
  >
    <Icon aria-hidden="true" className="size-4 flex-none text-gray-700" />
    <span className="min-w-0 flex-1 text-pretty">{children}</span>
    {action ?? null}
  </div>
);
