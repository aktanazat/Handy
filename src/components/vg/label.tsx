import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      /* A field's name is a row title: 14/21 medium, the same recipe
       * settings/rows.tsx uses for the label beside a control. `text-sm` was
       * 12.25px at this app's 14px root — a label set smaller than the value
       * it names. `leading-none` went with it: a zero line box put the word
       * off-centre against the 36px control it labels. */
      className={cn(
        "flex items-center gap-2 text-[14px] leading-[21px] font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
