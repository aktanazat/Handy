import React from "react";
import { Microlabel } from "@/components/settings/rows";

/** A compact status value with optional polite live-region updates. */
export const StatusValue: React.FC<{
  className?: string;
  live?: boolean;
  children: React.ReactNode;
}> = ({ className, live = false, children }) => (
  <span aria-live={live ? "polite" : undefined}>
    <Microlabel className={className}>{children}</Microlabel>
  </span>
);
