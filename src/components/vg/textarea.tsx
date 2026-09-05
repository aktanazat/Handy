import * as React from "react";

import { cn } from "@/lib/cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      /* Three lines of body before it grows: 3 × 21px, plus the 7px padding
       * top and bottom and the two hairlines. `min-h-16` was 56px, which is
       * two and a half lines — a field that asks for a paragraph should not
       * look like it wants a phrase. `field-sizing-content` grows it from
       * there, so this is the floor and not the height.
       *
       * The `text-base md:text-sm` pair is gone for the same reason as the
       * Input's: at the locked 900px window the `md` override always applied,
       * so every textarea in the app rendered at 12.25px. */
      className={cn(
        "flex field-sizing-content min-h-[79px] w-full rounded-md border border-gray-alpha-400 bg-control px-3 py-2 text-[14px] leading-[21px] transition-colors placeholder:text-gray-800 hover:bg-control-hover disabled:cursor-not-allowed disabled:bg-control-disabled disabled:opacity-50 motion-reduce:transition-none aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
