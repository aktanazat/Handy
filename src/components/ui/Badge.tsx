import React from "react";

export interface BadgeProps {
  children: React.ReactNode;
  variant?: "primary" | "success" | "secondary";
  className?: string;
}

const BADGE_VARIANT_CLASSES = {
  primary: "bg-inverse-background text-inverse-text",
  success: "border-border bg-transparent text-text-secondary",
  secondary: "border-border bg-transparent text-text-secondary",
} as const;

/**
 * Compact bordered tag, 6px radius, mono 10.5px. The primary variant inverts
 * (black fill, white text); the others are hairline outlines so the active
 * model reads at a glance without colored pills.
 */
const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "primary",
  className = "",
}) => {
  return (
    <span
      className={`inline-flex h-[22px] items-center rounded-[6px] border px-1.5 font-mono text-[10.5px] font-medium leading-none ${BADGE_VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
};

export default Badge;
