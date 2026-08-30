import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export type ModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "verifying"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";

export interface ModelStatusButtonProps extends React.ComponentProps<"button"> {
  status: ModelStatus;
  displayText: string;
  /** 0-100 while a download is in flight, otherwise null. */
  progress?: number | null;
}

/**
 * Model switcher trigger, docked at the foot of the sidebar rail.
 *
 * Status is carried by the label text and, while downloading, by a hairline
 * rule on the chip's own bottom edge. No status dot: the words already say
 * what is happening, and the error state shifts the label to danger so it
 * reads in greyscale too.
 *
 * `min-w-0` on the label is load-bearing, not decoration: a flex item defaults
 * to `min-width: auto`, refuses to shrink below its content, and pushes the
 * caret onto a second line. The rail gives this chip 204px.
 */
const ModelStatusButton: React.FC<ModelStatusButtonProps> = ({
  status,
  displayText,
  progress = null,
  className,
  ...props
}) => (
  <button
    type="button"
    data-status={status}
    title={displayText}
    className={cn(
      "relative inline-flex min-h-11 w-full items-center gap-1.5 rounded-md px-2",
      "text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000",
      "aria-expanded:bg-gray-alpha-200 aria-expanded:text-gray-1000",
      "focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none",
      status === "error" && "text-red-900",
      className,
    )}
    {...props}
  >
    <span className="min-w-0 flex-1 truncate text-start text-[12px]">
      {displayText}
    </span>
    <ChevronDown aria-hidden="true" className="size-3 flex-none" />
    {progress === null ? null : (
      <span
        aria-hidden="true"
        className="absolute inset-x-2 bottom-1 h-0.5 rounded-full bg-gray-alpha-200"
      >
        <span
          className="block h-full rounded-full bg-blue-700"
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </span>
    )}
  </button>
);

export default ModelStatusButton;
