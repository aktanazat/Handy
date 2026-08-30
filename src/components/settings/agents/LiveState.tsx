import React from "react";
import { Microlabel } from "@/components/settings/rows";

/** A mono status word the backend changes under the reader. */
export const LiveState: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className, children }) => (
  <span aria-live="polite">
    <Microlabel className={className}>{children}</Microlabel>
  </span>
);
