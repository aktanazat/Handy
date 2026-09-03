import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/cn";

/* Three roles and two exceptions. Primary is the one scarce accent, filled;
 * secondary is a hairline on the raised surface; ghost is text with a wash
 * under the pointer. `outline` and `secondary` are one look under two names
 * the kit's callers already use — a bordered plate and a filled plate were
 * never two different answers, and shipping them as two invited a surface
 * with two competing seconds on it.
 *
 * No focus classes here. base.css paints one 2px bronze outline for the whole
 * app on `:where(button, a, …):focus-visible`, and the kit's stock recipe
 * (`outline-none` plus a 3px ring at half alpha) both cancelled it and
 * replaced it with the glow the direction rules out. */
const SECONDARY =
  "border border-border bg-surface-raised hover:bg-hover active:bg-pressed";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-accent-hover active:bg-accent-pressed",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive/60",
        outline: SECONDARY,
        secondary: SECONDARY,
        ghost: "hover:bg-hover hover:text-gray-1000 active:bg-pressed",
        link: "text-accent-strong underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
