import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Kbd } from "@/components/vg/kbd";
import { SonaMark } from "./icons/SonaMark";
import {
  RAIL_SECTIONS,
  SECTIONS_CONFIG,
  type SidebarSection,
} from "./sidebarSections";
import ModelSelector from "./model-selector/ModelSelector";
import { useOsType } from "@/hooks/useOsType";

export interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  onOpenCommand: () => void;
}

/* The rail's rows come from the section registry, in its order — Capture,
 * Library, Modes, Meetings, Settings. `models` is the one destination the
 * registry marks `inRail: false`: it is reachable from the palette and from
 * within pages, exactly as before. Each row lights for exactly one section, so
 * no route carries an activeSections list any more. */

/* The wordmark is the product's name, not copy; it never localizes. */
const WORDMARK = "Sona";

/* One row, in every state it has. Inactive is a quiet grey, hover is the
 * achromatic alpha wash, and the current route is the next wash up at full
 * text contrast — no weight jump, because reflowing the label is a layout
 * change to announce a selection. Blue is spent on the focus ring alone: the
 * app's default outline is suppressed so the ring is the single indicator, not
 * a second one drawn around it. */
const NAV_ROW =
  "flex h-[32px] items-center rounded-md px-[10px] text-start text-[13px] whitespace-nowrap text-gray-900 transition-colors hover:bg-gray-alpha-100 hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none aria-[current=page]:bg-gray-alpha-200 aria-[current=page]:text-gray-1000";

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

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
  onOpenCommand,
}) => {
  const { t } = useTranslation();
  const nav = useArrowNavigation();
  const isMac = useOsType() === "macos";

  return (
    /* The rail carries the page's own surface and is closed by a hairline on
       its content edge — same fill on both sides of that line, which is what
       makes the line the whole separation. `glass-surface` is inert until the
       Material setting is Glass and the native vibrancy view is actually
       behind the window; see styles/primitives.css. The sidebar is chrome with
       the desktop behind it, which is exactly the layer the glass ruling sends
       translucent. */
    <aside className="glass-surface flex w-[220px] min-h-0 flex-none flex-col border-e border-gray-alpha-400 bg-background-200 px-[10px] pb-[10px]">
      {/* Clearance for the overlay title bar's traffic lights (the window is
          TitleBarStyle::Overlay with a hidden title); the spacer stays a live
          drag handle, like the brand row under it. Other platforms keep their
          native title bar and need only a breath. */}
      <div
        className={isMac ? "h-[38px] flex-none" : "h-2 flex-none"}
        data-tauri-drag-region
      />

      <div
        className="mb-4 flex min-h-8 flex-none items-center gap-2 px-[8px] text-gray-1000"
        data-tauri-drag-region
      >
        <SonaMark width={18} height={18} className="flex-none" />
        {/* Pinned like the magnifier: `text-sm` is 12.25px at this app's 14px
            root, which would have shrunk the wordmark from the 14px the deleted
            `.app-sidebar-wordmark` rule set. */}
        <span
          className="text-[14px] leading-[20px] font-semibold tracking-[-0.01em] whitespace-nowrap"
          data-tauri-drag-region
        >
          {WORDMARK}
        </span>
      </div>

      {/* A search field that is really a button: it opens the command palette,
          so it carries the shortcut that does the same thing instead of a
          caret. It used to keep a plate — a raised fill and a hairline — and
          the plate was plywood: background-100 is a 4% step off this rail and
          the hairline is white at 14%, so on this surface neither one was
          visible. An element that is not doing its job gets subtracted rather
          than strengthened, so the row is flat like the nav rows under it and
          the keycaps are what mark it as the chord's affordance. The global
          Cmd/Ctrl+K binding lives in App.tsx. */}
      <button
        type="button"
        className="mb-3 flex h-[32px] flex-none items-center gap-2 rounded-md px-[10px] text-gray-900 transition-colors hover:bg-gray-alpha-100 hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
        aria-label={t("commandPalette.open")}
        onClick={onOpenCommand}
      >
        {/* Pinned in px, not `size-3.5`. base.css puts the root at 14px, so
            every rem token in this app renders at 87.5% — `size-3.5` would be
            12.25px, and a glyph on a fractional box lands on half device
            pixels and blurs. Padding and gaps stay on the shared rem scale
            deliberately; only a value that draws a shape needs pinning. */}
        <Search className="size-[14px] flex-none" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-start text-[13px]">
          {t("commandPalette.open")}
        </span>
        {/* One keycap, spelling the whole chord — the reference product sets
            its search chord as a single chip, and two boxes with a seam read
            fussier than the row they decorate. */}
        <Kbd className="flex-none" aria-hidden="true">
          {isMac ? "\u2318 K" : "Ctrl K"}
        </Kbd>
      </button>

      <nav
        ref={nav.groupRef}
        onKeyDown={nav.onKeyDown}
        className="flex flex-none flex-col gap-0.5"
        aria-label={t("sidebar.navigation")}
      >
        {RAIL_SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            aria-current={section === activeSection ? "page" : undefined}
            className={NAV_ROW}
            onClick={() => onSectionChange(section)}
          >
            {t(SECTIONS_CONFIG[section].labelKey)}
          </button>
        ))}
      </nav>

      {/* The model chip, docked at the sidebar's foot. Its menu is a portalled
          popover, so the dock needs no stacking allowance, and the selector
          renders exactly one child now — the second rendering of the download
          percentage that this dock used to hide with a sibling selector was
          deleted at the source, which is where a duplicated datum belongs. */}
      <div className="mt-auto -mx-[10px] flex min-h-0 flex-col border-t border-gray-alpha-400 px-[10px] pt-2">
        <ModelSelector />
      </div>
    </aside>
  );
};
