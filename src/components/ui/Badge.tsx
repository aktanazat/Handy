import React from "react";

export interface BadgeProps {
  children: React.ReactNode;
  variant?: "primary" | "success" | "secondary";
  className?: string;
}

/* `primary` is Geist's inverted badge: a grey-1000 fill that flips poles with
 * the theme, reserved for "this is the current one". `secondary` is the
 * hairline outline every other categorical chip uses. `success` is the only
 * tinted variant, and it tints all three of fill, border and text off the same
 * family so it stays legible in both themes. */
const BADGE_VARIANT_CLASSES = {
  primary: "border-inverse-background bg-inverse-background text-inverse-text",
  success:
    "border-[var(--green-400)] bg-[var(--green-100)] text-[var(--green-900)]",
  secondary: "border-border bg-transparent text-text-secondary",
} as const;

/**
 * A categorical or state chip: engine, language, "active". Not for ordinary
 * metadata — a word count or a duration reads better as plain mono text than
 * as a capsule, and Vercel's own design rules put badge-ified metadata on the
 * reject list.
 */
const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "primary",
  className = "",
}) => {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-control border px-1.5 font-mono text-[11px] leading-none font-medium ${BADGE_VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
};

export default Badge;
