import * as React from "react";

export const ACTIVITY_CHART_HEIGHT = 72;

const CHART_WIDTH = 216;
const PLOT_LEFT = 8;
const PLOT_RIGHT = CHART_WIDTH - PLOT_LEFT;
const PLOT_TOP = 8;
const BASELINE = 66;
const PLOT_HEIGHT = BASELINE - PLOT_TOP;
const SLOT_COUNT = 7;
const BAR_WIDTH = 8;
const BAR_RADIUS = 4;
const STUB_HEIGHT = 2;
const RING_SIZE = ACTIVITY_CHART_HEIGHT;
const RING_CENTER = RING_SIZE / 2;
const RING_STROKE = 3;
const RING_RADIUS = 26.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface Point {
  x: number;
  y: number;
}

interface Domain {
  min: number;
  max: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

const sample = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

export function activitySparklineDomain(values: readonly number[]): Domain {
  if (values.length === 0) return { min: 0, max: 1 };

  let minimum = sample(values[0]);
  let maximum = minimum;
  for (let index = 1; index < values.length; index += 1) {
    const value = sample(values[index]);
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  const span = maximum - minimum;
  const padding =
    span === 0
      ? Math.max(maximum * 0.12, 1)
      : Math.max(span * 0.2, maximum * 0.12);

  return {
    min: Math.max(0, minimum - padding),
    max: maximum + padding * 1.5,
  };
}

const sparklinePoints = (values: readonly number[]): Point[] => {
  if (values.length === 0) return [];

  const domain = activitySparklineDomain(values);
  const span = domain.max - domain.min;
  const width = PLOT_RIGHT - PLOT_LEFT;

  return values.map((value, index) => ({
    x:
      values.length === 1
        ? CHART_WIDTH / 2
        : PLOT_LEFT + (index / (values.length - 1)) * width,
    y: PLOT_TOP + ((domain.max - sample(value)) / span) * PLOT_HEIGHT,
  }));
};

const point = ({ x, y }: Point): string => `${round(x)} ${round(y)}`;

const monotoneCubicSegments = (points: readonly Point[]): string => {
  if (points.length < 2) return "";

  const slopes = Array.from({ length: points.length - 1 }, (_, index) => {
    const start = points[index];
    const end = points[index + 1];
    return (end.y - start.y) / (end.x - start.x);
  });
  const tangents = Array.from({ length: points.length }, (_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes[slopes.length - 1];

    const previous = slopes[index - 1];
    const next = slopes[index];
    return previous * next <= 0 ? 0 : (2 * previous * next) / (previous + next);
  });

  let segments = "";
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const width = end.x - start.x;
    segments += ` C ${round(start.x + width / 3)} ${round(start.y + (tangents[index] * width) / 3)}, ${round(end.x - width / 3)} ${round(end.y - (tangents[index + 1] * width) / 3)}, ${point(end)}`;
  }

  return segments;
};

const roundedTopBar = (x: number, height: number): string => {
  const top = BASELINE - height;
  const radius = Math.min(BAR_RADIUS, height / 2);
  const right = x + BAR_WIDTH;

  return [
    `M ${round(x)} ${BASELINE}`,
    `V ${round(top + radius)}`,
    `Q ${round(x)} ${round(top)} ${round(x + radius)} ${round(top)}`,
    `H ${round(right - radius)}`,
    `Q ${round(right)} ${round(top)} ${round(right)} ${round(top + radius)}`,
    `V ${BASELINE}`,
    "Z",
  ].join(" ");
};

export interface ActivitySparklineProps {
  values: readonly number[];
  ariaLabel: string;
}

export function ActivitySparkline({
  values,
  ariaLabel,
}: ActivitySparklineProps) {
  const gradientId = `activity-words-area-${React.useId().replace(/:/g, "")}`;
  const points = sparklinePoints(values);
  const first = points[0];
  const last = points[points.length - 1];
  const segments = monotoneCubicSegments(points);
  const linePath = first === undefined ? "" : `M ${point(first)}${segments}`;
  const areaPath =
    first === undefined || last === undefined || points.length < 2
      ? ""
      : `M ${round(first.x)} ${BASELINE} L ${point(first)}${segments} L ${round(last.x)} ${BASELINE} Z`;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${CHART_WIDTH} ${ACTIVITY_CHART_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      className="block h-[72px] w-full overflow-visible"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1={PLOT_TOP}
          x2="0"
          y2={BASELINE}
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0%"
            stopColor="var(--color-blue-900)"
            stopOpacity="0.12"
          />
          <stop
            offset="100%"
            stopColor="var(--color-blue-900)"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      <path
        d={`M ${PLOT_LEFT} ${BASELINE} H ${PLOT_RIGHT}`}
        fill="none"
        vectorEffect="non-scaling-stroke"
        className="stroke-gray-alpha-300"
        strokeWidth={1}
      />
      {areaPath === "" ? null : (
        <path d={areaPath} fill={`url(#${gradientId})`} />
      )}
      {points.length < 2 ? null : (
        <path
          d={linePath}
          fill="none"
          vectorEffect="non-scaling-stroke"
          className="stroke-blue-900"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {last === undefined ? null : (
        <circle
          cx={round(last.x)}
          cy={round(last.y)}
          r={3.5}
          className="fill-blue-900"
        />
      )}
    </svg>
  );
}

export interface ActivityBarsProps {
  values: readonly number[];
  ariaLabel: string;
  highlightIndex?: number;
}

export function ActivityBars({
  values,
  ariaLabel,
  highlightIndex,
}: ActivityBarsProps) {
  const slots = Array.from(
    { length: SLOT_COUNT },
    (_, index) => values[index] ?? 0,
  );
  let maximum = 0;
  for (const value of slots) maximum = Math.max(maximum, sample(value));

  const gap =
    (PLOT_RIGHT - PLOT_LEFT - BAR_WIDTH * SLOT_COUNT) / (SLOT_COUNT - 1);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${CHART_WIDTH} ${ACTIVITY_CHART_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      className="block h-[72px] w-full overflow-visible"
    >
      <path
        d={`M ${PLOT_LEFT} ${BASELINE} H ${PLOT_RIGHT}`}
        fill="none"
        vectorEffect="non-scaling-stroke"
        className="stroke-gray-alpha-300"
        strokeWidth={1}
      />
      {slots.map((rawValue, index) => {
        const value = sample(rawValue);
        const height =
          value === 0 || maximum === 0
            ? STUB_HEIGHT
            : (value / maximum) * PLOT_HEIGHT;
        const x = PLOT_LEFT + index * (BAR_WIDTH + gap);
        const highlighted = index === highlightIndex;

        return (
          <path
            key={index}
            data-slot="activity-bar"
            d={roundedTopBar(x, height)}
            className={
              highlighted && value > 0 ? "fill-blue-900" : "fill-gray-alpha-300"
            }
          />
        );
      })}
    </svg>
  );
}

export interface ActivityRingProps {
  value: number;
  max: number;
  center: string;
  ariaLabel: string;
}

export function ActivityRing({
  value,
  max,
  center,
  ariaLabel,
}: ActivityRingProps) {
  const progress = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const circumference = round(RING_CIRCUMFERENCE);

  return (
    <div className="relative mx-auto size-[72px]">
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="block size-full -rotate-90"
      >
        <circle
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          fill="none"
          className="stroke-gray-alpha-300"
          strokeWidth={RING_STROKE}
        />
        <circle
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          fill="none"
          className="stroke-blue-900"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={`${round(circumference * progress)} ${circumference}`}
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-[18px] leading-none font-medium text-gray-1000 tabular-nums"
      >
        {center}
      </span>
    </div>
  );
}
