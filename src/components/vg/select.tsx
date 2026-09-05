"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      /* The value box is a BLOCK that truncates, not a flex row. Stock shadcn
       * sets both `line-clamp-1` and `flex` on it; flex wins the display race,
       * `text-overflow` cannot apply to a flex container's anonymous items, and
       * the trigger's inherited `whitespace-nowrap` plus line-clamp's
       * `overflow: hidden` then HARD-CUT a long value mid-word with no ellipsis
       * (observed: "Use this mode's local model" rendered as "…local mode",
       * a different real word). `min-w-0` lets it shrink inside the trigger's
       * own flex row. A value that pairs an icon with text keeps them inline;
       * give it its own flex wrapper if it needs a gap.
       *
       * The kit's 3px translucent focus ring is gone so base.css's 2px bronze
       * `--focus-outline` applies, which is what every other control in the
       * app draws. Focus is an outline here, never a glow.
       *
       * The fill is the control step (`--surface-raised`), not `transparent`:
       * a closed select is a control sitting on a card, and a transparent one
       * only showed as a hairline. That also retires the `dark:bg-input/30`
       * pair, which painted a *border* colour at 30% as a surface — the
       * clearest sign the kit had no control fill token to reach for. */
      className={cn(
        "flex w-fit items-center justify-between gap-2 rounded-control border border-gray-alpha-400 bg-surface-raised px-3 py-2 text-[14px] leading-[21px] whitespace-nowrap transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none aria-invalid:border-destructive data-[placeholder]:text-gray-800 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:block *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[14px] [&_svg:not([class*='text-'])]:text-gray-800",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-[14px] text-gray-800" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        /* Same surface as the popover, for the same reason: a menu is chrome.
         * `glass-surface` under Glass, --surface-raised under Solid,
         * --radius-panel, one soft --shadow-popover, and the app's one popup
         * shape from styles/popups.css in place of the kit's fade + 0.95 zoom
         * + 8px slide. The `slide-in-from-*` set is what `popup-motion` reads
         * `data-side` for, so it goes; the `position === "popper"` nudges stay,
         * because those are the resting offset from the trigger rather than
         * motion. */
        className={cn(
          "glass-surface popup-motion relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-panel border bg-popover text-popover-foreground shadow-[var(--shadow-popover)]",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1.5",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      /* A group heading is a Microlabel (settings/rows.tsx): 13/18 secondary,
       * the same recipe the dropdown menu's label takes, so the app's two menu
       * surfaces read alike. `text-xs` rendered at 10.5px against this app's
       * 14px root. */
      className={cn(
        "px-3 py-1.5 text-[13px] leading-[18px] text-gray-900",
        className,
      )}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      /* The dropdown menu's row language, so the app's menu surfaces read
       * alike: 10px corners inside the panel's 16px, 14/21 type, and the hover
       * wash rather than shadcn's `accent`, which is the pressed step.
       * `pr-8`/`pl-3` are physical because the check indicator they clear is
       * pinned with `right-3`; both stay as found. */
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-2 pr-8 pl-3 text-[14px] leading-[21px] outline-hidden transition-colors select-none focus:bg-hover active:bg-pressed data-[disabled]:pointer-events-none data-[disabled]:opacity-50 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-gray-800 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-3 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        "pointer-events-none -mx-1.5 my-1.5 h-px bg-gray-alpha-400",
        className,
      )}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
