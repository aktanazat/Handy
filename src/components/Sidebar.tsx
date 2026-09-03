import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Kbd } from "@/components/vg/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/vg/tooltip";
import { destinationIcons } from "@/lib/navIcons";
import { cn } from "@/lib/cn";
import { getLanguageDirection } from "@/lib/utils/rtl";
import { SonaMark } from "./icons/SonaMark";
import {
  RAIL_SECTIONS,
  SECTIONS_CONFIG,
  type SidebarSection,
} from "./sidebarSections";
import { useOsType } from "@/hooks/useOsType";

export interface SidebarProps {
  /**
   * Whether the chat column has the width. Collapsed, the rail is 48pt of
   * glyphs and the page keeps 512pt beside the chat; expanded it is the
   * 220pt rail with every destination named.
   */
  collapsed: boolean;
  currentSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  onOpenCommand: () => void;
  /**
   * The short-lived outgoing rail uses the same complete rendering as the
   * active one, but its separate slot keeps geometry readers on the structural
   * rail and gives the shell CSS a precise crossfade target.
   */
  dataSlot?: "sidebar" | "sidebar-ghost";
  /** Makes the outgoing visual rail unavailable to pointer and assistive use. */
  decorative?: boolean;
  className?: string;
}

/* The rail's rows come from the section registry. Modes and Models stay
 * available through the command palette without occupying permanent rail
 * space. Each visible row compares against the shell's current section. */

/* The wordmark is the product's name, not copy; it never localizes. */
const WORDMARK = "Sona";

/* One row, in every state it has. The selected border and fill are applied
 * directly from currentSection, while blue remains reserved for focus. */
const NAV_ROW =
  "flex items-center rounded-md border border-transparent text-[13px] whitespace-nowrap text-gray-900 transition-colors hover:bg-gray-alpha-100 hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none";

/* The two shapes a row takes. The glyph square is the named row with its words
 * clipped off, not a second navigation: same 32pt height, same radius, same
 * selected border and fill, same focus ring. Pinned in px because base.css
 * puts the root at 14px, so `size-8` would be a 28pt box on a 32pt row.
 *
 * 8 + 32 + 8 is the rail's 48. */
const NAV_ROW_NAMED = "h-[32px] gap-2 px-[10px] text-start";
const NAV_ROW_GLYPH = "size-[32px] flex-none justify-center";

/* The chat frame owns the shell's one transition. The rail and the content
 * pane take their final widths in the press frame, which is what stops every
 * item in the flexing page from reflowing for 150ms; `transition-none` on the
 * rail makes a later broad utility unable to accidentally turn it back into a
 * second clock. */

/** Moves focus between sibling nav rows on arrow keys. Tab order keeps every
 * row, so this is an addition to normal tabbing, not a replacement. Up/Down
 * because the list is vertical; the keys need no RTL mirroring. */
