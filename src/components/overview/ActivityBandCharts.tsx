import * as React from "react";

export const ACTIVITY_CHART_HEIGHT = 84;

const CHART_WIDTH = 216;
const PLOT_LEFT = 8;
const PLOT_RIGHT = CHART_WIDTH - PLOT_LEFT;
const PLOT_TOP = 8;
const BASELINE = 58;
const PLOT_HEIGHT = BASELINE - PLOT_TOP;
const SLOT_COUNT = 7;
const BAR_WIDTH = 8;
const BAR_RADIUS = BAR_WIDTH / 3;
const STUB_HEIGHT = 2;
const WEEKDAY_LABEL_Y = 78;

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
      className="block h-[84px] w-full overflow-visible"
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
            stopColor="var(--color-accent-strong)"
            stopOpacity="0.12"
          />
          <stop
            offset="100%"
            stopColor="var(--color-accent-strong)"
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
          className="stroke-accent-strong"
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
          className="fill-accent-strong"
        />
      )}
    </svg>
  );
}

export interface ActivityBarsProps {
  values: readonly number[];
  weekdayLabels: readonly string[];
  ariaLabel: string;
}

export function ActivityBars({
  values,
  weekdayLabels,
  ariaLabel,
}: ActivityBarsProps) {
  const gradientId = `activity-dictations-bar-${React.useId().replace(/:/g, "")}`;
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
      className="block h-[84px] w-full overflow-visible"
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
          <stop offset="0%" stopColor="var(--color-accent-strong)" />
          <stop
            offset="100%"
            stopColor="var(--color-accent-strong)"
            stopOpacity="0.4"
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
      {slots.map((rawValue, index) => {
        const value = sample(rawValue);
        const x = PLOT_LEFT + index * (BAR_WIDTH + gap);

        return (
          <React.Fragment key={index}>
            {value === 0 ? (
              <rect
                data-slot="activity-bar"
                x={round(x)}
                y={BASELINE - STUB_HEIGHT}
                width={BAR_WIDTH}
                height={STUB_HEIGHT}
                className="fill-gray-alpha-300"
              />
            ) : (
              <path
                data-slot="activity-bar"
                data-active="true"
                d={roundedTopBar(x, (value / maximum) * PLOT_HEIGHT)}
                fill={`url(#${gradientId})`}
              />
            )}
            <text
              aria-hidden="true"
              x={round(x + BAR_WIDTH / 2)}
              y={WEEKDAY_LABEL_Y}
              textAnchor="middle"
              className="fill-[var(--gray-a-700)] text-[9px]"
            >
              {weekdayLabels[index] ?? ""}
            </text>
          </React.Fragment>
        );
      })}
    </svg>
  );
}

export interface ActivityWeekDay {
  label: string;
  active: boolean;
  today?: boolean;
}

export interface ActivityWeekProps {
  days: readonly ActivityWeekDay[];
  ariaLabel: string;
}

export function ActivityWeek({ days, ariaLabel }: ActivityWeekProps) {
  const slots = Array.from({ length: SLOT_COUNT }, (_, index) => days[index]);

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="mx-auto flex h-[84px] w-full max-w-[216px] items-end justify-between px-[8px] pb-[2px]"
    >
      {slots.map((day, index) => (
        <div
          key={index}
          data-slot="activity-streak-day"
          data-active={day?.active || undefined}
          data-today={day?.today || undefined}
          className="flex flex-col items-center gap-[7px]"
        >
          <span
            aria-hidden="true"
            className={`size-[10px] rounded-full ${
              day?.active ? "bg-accent-strong" : "bg-gray-alpha-300"
            }${day?.today ? " outline outline-1 outline-accent-strong/50 outline-offset-2" : ""}`}
          />
          <span
            aria-hidden="true"
            className="text-[9px] leading-3 text-gray-800"
          >
            {day?.label ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}
