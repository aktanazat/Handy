import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/cn";

/* A chip is a hairline with a word in it, never a filled slab. The reference
 * sets its status words in 11px mono, uppercase, tracked out to 0.08em inside
 * an unfilled pill — which reads as an annotation on the thing beside it
 * rather than as a second object competing with it. That is the default here
 * because every default-variant caller in this app is a status word
 * ("Recommended", "Active", "In use"). The filled variants stay for the two
 * that mean something louder. */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 font-mono text-[11px] leading-4 tracking-[0.08em] whitespace-nowrap uppercase transition-colors [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-gray-alpha-400 text-gray-900",
        secondary:
          /* A secondary chip needs a real hairline against both canvases. */
          "border-gray-alpha-400 bg-background-200 text-gray-900 [a&]:hover:bg-gray-alpha-100",
        destructive:
          "bg-destructive text-white [a&]:hover:bg-destructive/90 dark:bg-destructive/60",
        outline: "border-border text-foreground [a&]:hover:bg-hover",
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
