import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, Settings } from "lucide-react";
import { SonaMark } from "./icons/SonaMark";
import { SECTIONS_CONFIG, type SidebarSection } from "./sidebarSections";
import ModelSelector from "./model-selector/ModelSelector";

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

  return (
    <>
      <header className="app-topnav" data-tauri-drag-region>
        <div className="app-topnav-mark" data-tauri-drag-region>
          <SonaMark width={14} height={14} />
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
            className="app-topnav-icon-button"
            aria-label={t("commandPalette.open")}
            title={t("commandPalette.open")}
            onClick={onOpenCommand}
          >
            <Search aria-hidden="true" />
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

const SectionNav: React.FC<SectionNavProps> = ({
  sections,
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const group = useArrowNavigation();

  return (
    <nav
      className="app-subnav"
      aria-label={t("topNav.library")}
      ref={group.groupRef}
      onKeyDown={group.onKeyDown}
    >
      <div className="app-subnav-inner">
        {sections.map((section) => (
          <button
            key={section}
            type="button"
            aria-current={section === activeSection ? "page" : undefined}
            className="app-subnav-item"
            onClick={() => onSectionChange(section)}
          >
            <span>{t(SECTIONS_CONFIG[section].labelKey)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};
