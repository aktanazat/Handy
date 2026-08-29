import React from "react";

export interface KbdProps {
  children: React.ReactNode;
  className?: string;
}

/* One physical key, drawn the way Vercel's own product chrome draws it: a
 * 20px cap on the page fill with a hairline border, set in the SANS face at
 * 12px/500 — mono here reads as code, not as hardware. A chord is several
 * caps side by side; nothing ever puts "Cmd+K" inside one cap. */
export const Kbd: React.FC<KbdProps> = ({ children, className = "" }) => (
  <kbd
    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border bg-canvas px-1 font-sans text-[12px] leading-none font-medium text-text-tertiary ${className}`}
  >
    {children}
  </kbd>
);

export interface KbdChordProps {
  /** One entry per physical key, in press order: ["Cmd", "K"]. */
  keys: readonly string[];
  className?: string;
}

/* A chord as space-joined caps. Callers that already own their own spacing
 * can keep composing <Kbd> directly. */
export const KbdChord: React.FC<KbdChordProps> = ({ keys, className = "" }) => (
  <span className={`inline-flex items-center gap-1 ${className}`}>
    {keys.map((key, index) => (
      <Kbd key={`${key}-${index}`}>{key}</Kbd>
    ))}
  </span>
);
