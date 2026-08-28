import React from "react";
import { useTranslation } from "react-i18next";
import { Search, Settings } from "lucide-react";
import { SonaMark } from "./icons/SonaMark";
import type { SidebarSection } from "./sidebarSections";
import ModelSelector from "./model-selector/ModelSelector";

interface TopNavProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  onOpenCommand: () => void;
}

interface TopNavRoute {
  section: SidebarSection;
  labelKey: string;
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

export const TopNav: React.FC<TopNavProps> = ({
  activeSection,
  onSectionChange,
  onOpenCommand,
}) => {
  const { t } = useTranslation();

  return (
    <header className="app-topnav">
      <div className="app-topnav-mark" data-tauri-drag-region>
        <SonaMark width={14} height={14} />
        {/* eslint-disable-next-line i18next/no-literal-string */}
        <span className="app-topnav-wordmark" data-tauri-drag-region>
          Sona
        </span>
      </div>

      <nav className="app-topnav-routes" aria-label={t("sidebar.navigation")}>
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
  );
};
