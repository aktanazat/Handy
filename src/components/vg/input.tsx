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
           cancelling it. */
        "h-9 w-full min-w-0 rounded-md border border-input bg-control px-3 py-1 text-base transition-colors selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground md:text-sm",
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