const useArrowNavigation = () => {
  const groupRef = useRef<HTMLElement>(null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;

    const buttons = Array.from(
      groupRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const current = buttons.findIndex(
      (button) => button === document.activeElement,
    );
    if (current === -1) return;

    event.preventDefault();
    buttons[(current + step + buttons.length) % buttons.length].focus();
  };

  return { groupRef, onKeyDown };
};

interface RowNameProps {
  collapsed: boolean;
  /** Radix sides are physical; the rail is not. */
  side: "left" | "right";
  name: string;
  children: React.ReactElement;
}

/**
 * The name of a row whose name is not on screen, and nothing at all when it
 * is.
 *
 * Radix opens on focus as well as hover and points the trigger's
 * `aria-describedby` at the sentence while it is open, so a collapsed rail
 * stays readable by keyboard rather than pointer-only. Each row keeps its
 * `aria-label` either way: the tooltip is how a sighted reader recovers the
 * word, not how the row is named.
 */
const RowName: React.FC<RowNameProps> = ({
  collapsed,
  side,
  name,
  children,
}) =>
  collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{name}</TooltipContent>
    </Tooltip>
  ) : (
    children
  );

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  currentSection,
  onSectionChange,
  onOpenCommand,
  dataSlot = "sidebar",
  decorative = false,
  className,
}) => {
  const { t, i18n } = useTranslation();
  const nav = useArrowNavigation();
  const isMac = useOsType() === "macos";
  const side = getLanguageDirection(i18n.language) === "rtl" ? "left" : "right";

  return (
    /* The rail carries the page's own surface and is closed by a hairline on
       its content edge — same fill on both sides of that line, which is what
       makes the line the whole separation. `glass-surface` is inert until the
       Material setting is Glass and the native vibrancy view is actually
       behind the window; see styles/primitives.css. The sidebar is chrome with
       the desktop behind it, which is exactly the layer the glass ruling sends
       translucent.

       Collapsed it is the same rail at 48pt: the destinations, in the same
       order, in the same states, with their words in tooltips instead of
       beside their glyphs. `overflow-hidden` keeps the named form from leaking
       across the glyph form during the one press-frame width swap. */
    <aside
      data-slot={dataSlot}
      aria-hidden={decorative ? true : undefined}
      inert={decorative}
      className={cn(
        "glass-surface flex min-h-0 flex-none flex-col overflow-hidden border-e border-gray-alpha-400 bg-background-200 pb-[10px] transition-none",
        collapsed ? "w-[48px] px-[8px]" : "w-[220px] px-[10px]",
        className,
      )}
    >
      {/* Clearance for the overlay title bar's traffic lights (the window is
          TitleBarStyle::Overlay with a hidden title); the spacer stays a live
          drag handle, like the brand row under it. Other platforms keep their
          native title bar and need only a breath. */}
      <div
        className={isMac ? "h-[38px] flex-none" : "h-2 flex-none"}
        data-tauri-drag-region
      />

      {/* Collapsed, the mark is the brand: 48pt has no room for a wordmark, and
          a truncated product name is worse than none. */}
      <div
        className={cn(
          "mb-4 flex min-h-8 flex-none items-center text-gray-1000",
          collapsed ? "justify-center" : "gap-2 px-[8px]",
        )}
        data-tauri-drag-region
      >
        <SonaMark width={18} height={18} className="flex-none" />
        {!collapsed && (
          /* Pinned like the magnifier: `text-sm` is 12.25px at this app's 14px
             root, which would have shrunk the wordmark from the 14px the
             deleted `.app-sidebar-wordmark` rule set. */
          <span
            className="text-[14px] leading-[20px] font-semibold tracking-[-0.01em] whitespace-nowrap"
            data-tauri-drag-region
          >
            {WORDMARK}
          </span>
        )}
      </div>

      {/* A search field that is really a button: it opens the command palette,
          so it carries the shortcut that does the same thing instead of a
          caret. It used to keep a plate — a raised fill and a hairline — and
          the plate was plywood: background-100 is a 4% step off this rail and
          the hairline is white at 14%, so on this surface neither one was
          visible. An element that is not doing its job gets subtracted rather
          than strengthened, so the row is flat like the nav rows under it and
          the keycaps are what mark it as the chord's affordance. The global
          Cmd/Ctrl+K binding lives in App.tsx.

          Collapsed it keeps the magnifier and loses the keycap: the chord is a
          thing the row was advertising, and there is no width to advertise it
          in. The binding itself is unaffected. */}
      <RowName
        collapsed={collapsed}
        side={side}
        name={t("commandPalette.open")}
      >
        <button
          type="button"
          className={cn(
            "mb-3 flex flex-none items-center rounded-md text-gray-900 transition-colors hover:bg-gray-alpha-100 hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none",
            collapsed ? NAV_ROW_GLYPH : NAV_ROW_NAMED,
          )}
          aria-label={t("commandPalette.open")}
          onClick={onOpenCommand}
        >
          {/* Pinned in px, not `size-3.5`. base.css puts the root at 14px, so
              every rem token in this app renders at 87.5% — `size-3.5` would be
              12.25px, and a glyph on a fractional box lands on half device
              pixels and blurs. Padding and gaps stay on the shared rem scale
              deliberately; only a value that draws a shape needs pinning. */}
          <Search className="size-[14px] flex-none" aria-hidden="true" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-start text-[13px]">
                {t("commandPalette.open")}
              </span>
              {/* One keycap, spelling the whole chord — the reference product
                  sets its search chord as a single chip, and two boxes with a
                  seam read fussier than the row they decorate. */}
              <Kbd className="flex-none" aria-hidden="true">
                {isMac ? "\u2318 K" : "Ctrl K"}
              </Kbd>
            </>
          )}
        </button>
      </RowName>

      <nav
        ref={nav.groupRef}
        onKeyDown={nav.onKeyDown}
        className="flex flex-none flex-col gap-0.5"
        aria-label={t("sidebar.navigation")}
      >
        {RAIL_SECTIONS.map((section) => {
          const DestinationIcon = destinationIcons[section];
          const label = t(SECTIONS_CONFIG[section].labelKey);
          const current = section === currentSection;
          return (
            <RowName
              key={section}
              collapsed={collapsed}
              side={side}
              name={label}
            >
              <button
                type="button"
                aria-current={current ? "page" : undefined}
                aria-label={label}
                className={cn(
                  NAV_ROW,
                  collapsed ? NAV_ROW_GLYPH : NAV_ROW_NAMED,
                  current &&
                    "border-gray-alpha-400 bg-background-100 text-gray-1000",
                )}
                onClick={() => onSectionChange(section)}
              >
                <DestinationIcon
                  aria-hidden="true"
                  className="size-4 flex-none"
                />
                {!collapsed && label}
              </button>
            </RowName>
          );
        })}
      </nav>
    </aside>
  );
};
