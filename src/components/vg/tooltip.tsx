import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        /* A tooltip is text, so it stays solid and dense: no `glass-surface`
         * here. One line of meta type (13/18) on the inverted plate at
         * --radius-control — the control step, because a tooltip is the size
         * of a control rather than of a panel — with 8/4 padding instead of
         * the kit's 10.5/5.25. Blur behind a two-word label buys nothing and
         * costs legibility, and `text-xs` rendered at 10.5px against this
         * app's 14px root.
         *
         * `popup-motion` (styles/popups.css) is the app's one popup shape. The
         * kit ran `animate-in` unconditionally here rather than on
         * `data-[state=open]`, so a tooltip re-ran its entrance on any style
         * recalculation that re-applied the class. */
        className={cn(
          "popup-motion z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-control bg-foreground px-2 py-1 text-[13px] leading-[18px] text-balance text-background",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
