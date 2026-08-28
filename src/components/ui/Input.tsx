import React from "react";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
  /** Marks the field invalid and wires aria-invalid for assistive tech. */
  invalid?: boolean;
}

const INPUT_BASE_CLASSES =
  "control-surface border text-[13px] font-medium text-text-primary transition-[background-color,border-color] duration-150 ease-out placeholder:text-text-tertiary";

const INPUT_VARIANT_CLASSES = {
  default: "min-h-9 px-3",
  compact: "min-h-8 px-2",
} as const;

export const Input: React.FC<InputProps> = ({
  className = "",
  variant = "default",
  invalid = false,
  disabled,
  ...props
}) => {
  const stateClasses = disabled
    ? "cursor-not-allowed bg-control-disabled text-text-disabled"
    : invalid
      ? "cursor-text border-danger-strong hover:border-danger-strong"
      : "cursor-text hover:border-border-strong active:bg-control-active";

  return (
    <input
      className={`${INPUT_BASE_CLASSES} ${INPUT_VARIANT_CLASSES[variant]} ${stateClasses} ${className}`}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      {...props}
    />
  );
};
