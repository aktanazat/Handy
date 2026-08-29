import React from "react";
import { m } from "motion/react";
import { MotionScope, springSnappy } from "@/lib/motion";

/* The moving mark, in its own module so the animation runtime stays out of the
 * eager chunk. Tabs renders a plain mark until this lands, which is the correct
 * first frame: the right segment is already marked, it simply has not learned
 * to travel yet. */

export interface TabsIndicatorProps {
  /** Shared across every segment of one strip, unique per strip. */
  layoutId: string;
  className: string;
}

export const TabsIndicator: React.FC<TabsIndicatorProps> = ({
  layoutId,
  className,
}) => (
  <MotionScope>
    <m.span
      layoutId={layoutId}
      className={className}
      transition={springSnappy}
      aria-hidden="true"
    />
  </MotionScope>
);

export default TabsIndicator;
