import * as React from "react";
import { cn } from "@/lib/cn";

const WIDTH = 100;
const HEIGHT = 64;
const GAP = 2;
const CORNER_RADIUS = 2;

const round = (value: number): number => Math.round(value * 1000) / 1000;

export interface BarsProps extends Omit<React.ComponentProps<"svg">, "values"> {
  values: readonly number[];
  ariaLabel: string;
  highlightIndex?: number;
}

export function Bars({
  values,
  ariaLabel,
  highlightIndex,
  className,
  ...props
}: BarsProps) {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, value);

  const barWidth =
    values.length === 0
      ? 0
      : (WIDTH - GAP * Math.max(0, values.length - 1)) / values.length;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={cn("block h-16 w-full overflow-visible", className)}
      {...props}
    >
      {values.map((value, index) => {
        const height =
          maximum === 0 ? 0 : (Math.max(0, value) / maximum) * HEIGHT;
        return (
          <rect
            key={index}
            x={round(index * (barWidth + GAP))}
            y={round(HEIGHT - height)}
            width={round(barWidth)}
            height={round(height)}
            rx={CORNER_RADIUS}
            ry={CORNER_RADIUS}
            className={cn(
              "transition-[height,y] duration-150 motion-reduce:transition-none",
              index === highlightIndex
                ? "fill-blue-700"
                : "fill-gray-alpha-400",
            )}
          />
        );
      })}
    </svg>
  );
}
