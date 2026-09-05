import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/cn";

/* A chip is a hairline with a word in it, never a filled slab. Sentence-case
 * SF at meta size — the same 13/18 a Microlabel and a FactChip take in
 * settings/rows.tsx — inside an unfilled 10px box, so a status word beside a
 * title reads as an annotation on the title rather than as a second object
 * competing with it.
 *
 * What that replaces: 12px mono, uppercase, tracked out to 0.08em, in a pill.
 * Two locked rules said no to it. DECISIONS-2 holds the app to SF with no
 * `font-mono` and no uppercase microlabels; theme.css says the pill radius is
 * for status dots, the HUD card and toggle tracks, "never on a badge that
 * carries metadata". Every default-variant caller in this app is a metadata
 * word — "Recommended", "Active", "In use", "Custom" — so the default was
 * breaking both rules on every settings surface at once. The strings are
 * already sentence case in the catalogue; dropping `uppercase` is all it takes
 * to read them as written.
 *
 * One fill, and it is the cream inset: `secondary` is the highlighted chip,
 * the reference's own way of marking one row of metadata as the live one.
 * `destructive` keeps its red plate for the two places a chip has to shout. */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2 py-0.5 text-[13px] leading-[18px] whitespace-nowrap transition-colors motion-reduce:transition-none [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-gray-alpha-400 text-gray-900",
        secondary:
          /* The cream band, at chip scale: a fill that says "this one" without
             a second hue. Its hairline stays, or the chip loses its edge
             against the card on Porcelain, where cream and white are two
             steps apart. */
          "border-gray-alpha-400 bg-surface-sunken text-gray-900 [a&]:hover:bg-hover",
        destructive:
          /* The 900 step for the fill, as theme.css asks for solid destructive
             plates: white on `--red-700` is 3.92:1, and this chip's 13px is
             not large text. Dark keeps the muted wash, where the light red
             would carry white at 2.90:1. Same pair as the Button's. */
          "bg-danger-strong text-white [a&]:hover:bg-danger-hover dark:bg-destructive/60 dark:[a&]:hover:bg-destructive/70",
        outline: "border-gray-alpha-400 text-gray-1000 [a&]:hover:bg-hover",
        ghost: "[a&]:hover:bg-hover",
        link: "text-accent-strong underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
