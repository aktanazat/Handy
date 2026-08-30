import React from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "danger-ghost";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/* One primary per view, everything else secondary or ghost. Destructive work
 * is ghost-red by default; the filled danger variant is for the confirming
 * button inside a dialog, where the action is already the point.
 *
 * Primary is the accent fill with on-accent ink — the one accented control
 * a view gets. Hover and press walk the accent ladder rather than fading out
 * with opacity, and both themes come out of the same three tokens. */
const BUTTON_BASE_CLASSES =
  "liquid-control inline-flex cursor-pointer items-center justify-center gap-1.5 border font-medium whitespace-nowrap transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-[var(--ease-in-out)] disabled:cursor-not-allowed disabled:border-border disabled:bg-control-disabled disabled:text-text-disabled";

const BUTTON_VARIANT_CLASSES = {
  primary:
    "border-accent bg-accent text-on-accent enabled:hover:border-accent-hover enabled:hover:bg-accent-hover enabled:active:border-accent-pressed enabled:active:bg-accent-pressed",
  secondary:
    "control-surface border-border text-text-primary enabled:hover:border-border-strong enabled:hover:bg-control-hover enabled:active:bg-control-active",
  ghost:
    "border-transparent bg-transparent text-text-primary enabled:hover:bg-hover enabled:active:bg-pressed",
  danger:
    "border-danger-strong bg-danger-strong text-inverse-text enabled:hover:border-danger-hover enabled:hover:bg-danger-hover enabled:active:border-danger-pressed enabled:active:bg-danger-pressed",
  "danger-ghost":
    "border-transparent bg-transparent text-danger-strong enabled:hover:border-danger-border enabled:hover:bg-danger-soft enabled:active:bg-danger-soft enabled:active:text-danger-pressed",
} as const;

/* Heights match the control ladder so a button and the input beside it line
 * up. Horizontal padding is Geist's 16px at the default size. */
const BUTTON_SIZE_CLASSES = {
  sm: "min-h-7 px-2.5 text-[13px]",
  md: "min-h-8 px-4 text-[13px]",
  lg: "min-h-9 px-5 text-[13px]",
} as const;

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  return (
    <button
      className={`${BUTTON_BASE_CLASSES} ${BUTTON_VARIANT_CLASSES[variant]} ${BUTTON_SIZE_CLASSES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

export interface IconButtonProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "aria-label"
  > {
  /** Accessible name. Required: an icon alone never names a control. */
  label: string;
  icon: React.ReactNode;
  variant?: ButtonVariant;
  size?: Extract<ButtonSize, "sm" | "md">;
}

const ICON_BUTTON_SIZE_CLASSES = {
  sm: "size-7",
  md: "size-8",
} as const;

export const IconButton: React.FC<IconButtonProps> = ({
  label,
  icon,
  className = "",
  variant = "ghost",
  size = "md",
  ...props
}) => {
  return (
    <button
      aria-label={label}
      title={label}
      className={`${BUTTON_BASE_CLASSES} ${BUTTON_VARIANT_CLASSES[variant]} ${ICON_BUTTON_SIZE_CLASSES[size]} shrink-0 p-0 ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
};
