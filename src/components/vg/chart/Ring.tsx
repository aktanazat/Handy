import * as React from "react";
import { cn } from "@/lib/cn";

const SIZE = 64;
const CENTER = SIZE / 2;
const STROKE_WIDTH = 6;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const round = (value: number): number => Math.round(value * 1000) / 1000;

export interface RingProps extends React.ComponentProps<"div"> {
  value: number;
  max: number;
  ariaLabel: string;
  monochrome?: boolean;
  center?: React.ReactNode;
}

export function Ring({
  value,
  max,
  ariaLabel,
  monochrome = false,
  center,
  className,
  ...props
}: RingProps) {
  const progress = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const valueLength = round(CIRCUMFERENCE * progress);
  const circumference = round(CIRCUMFERENCE);

  return (
    <div className={cn("relative size-16", className)} {...props}>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="block size-full -rotate-90"
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="stroke-gray-alpha-200"
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${valueLength} ${circumference}`}
          className={cn(
            "transition-[stroke-dasharray] duration-150 motion-reduce:transition-none",
            monochrome ? "stroke-gray-1000" : "stroke-blue-700",
          )}
        />
      </svg>
      {center === undefined ? null : (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center font-mono text-[18px] font-medium text-gray-1000 tabular-nums"
        >
          {center}
        </span>
      )}
    </div>
  );
}
