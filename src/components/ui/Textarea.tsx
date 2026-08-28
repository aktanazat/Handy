import React from "react";

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "compact";
}

const TEXTAREA_BASE_CLASSES =
  "control-surface resize-y border text-start text-sm font-medium text-text-primary transition-[background-color,border-color] hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-65";

const TEXTAREA_VARIANT_CLASSES = {
  default: "min-h-24 px-3 py-2",
  compact: "min-h-20 px-2 py-1.5",
} as const;

export const Textarea: React.FC<TextareaProps> = ({
  className = "",
  variant = "default",
  ...props
}) => {
  return (
    <textarea
      className={`${TEXTAREA_BASE_CLASSES} ${TEXTAREA_VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
};
