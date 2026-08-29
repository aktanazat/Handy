import React from "react";
import { Kbd } from "@/components/ui";
import type { InstrumentCell } from "./instrument";

export interface InstrumentStripProps {
  cells: InstrumentCell[];
  /** Accessible name for the strip as a whole. */
  label: string;
}

/* The instrument strip: four equal cells of 44px, separated by hairline rules,
 * no fill, no border, no radius. Each cell is a microlabel over a mono data
 * line — the metadata inspector rotated horizontal.
 *
 * Two columns rather than four across, because four does not fit: the INPUT
 * cell's own payload (device, rate, channels, peak/rms) needs ~55 monospace
 * characters, and a quarter of the 1040px page is 26. Two equal columns over
 * two 44px rows keeps every cell the same size and every measurement visible;
 * see overview.css for the arithmetic.
 *
 * Rendered as a definition list because that is exactly what it is: four terms
 * and their current values. The separators are drawn in CSS so they never land
 * in the accessible name or in a translation.
 *
 * `.snap-measured` sits on each value, not on the cell: every one of them
 * reports a measurement, and a transitioned measurement displays intermediate
 * values the backend never reported. Scoping it to the value leaves any future
 * live meter in the same cell free to animate at frame rate. */
export const InstrumentStrip: React.FC<InstrumentStripProps> = ({
  cells,
  label,
}) => (
  <dl className="ov-strip" aria-label={label}>
    {cells.map((cell) => (
      <div className="ov-strip-cell" data-cell={cell.key} key={cell.key}>
        <dt className="ov-strip-label microlabel">{cell.label}</dt>
        <dd className="ov-strip-value" title={cell.reading}>
          {cell.keys !== undefined && cell.keys.length > 0 && (
            <span className="ov-strip-keys">
              {cell.keys.map((key, index) => (
                <Kbd key={`${key}-${index}`}>{key}</Kbd>
              ))}
            </span>
          )}
          {cell.data.map((datum) => (
            <span
              className="ov-strip-datum type-data snap-measured"
              data-absent={datum.absent}
              data-identity={datum.identity}
              key={datum.key}
            >
              {datum.text}
            </span>
          ))}
        </dd>
      </div>
    ))}
  </dl>
);
