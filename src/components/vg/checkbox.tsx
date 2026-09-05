import * as React from "react";
import { CheckIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      /* 16px, pinned in px: `size-4` is 14px at this app's 14px root, which
       * left the box smaller than the label beside it. A hairline at rest and
       * the inverted plate when checked — the same ink the primary button and
       * the checked switch take, so "on" means one thing across the kit.
       *
       * The glyph's colour lives on the INDICATOR rather than on the root, so
       * the root's `currentcolor` stays ink. Tailwind's `transition-colors`
       * includes `outline-color`, and base.css's focus outline transitions
       * from whatever colour the control had: with `text-primary-foreground`
       * on the root, a checked box faded its focus ring in from WHITE on a
       * white page. Same plate, same white check, and the bronze ring now
       * animates from a visible colour. */
      className={cn(
        "peer size-[16px] shrink-0 rounded-xs border border-gray-alpha-400 bg-control transition-colors hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none aria-invalid:border-destructive data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-primary-foreground transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
