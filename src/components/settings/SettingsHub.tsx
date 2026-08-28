import React, { useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { Tabs, type TabItem } from "@/components/ui";
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

/* One panel element is reused across tabs, so every tab points `aria-controls`
 * at the same id and the panel names the tab that filled it. */
const PANEL_ID = "settings-tabpanel";

export const SettingsHub: React.FC = () => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const tabs = useMemo(
    () => (settings?.debug_mode ? [...BASE_TABS, "debug" as const] : BASE_TABS),
    [settings?.debug_mode],
  );
  const visibleTab = tabs.includes(activeTab) ? activeTab : "general";
  const items = useMemo<TabItem[]>(
    () =>
      tabs.map((tab) => ({
        id: tab,
        label: t(`settings.hub.tabs.${tab}`),
        panelId: PANEL_ID,
      })),
    [tabs, t],
  );
  const ActiveSettings = TAB_COMPONENTS[visibleTab];

  return (
    <div className="settings-hub">
      <div className="border-b border-border pb-2">
        <Tabs
          items={items}
          value={visibleTab}
          onChange={(id) => {
            const next = tabs.find((tab) => tab === id);
            if (next) setActiveTab(next);
          }}
          label={t("settings.hub.navigation")}
        />
      </div>
      {/* Every panel holds focusable controls, so the panel itself stays out
       * of the tab order rather than becoming an extra stop. */}
      <div id={PANEL_ID} role="tabpanel" aria-labelledby={`tab-${visibleTab}`}>
        <ActiveSettings />
      </div>
    </div>
  );
};
