import React from "react";

export type StatusTone =
  | "neutral"
  | "muted"
  | "success"
  | "warning"
  | "danger"
  | "info";

export interface StatusTextProps {
  tone?: StatusTone;
  /** Announce changes to assistive tech. Errors want "assertive". */
  live?: "off" | "polite" | "assertive";
  children: React.ReactNode;
  className?: string;
}

const STATUS_TONE_CLASSES = {
  neutral: "text-text-primary",
  muted: "text-text-secondary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger-strong",
  info: "text-info",
} as const;

/* State as words. No colored dots: color is a second channel here, never the
 * only one, so the sentence still reads in greyscale. */
export const StatusText: React.FC<StatusTextProps> = ({
  tone = "muted",
  live = "off",
  children,
  className = "",
}) => {
  return (
    <span
      role={live === "off" ? undefined : "status"}
      aria-live={live === "off" ? undefined : live}
      className={`text-[12.5px] leading-[18px] ${STATUS_TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
};
