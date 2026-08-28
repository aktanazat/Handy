import React from "react";
import { ChevronDown } from "lucide-react";

export type ModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "verifying"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";

/** Inline style carrying the download fraction through to CSS. */
interface ProgressStyle extends React.CSSProperties {
  "--model-chip-progress": string;
}

export interface ModelStatusButtonProps {
  status: ModelStatus;
  displayText: string;
  isDropdownOpen: boolean;
  onClick: () => void;
  /** 0-100 while a download is in flight, otherwise null. */
  progress?: number | null;
}

/**
 * Model switcher trigger in the top bar. Status is carried by the label text
 * and, while downloading, by a hairline progress rule under it. No status
 * dot: the words already say what is happening, and the error state shifts
 * the label to danger so it reads in greyscale too.
 */
const ModelStatusButton: React.FC<ModelStatusButtonProps> = ({
  status,
  displayText,
  isDropdownOpen,
  onClick,
  progress = null,
}) => {
  const progressStyle: ProgressStyle | undefined =
    progress === null
      ? undefined
      : { "--model-chip-progress": `${Math.max(0, Math.min(100, progress))}%` };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="listbox"
      aria-expanded={isDropdownOpen}
      data-status={status}
      title={displayText}
      className="model-chip"
    >
      <span className="model-chip-label">{displayText}</span>
      <ChevronDown className="model-chip-caret" aria-hidden="true" />
      {progressStyle && (
        <span className="model-chip-progress" style={progressStyle}>
          <span />
        </span>
      )}
    </button>
  );
};

export default ModelStatusButton;
