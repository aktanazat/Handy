import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/cn";

/* Three roles and two exceptions. Primary is the inverted pair, filled — ink
 * on Porcelain, paper on Ink, the one full-strength plate on a surface;
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
  "border border-gray-alpha-400 bg-surface-raised hover:bg-hover active:bg-pressed";

/* Type is stated in px, never `text-sm`: base.css sets a 14px root, so the rem
 * scale renders at 87.5% and `text-sm` is 12.25px — below this app's body. A
 * button label is body-sized (14/21); only `xs`, which exists to sit inside a
 * row of meta, steps down to 13/18.
 *
 * No width in this string, at any size. `className="w-full"` is the contract
 * for a full-bleed action — the dialog footer's single primary, the reference's
 * black "Import files" plate — and a fixed width here would fight it. */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-[14px] leading-[21px] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed",
        /* The 900 step, not the 700, and theme.css already said so: "danger
         * *type* and solid destructive fills use --color-danger-strong". The
         * kit filled with `--red-700` (#e5484d), which carries white type at
         * **3.92:1** — under AA on the one button in the app whose press
         * cannot be undone. `--color-danger-strong` (#c93c42) measures 4.99:1,
         * and its hover and pressed steps mix toward the ink, so contrast only
         * rises under the pointer.
         *
         * Dark keeps the muted plate it had. There `--error` is #ff6369, a
         * light red meant for danger *type* on a dark card, and a solid
         * #ff6369 plate carries white at 2.90:1 — worse than what it replaces.
         * The 60% wash over --surface-raised measures 7.4:1, and 70% under the
         * pointer 6.29:1, so the dark pair also gets louder rather than
         * dimmer. `dark:` is attribute-scoped here (globals.css pins it to
         * `[data-theme="dark"]`), so this follows the app's theme, not the
         * OS appearance. */
        destructive:
          "bg-danger-strong text-white hover:bg-danger-hover active:bg-danger-pressed dark:bg-destructive/60 dark:hover:bg-destructive/70 dark:active:bg-destructive/80",
        outline: SECONDARY,
        secondary: SECONDARY,
        ghost: "hover:bg-hover hover:text-gray-1000 active:bg-pressed",
        link: "text-accent-strong underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-[13px] leading-[18px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
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
