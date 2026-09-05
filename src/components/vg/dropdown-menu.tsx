"use client";

import * as React from "react";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  );
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  );
}

/* One row recipe, shared by the four things that are all a menu row: an item,
 * a checkbox item, a radio item and a submenu trigger. The kit shipped the
 * same sentence four times in four slightly different spellings.
 *
 * 10px corners inside the panel's 16px, 14/21 type — `text-sm` is 12.25px at
 * this app's 14px root — and the app's own wash ladder under the pointer
 * rather than shadcn's `accent`, which is the *pressed* step and made a merely
 * hovered row look held down.
 *
 * `flex-wrap` plus `gap-y-0.5` is the two-line item: a description marked with
 * its own slot takes `w-full`, so it drops to a second line under the label
 * while a leading icon stays beside it. Single-line rows never wrap, so they
 * never see the row gap. */
const ITEM =
  "relative flex cursor-default flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-3 py-2 text-[14px] leading-[21px] outline-hidden transition-colors select-none focus:bg-hover active:bg-pressed data-[disabled]:pointer-events-none data-[disabled]:opacity-50 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-gray-800";

/* A floating menu, on the app's one popup shape: `--radius-panel`, the raised
 * fill, a hairline, one soft `--shadow-popover`, and `popup-motion` from
 * styles/popups.css. This was the last surface still running the kit's own
 * fade + 0.95 zoom + 8px slide, so the app had two menu entrances depending on
 * whether the menu was a Select or a DropdownMenu. `glass-surface` for the
 * same reason the Select and the Popover carry it: a menu is chrome, and
 * primitives.css frosts chrome under the Glass material. */
const PANEL =
  "glass-surface popup-motion z-50 min-w-[8rem] rounded-panel border border-gray-alpha-400 bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-popover)]";

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          PANEL,
          "max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  );
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        ITEM,
        /* Red on hover, never at rest. A menu of ordinary actions with one
         * word already shouting in red reads as a warning the reader did not
         * ask for; the reading-first rule (DECISIONS-3 2b) puts delete in a
         * menu precisely so it stops being a visible destructive control. The
         * kit's `bg-destructive/10` wash went with it — the row takes the same
         * hover as every other row, and only the word changes colour.
         *
         * `--color-danger-strong`, the 900 step, because this is danger TYPE
         * and theme.css reserves the 700 for graphics and borders: `--red-700`
         * as a word on the raised card measures 3.92:1, the 900 step 4.99:1 on
         * Porcelain and 6.62:1 on Ink. */
        "data-[inset]:pl-9 data-[variant=destructive]:focus:text-danger-strong data-[variant=destructive]:focus:[&_svg]:text-danger-strong",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(ITEM, "pr-3 pl-9", className)}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-3 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  );
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(ITEM, "pr-3 pl-9", className)}
      {...props}
    >
      <span className="pointer-events-none absolute left-3 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      /* A group heading is a Microlabel (settings/rows.tsx): 13/18 in the
       * secondary ink, sentence case, no weight of its own. The kit set it at
       * the row's own size and weight, which made a heading look like an item
       * a reader could press. */
      className={cn(
        "px-3 py-1.5 text-[13px] leading-[18px] text-gray-900 data-[inset]:pl-9",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1.5 my-1.5 h-px bg-gray-alpha-400", className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-[13px] leading-[18px] text-gray-800",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        ITEM,
        "data-[inset]:pl-9 data-[state=open]:bg-hover",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        PANEL,
        "origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

/* The second line of a two-line item — the reference's "Next plot beat" with
 * "Create one context aware card" under it. Meta type, so the label keeps the
 * row and this explains it; `w-full` is what makes the row's `flex-wrap` break
 * the line. Its own colour, so a destructive row's red stays on the action's
 * name rather than spreading over the sentence describing it. */
function DropdownMenuItemDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-item-description"
      className={cn(
        "w-full text-[13px] leading-[18px] text-gray-900",
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuItemDescription,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
