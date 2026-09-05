import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";

import { cn } from "@/lib/cn";

/* A segment, not a button: this is what Library's Processed·Raw filter and the
 * two settings pickers are built from, always as `variant="outline" size="sm"`.
 * 14/21 because `text-sm` is 12.25px at this app's 14px root — HistoryToolbar
 * was already restating `text-[14px]` on every item to get out of it — and the
 * app's wash ladder on hover, where the kit dimmed the LABEL on hover
 * (`hover:text-muted-foreground`) and washed the plate with the pressed step. */
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-[14px] leading-[21px] font-medium whitespace-nowrap transition-colors hover:bg-hover hover:text-gray-1000 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none aria-invalid:border-destructive data-[state=on]:bg-pressed data-[state=on]:text-gray-1000 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-gray-alpha-400 bg-surface-raised",
      },
      size: {
        default: "h-9 min-w-9 px-2",
        sm: "h-8 min-w-8 px-1.5",
        lg: "h-10 min-w-10 px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
