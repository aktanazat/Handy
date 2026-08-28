import React, { useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { GeneralSettings } from "./general/GeneralSettings";
import { PrivacySettings } from "./privacy/PrivacySettings";
import { AgentsSettings } from "./agents/AgentsSettings";
import { AdvancedSettings } from "./advanced/AdvancedSettings";
import { AboutSettings } from "./about/AboutSettings";
import { DebugSettings } from "./debug/DebugSettings";

type SettingsTab =
  | "general"
  | "privacy"
  | "agents"
  | "advanced"
  | "about"
  | "debug";

const TAB_COMPONENTS = {
  general: GeneralSettings,
  privacy: PrivacySettings,
  agents: AgentsSettings,
  advanced: AdvancedSettings,
  about: AboutSettings,
  debug: DebugSettings,
} satisfies Record<SettingsTab, ComponentType>;

const BASE_TABS: readonly SettingsTab[] = [
  "general",
  "privacy",
  "agents",
  "advanced",
  "about",
];

export const SettingsHub: React.FC = () => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const tabs = useMemo(
    () =>
      settings?.debug_mode ? [...BASE_TABS, "debug" as const] : BASE_TABS,
    [settings?.debug_mode],
  );
  const visibleTab = tabs.includes(activeTab) ? activeTab : "general";
  const ActiveSettings = TAB_COMPONENTS[visibleTab];

  return (
    <div className="settings-hub">
      <nav className="settings-local-nav" aria-label={t("settings.hub.navigation")}>
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            aria-current={visibleTab === tab ? "page" : undefined}
            onClick={() => setActiveTab(tab)}
          >
            {t(`settings.hub.tabs.${tab}`)}
          </button>
        ))}
      </nav>
      <ActiveSettings />
    </div>
  );
};
