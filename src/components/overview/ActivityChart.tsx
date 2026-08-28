import React from "react";
import type { ActivityDay } from "./analytics";
import { peakDictations } from "./analytics";

/* The activity band. There is no chart library in this app and none is being
 * added, so this is plain SVG: one column per local calendar day, no axes, no
 * gridlines, no animation. The scale is carried by the caption row the page
 * renders underneath, which is why nothing here draws a tick.
 *
 * The geometry lives in viewBox units and the element scales with
 * preserveAspectRatio="none". Bars are square-cornered rectangles, so the
 * non-uniform scale has nothing to distort. */

const SLOT = 8;
const BAR = 6;
const HEIGHT = 100;
/* A day with no dictations still gets a stub, so the row of stubs reads as
 * the baseline and the empty days stay countable. */
const STUB = 2;
const MIN_BAR = 4;

export interface ActivityChartProps {
  days: ActivityDay[];
  /** Sentence read in place of the graphic, for example "42 dictations over
   * 30 days, busiest day 6." */
  summary: string;
  /** Native tooltip for one column. */
  dayTitle: (day: ActivityDay) => string;
}

export const ActivityChart: React.FC<ActivityChartProps> = ({
  days,
  summary,
  dayTitle,
}) => {
  const peak = peakDictations(days);
  const width = days.length * SLOT - (SLOT - BAR);

  return (
    <svg
      className="ov-chart"
      role="img"
      aria-label={summary}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      preserveAspectRatio="none"
    >
      {days.map((day, index) => {
        const height =
          day.dictations === 0
            ? STUB
            : Math.max(MIN_BAR, (day.dictations / peak) * HEIGHT);

        return (
          <rect
            key={day.localDate}
            className="ov-chart-bar"
            data-empty={day.dictations === 0 ? "true" : undefined}
            x={index * SLOT}
            y={HEIGHT - height}
            width={BAR}
            height={height}
          >
            <title>{dayTitle(day)}</title>
          </rect>
        );
      })}
    </svg>
  );
};
