import * as React from "react";
import { cn } from "@/lib/cn";

/* A document card's two edges.
 *
 * The reference Aktan sent writes a note as three bands: a cream strip naming
 * the document, a white body carrying its text, and one quiet line at the
 * bottom offering the single thing you do to it. This file owns the two
 * strips; the body is whatever the card puts between them, on the card's own
 * `--surface-raised` fill.
 *
 * The cream is `bg-surface-sunken` — the utility Tailwind generates for
 * `--surface-inset` (#f6f3ea on Porcelain, #252220 on Ink). `bg-surface-inset`
 * looks right and compiles to nothing, which is a band with no band.
 *
 * A card that uses either of these needs `overflow-hidden`: both paint to the
 * card's edge, and without the clip the cream corners square off the radius.
 */

export interface CardBandProps {
  title: React.ReactNode;
  /** A fact about the document, right of its name. Meta tier, 13/18. */
  meta?: React.ReactNode;
  /** A colour for the meta slot — a state word that earns one. */
  metaClassName?: string;
  /** The level this band's title takes in the page outline. */
  as?: "h2" | "h3" | "h4";
  className?: string;
}

export const CardBand: React.FC<CardBandProps> = ({
  title,
  meta,
  metaClassName,
  as: Heading = "h3",
  className,
}) => (
  <header
    data-slot="card-band"
    className={cn(
      "flex items-center justify-between gap-4 border-b border-gray-alpha-400 bg-surface-sunken px-6 py-3.5",
      className,
    )}
  >
    <Heading className="min-w-0 truncate text-[14px] leading-[21px] font-medium text-gray-1000">
      {title}
    </Heading>
    {meta === undefined || meta === null ? null : (
      <span
        className={cn(
          "flex-none text-[13px] leading-[18px] text-gray-900",
          metaClassName,
        )}
      >
        {meta}
      </span>
    )}
  </header>
);

/* The one thing you do to the document, on the line below it.
 *
 * Body type in the secondary ink, so it reads as an offer rather than a
 * control: the reference's "Attach note" is a sentence at the card's bottom
 * edge, not a button parked on a reading surface. A glyph is optional and is
 * sized to the text beside it (14px) rather than given a container.
 *
 * `ring-inset`: the card clips its own overflow, so an outset ring on a
 * full-width row is drawn outside the card and never seen.
 */
export const CardFooterAction: React.FC<React.ComponentProps<"button">> = ({
  className,
  children,
  ...props
}) => (
  <button
    type="button"
    data-slot="card-footer-action"
    className={cn(
      "flex w-full cursor-pointer items-center gap-2 border-t border-gray-alpha-400 px-6 py-3 text-start text-[14px] leading-[21px] text-gray-900 transition-colors hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
      "[&_svg]:size-3.5 [&_svg]:flex-none",
      className,
    )}
    {...props}
  >
    {children}
  </button>
);
