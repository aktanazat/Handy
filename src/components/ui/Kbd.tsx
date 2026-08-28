import React from "react";

export interface KbdProps {
  children: React.ReactNode;
  className?: string;
}

/* One key. Compose a chord by placing several side by side rather than
 * putting "Cmd+K" inside a single cap. */
export const Kbd: React.FC<KbdProps> = ({ children, className = "" }) => (
  <kbd
    className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-border px-1 font-mono text-[10px] leading-none text-text-secondary ${className}`}
  >
    {children}
  </kbd>
);
