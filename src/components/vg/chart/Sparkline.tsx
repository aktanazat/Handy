import * as React from "react";
import { cn } from "@/lib/cn";

const WIDTH = 100;
const HEIGHT = 64;
const PADDING = 2;

const round = (value: number): number => Math.round(value * 1000) / 1000;

interface Point {
  x: number;
  y: number;
}

const makePoints = (values: readonly number[]): Point[] => {
  if (values.length === 0) return [];

  let maximumMagnitude = 1;
  for (const value of values) {
    if (Number.isFinite(value)) {
      maximumMagnitude = Math.max(maximumMagnitude, Math.abs(value));
    }
  }

  // Non-finite samples render as zero so the series keeps its x positions.
  const normalize = (value: number): number =>
    Number.isFinite(value) ? value / maximumMagnitude : 0;
  let minimum = normalize(values[0]);
  let maximum = minimum;
  for (let index = 1; index < values.length; index += 1) {
    const value = normalize(values[index]);
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  const chartHeight = HEIGHT - PADDING * 2;
  const span = maximum - minimum;
  return values.map((value, index) => {
    const normalized = normalize(value);
    return {
      x:
        values.length === 1 ? WIDTH / 2 : (index / (values.length - 1)) * WIDTH,
      y:
        span === 0
          ? HEIGHT / 2
          : PADDING + ((maximum - normalized) / span) * chartHeight,
    };
  });
};

export interface SparklineProps
  extends Omit<React.ComponentProps<"svg">, "values"> {
  values: readonly number[];
  ariaLabel: string;
  area?: boolean;
}

export function Sparkline({
  values,
  ariaLabel,
  area = false,
  className,
  ...props
}: SparklineProps) {
  const points = makePoints(values);
  const polyline = points
    .map(({ x, y }) => `${round(x)},${round(y)}`)
    .join(" ");
  const lastPoint = points[points.length - 1];
  const areaPath =
    points.length === 0
      ? ""
      : `M ${round(points[0].x)} ${HEIGHT} L ${points
          .map(({ x, y }) => `${round(x)} ${round(y)}`)
          .join(" L ")} L ${round(lastPoint?.x ?? 0)} ${HEIGHT} Z`;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={cn("block h-16 w-full overflow-visible", className)}
      {...props}
    >
      {area && areaPath !== "" ? (
        <path d={areaPath} className="fill-gray-alpha-100" />
      ) : null}
      {polyline === "" ? null : (
        <polyline
          points={polyline}
          fill="none"
          vectorEffect="non-scaling-stroke"
          className="stroke-gray-900"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {lastPoint === undefined ? null : (
        <circle
          cx={round(lastPoint.x)}
          cy={round(lastPoint.y)}
          r={2}
          vectorEffect="non-scaling-stroke"
          className="fill-background-100 stroke-gray-900"
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
}
