import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, Settings } from "lucide-react";
import { SonaMark } from "./icons/SonaMark";
import { SECTIONS_CONFIG, type SidebarSection } from "./sidebarSections";
import ModelSelector from "./model-selector/ModelSelector";
import { KbdChord, Tabs } from "./ui";
import { useOsType } from "@/hooks/useOsType";

export interface TopNavProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  onOpenCommand: () => void;
}

interface TopNavRoute {
  section: SidebarSection;
  labelKey: string;
  /** Sections that light this route up. Library covers two of them. */
  activeSections: readonly SidebarSection[];
}

const TOPNAV_ROUTES: readonly TopNavRoute[] = [
  {
    section: "overview",
    labelKey: "topNav.capture",
    activeSections: ["overview"],
  },
  {
    section: "history",
    labelKey: "topNav.library",
    activeSections: ["history", "meetings"],
  },
  {
    section: "modes",
    labelKey: "sidebar.modes",
    activeSections: ["modes"],
  },
];

/** Sections reachable from a route, shown as a second row when there is more
 * than one. Library is the only route today that holds two sections. */
const LIBRARY_SECTIONS = [
  "history",
  "meetings",
] as const satisfies readonly SidebarSection[];

const subsectionsFor = (
  section: SidebarSection,
): readonly SidebarSection[] | null =>
  section === "history" || section === "meetings" ? LIBRARY_SECTIONS : null;

/** Moves focus between sibling nav buttons on arrow keys. Tab order keeps
 * every button, so this is an addition to normal tabbing, not a replacement. */
const useArrowNavigation = () => {
  const groupRef = useRef<HTMLElement>(null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
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

export const TopNav: React.FC<TopNavProps> = ({
  activeSection,
  onSectionChange,
  onOpenCommand,
}) => {
  const { t } = useTranslation();
  const routes = useArrowNavigation();
  const subsections = subsectionsFor(activeSection);
  const commandKeys = useOsType() === "macos" ? ["\u2318", "K"] : ["Ctrl", "K"];

  return (
    <>
      {/* `glass-surface` is inert until the Material setting is Glass and the
          native vibrancy view is actually behind the window; see
          styles/primitives.css. The nav is one of the two surfaces that get the
          real backdrop-filter, because app content genuinely scrolls under it. */}
      <header className="app-topnav glass-surface" data-tauri-drag-region>
        <div className="app-topnav-mark" data-tauri-drag-region>
          <SonaMark width={16} height={16} />
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <span className="app-topnav-wordmark" data-tauri-drag-region>
            Sona
          </span>
        </div>

        <nav
          ref={routes.groupRef}
          onKeyDown={routes.onKeyDown}
          className="app-topnav-routes"
          aria-label={t("sidebar.navigation")}
        >
          {TOPNAV_ROUTES.map((route) => {
            const isActive = route.activeSections.includes(activeSection);
            return (
              <button
                key={route.section}
                type="button"
                aria-current={isActive ? "page" : undefined}
                className="app-topnav-route"
                onClick={() => onSectionChange(route.section)}
              >
                {t(route.labelKey)}
              </button>
            );
          })}
        </nav>

        <div className="app-topnav-spacer" data-tauri-drag-region />

        <div className="app-topnav-actions">
          <div className="app-topnav-model">
            <ModelSelector />
          </div>
          <button
            type="button"
            className="app-topnav-search"
            aria-label={t("commandPalette.open")}
            onClick={onOpenCommand}
          >
            <Search aria-hidden="true" />
            <span className="app-topnav-search-label">
              {t("commandPalette.open")}
            </span>
            <KbdChord keys={commandKeys} className="app-topnav-search-keys" />
          </button>
          <button
            type="button"
            className="app-topnav-icon-button"
            aria-current={activeSection === "settings" ? "page" : undefined}
            aria-label={t("sidebar.settings")}
            title={t("sidebar.settings")}
            onClick={() => onSectionChange("settings")}
          >
            <Settings aria-hidden="true" />
          </button>
        </div>
      </header>

      {subsections && (
        <SectionNav
          sections={subsections}
          activeSection={activeSection}
          onSectionChange={onSectionChange}
        />
      )}
    </>
  );
};

interface SectionNavProps {
  sections: readonly SidebarSection[];
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

/* The Library strip is the same segmented primitive as Processed/Raw inside the
 * page, so the active section is filled and bordered rather than carried by a
 * 4/255 wash: two words with no visible difference between them is not a state
 * readout. Tabs brings its own roving tabindex, which is why this strip does
 * not use the route row's arrow-key helper. */
const SectionNav: React.FC<SectionNavProps> = ({
  sections,
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();

  return (
    <div className="app-subnav">
      <Tabs
        variant="secondary"
        className="app-subnav-inner"
        label={t("topNav.library")}
        value={activeSection}
        onChange={(id) => {
          const next = sections.find((section) => section === id);
          if (next) onSectionChange(next);
        }}
        items={sections.map((section) => ({
          id: section,
          label: t(SECTIONS_CONFIG[section].labelKey),
        }))}
      />
    </div>
  );
};
