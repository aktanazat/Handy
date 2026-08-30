import React from "react";

export interface BadgeProps {
  children: React.ReactNode;
  variant?: "primary" | "success" | "secondary";
  className?: string;
}

/* `primary` marks "this is the current one" with the selection device — the
 * accent-soft fill under primary ink, never a black slab and never a solid
 * accent (which belongs to the one primary action per view). `secondary` is
 * the hairline outline every other categorical chip uses. `success` colours
 * the WORD, not the container: the semaphore law reserves tinted fills and
 * borders for status indicators, so a verified/granted state keeps the
 * hairline chip and carries its meaning in the text. */
const BADGE_VARIANT_CLASSES = {
  primary: "border-transparent bg-accent-soft text-text-primary",
  success: "border-border bg-transparent text-[var(--green-900)]",
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
