import React from "react";

type ModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "verifying"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";

interface ModelStatusButtonProps {
  status: ModelStatus;
  displayText: string;
  isDropdownOpen: boolean;
  onClick: () => void;
  className?: string;
}

const getStatusClasses = (status: ModelStatus): string => {
  switch (status) {
    case "loading":
    case "downloading":
    case "verifying":
    case "extracting":
      return "text-text-secondary";
    case "error":
      return "text-danger";
    default:
      return "text-text-secondary";
  }
};

/**
 * Compact model switcher trigger for the top nav. Status is conveyed with
 * text color, not a status dot: busy states pulse the label, errors go
 * danger. The label truncates so the nav bar never clips it.
 */
const ModelStatusButton: React.FC<ModelStatusButtonProps> = ({
  status,
  displayText,
  isDropdownOpen,
  onClick,
  className = "",
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="listbox"
      aria-expanded={isDropdownOpen}
      title={displayText}
      className={`flex h-[28px] max-w-full items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-medium transition-colors hover:bg-hover hover:text-text-primary ${getStatusClasses(status)} ${className}`}
    >
      <span className="max-w-[108px] truncate">{displayText}</span>
      <svg
        className={`h-3 w-3 shrink-0 text-text-tertiary transition-transform ${
          isDropdownOpen ? "rotate-180" : ""
        }`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>
  );
};

export default ModelStatusButton;
