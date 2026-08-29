import React from "react";

export interface KbdProps {
  children: React.ReactNode;
  className?: string;
}

/* One physical key. The 11px mono cap in an 18px box is the keycap role from
 * the type ramp — mono because a key glyph is a machine string, 18px because a
 * chip row has to fit inside a 36px dense row without pushing it taller. A
 * chord is several caps side by side; nothing ever puts "Cmd+K" inside one cap.
 *
 * The look lives in `.kbd` (styles/primitives.css) rather than in utilities
 * here, because <Kbd> also renders in the recording-overlay webview, which
 * loads the token and primitive stylesheets but not Tailwind. Utilities there
 * are inert and the cap would ship unstyled. */
export const Kbd: React.FC<KbdProps> = ({ children, className = "" }) => (
  <kbd className={`kbd ${className}`}>{children}</kbd>
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
