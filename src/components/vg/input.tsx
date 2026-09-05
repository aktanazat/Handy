import * as React from "react";

import { cn } from "@/lib/cn";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        /* The app's own control ladder: the raised fill, a hairline, and the
           hover wash. No focus classes — base.css owns the one 2px bronze
           outline, and the kit's `outline-none` plus half-alpha ring was
           cancelling it.

           14/21, stated once. The kit's `text-base md:text-sm` pair was two
           sizes for one field, and at the locked 900px window the `md`
           override always won — so every input in the app was set at 12.25px
           no matter what its base class said. The placeholder is the tertiary
           tier: quieter than the value a reader typed, still 5.18:1 on the
           card. */
        "h-9 w-full min-w-0 rounded-md border border-gray-alpha-400 bg-control px-3 py-1 text-[14px] leading-[21px] transition-colors selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[14px] file:font-medium file:text-gray-1000 placeholder:text-gray-800 motion-reduce:transition-none",
        "hover:bg-control-hover",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-control-disabled disabled:opacity-50",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
