import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
}

const INPUT_BASE_CLASSES =
  "control-surface border text-sm font-medium text-text-primary transition-colors";

const INPUT_VARIANT_CLASSES = {
  default: "min-h-9 px-3",
  compact: "min-h-9 px-3",
} as const;

export const Input: React.FC<InputProps> = ({
  className = "",
  variant = "default",
  disabled,
  ...props
}) => {
  const interactiveClasses = disabled
    ? "cursor-not-allowed opacity-75"
    : "cursor-text hover:border-border-strong";

  return (
    <input
      className={`${INPUT_BASE_CLASSES} ${INPUT_VARIANT_CLASSES[variant]} ${interactiveClasses} ${className}`}
      disabled={disabled}
      {...props}
    />
  );
};
