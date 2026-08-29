import React from "react";
import ResetIcon from "../icons/ResetIcon";

export interface ResetButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
}

export const ResetButton: React.FC<ResetButtonProps> = React.memo(
  ({ onClick, disabled = false, className = "", ariaLabel, children }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      className={`inline-flex min-h-8 min-w-8 items-center justify-center rounded-control border border-transparent p-1.5 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-in-out)] ${
        disabled
          ? "cursor-not-allowed text-text-tertiary opacity-70"
          : "cursor-pointer text-text-secondary hover:border-border hover:bg-hover hover:text-text-primary active:bg-pressed"
      } ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children ?? <ResetIcon />}
    </button>
  ),
);
