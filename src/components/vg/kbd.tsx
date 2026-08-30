/* Geist's product keycap, not the editorial one: 20px tall, 4px of horizontal
 * padding, 12px text, hairline border on the raised surface, sans face (not
 * mono — the only place Geist sets a key in sans), gray-800 ink. One <kbd> per
 * physical key; join a chord by placing several in a KbdGroup.
 *
 * Those four numbers are pinned in px rather than written as h-5/px-1/text-xs
 * because styles/base.css sets a 14px root, which would render the rem scale
 * at 87.5% — a 17.5px cap with 10.5px text. `whitespace-nowrap` because a
 * multi-word cap ("Left Option", which keyCombinationParts spells out) wraps
 * inside the fixed height and spills out of the box. */
import { cn } from "@/lib/cn";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-[20px] w-fit min-w-[20px] items-center justify-center gap-1 rounded-[4px] border bg-background-100 px-[4px] font-sans text-[12px] leading-none font-medium whitespace-nowrap text-gray-800 select-none",
        "[&_svg:not([class*='size-'])]:size-3",
        "[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
