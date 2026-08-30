import React from "react";
import { Microlabel } from "@/components/settings/rows";

/** A status word, in the mono type every measurement on this page is set in. */
export const MonoState: React.FC<{
  className?: string;
  live?: boolean;
  children: React.ReactNode;
}> = ({ className, live = false, children }) => (
  <span aria-live={live ? "polite" : undefined}>
    <Microlabel className={className}>{children}</Microlabel>
  </span>
);
