import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "primary-soft"
    | "secondary"
    | "warning"
    | "danger"
    | "danger-ghost"
    | "ghost";
  size?: "sm" | "md" | "lg";
}

const BUTTON_BASE_CLASSES =
  "liquid-control inline-flex items-center justify-center border font-medium transition-[background-color,border-color,color] disabled:cursor-not-allowed disabled:opacity-65";

const BUTTON_VARIANT_CLASSES = {
  primary:
    "border-inverse-background bg-inverse-background text-inverse-text hover:bg-text-primary hover:border-text-primary",
  "primary-soft":
    "border-border bg-subtle/80 text-text-primary hover:bg-hover hover:border-border-strong",
  secondary:
    "control-surface border-border text-text-primary hover:bg-hover hover:border-border-strong",
  warning:
    "control-surface border-border text-text-primary hover:bg-hover hover:border-border-strong",
  danger:
    "border-danger bg-danger text-inverse-text hover:bg-danger/85 hover:border-danger/85",
  "danger-ghost":
    "border-transparent text-danger hover:bg-danger/10 hover:border-danger/30",
  ghost:
    "border-transparent text-text-primary hover:bg-hover hover:border-border",
} as const;

const BUTTON_SIZE_CLASSES = {
  sm: "min-h-8 px-2.5 text-sm",
  md: "min-h-9 px-3 text-sm",
  lg: "min-h-10 px-4 text-sm",
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
