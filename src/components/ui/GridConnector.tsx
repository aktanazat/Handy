import React from "react";

export interface GridConnectorProps {
  orientation?: "horizontal" | "vertical";
  /** Dashed reads as "these two things relate"; solid reads as "these two
   *  things are one region". */
  dashed?: boolean;
  className?: string;
}

/* Geist's guide-line motif: a 1px rule with a dot marker at each end, used to
 * tie two sections together where a heading would be too loud and bare
 * whitespace too quiet. Purely decorative, so it stays out of the a11y tree. */
export const GridConnector: React.FC<GridConnectorProps> = ({
  orientation = "horizontal",
  dashed = false,
  className = "",
}) => (
  <div
    aria-hidden="true"
    className={`grid-connector ${className}`}
    data-orientation={orientation}
    data-dashed={dashed ? "true" : undefined}
  />
);
