import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { SonaMark } from "./icons/SonaMark";
import type { SidebarSection } from "./sidebarSections";
import ModelSelector from "./model-selector/ModelSelector";
import { KbdChord } from "./ui";
import { useOsType } from "@/hooks/useOsType";

export interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  onOpenCommand: () => void;
}

interface SidebarRoute {
  section: SidebarSection;
  labelKey: string;
}

/* The five destinations, in the order the design doc fixed: Capture, Library,
 * Modes, Meetings, Settings. Meetings was a segment inside Library under the
 * old top bar; it is a first-class destination here and lands on the same
 * meetings surface the deep-link handler targets, so nothing forked. Settings
 * is the row that replaced the old gear icon and opens the same SettingsHub.
 * `models` keeps no row: it is reachable from the palette and from within
 * pages, exactly as before. Each row lights for exactly one section now, so
 * no route carries an activeSections list any more. */
const SIDEBAR_ROUTES: readonly SidebarRoute[] = [
  { section: "overview", labelKey: "topNav.capture" },
  { section: "history", labelKey: "topNav.library" },
  { section: "modes", labelKey: "sidebar.modes" },
  { section: "meetings", labelKey: "sidebar.meetings" },
  { section: "settings", labelKey: "sidebar.settings" },
];

/* The wordmark is the product's name, not copy; it never localizes. */
const WORDMARK = "Sona";

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
  const commandKeys = useOsType() === "macos" ? ["\u2318", "K"] : ["Ctrl", "K"];

  return (
    /* `glass-surface` is inert until the Material setting is Glass and the
       native vibrancy view is actually behind the window; see
       styles/primitives.css. The sidebar is chrome with the desktop behind it,
       which is exactly the layer the glass ruling sends translucent. */
    <aside className="app-sidebar glass-surface">
      {/* Clearance for the overlay title bar's traffic lights (the window is
          TitleBarStyle::Overlay with a hidden title); the spacer stays a live
          drag handle, like the brand row under it. */}
      <div className="app-sidebar-drag" data-tauri-drag-region />

      <div className="app-sidebar-brand" data-tauri-drag-region>
        <SonaMark width={18} height={18} />
        <span className="app-sidebar-wordmark" data-tauri-drag-region>
          {WORDMARK}
        </span>
      </div>

      {/* A search field that is really a button: it opens the command palette,
          so it carries the shortcut that does the same thing instead of a
          caret. The global Cmd/Ctrl+K binding lives in App.tsx, untouched. */}
      <button
        type="button"
        className="app-sidebar-search"
        aria-label={t("commandPalette.open")}
        onClick={onOpenCommand}
      >
        <Search aria-hidden="true" />
        <span className="app-sidebar-search-label">
          {t("commandPalette.open")}
        </span>
        <KbdChord keys={commandKeys} className="app-sidebar-search-keys" />
      </button>

      <nav
        ref={nav.groupRef}
        onKeyDown={nav.onKeyDown}
        className="app-sidebar-nav"
        aria-label={t("sidebar.navigation")}
      >
        {SIDEBAR_ROUTES.map((route) => (
          <button
            key={route.section}
            type="button"
            aria-current={route.section === activeSection ? "page" : undefined}
            className="app-sidebar-item"
            onClick={() => onSectionChange(route.section)}
          >
            {t(route.labelKey)}
          </button>
        ))}
      </nav>

      {/* The model chip, docked at the sidebar's foot. Its menu opens upward
          from here; placement lives in model-selector.css. */}
      <div className="app-sidebar-model">
        <ModelSelector />
      </div>
    </aside>
  );
};
