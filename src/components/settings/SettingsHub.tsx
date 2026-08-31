import React, { useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { cn } from "@/lib/cn";
import { PAGE_COLUMN } from "./rows";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/vg/tabs";
import { GeneralSettings } from "./general/GeneralSettings";
import { PrivacySettings } from "./privacy/PrivacySettings";
import { AgentsSettings } from "./agents/AgentsSettings";
import { WorkflowsSettings } from "./workflows/WorkflowsSettings";
import { AdvancedSettings } from "./advanced/AdvancedSettings";
import { AboutSettings } from "./about/AboutSettings";
import { DebugSettings } from "./debug/DebugSettings";

type SettingsTab =
  | "general"
  | "privacy"
  | "agents"
  | "workflows"
  | "advanced"
  | "about"
  | "debug";

const TAB_COMPONENTS = {
  general: GeneralSettings,
  privacy: PrivacySettings,
  agents: AgentsSettings,
  workflows: WorkflowsSettings,
  advanced: AdvancedSettings,
  about: AboutSettings,
  debug: DebugSettings,
} satisfies Record<SettingsTab, ComponentType>;

const BASE_TABS: readonly SettingsTab[] = [
  "general",
  "privacy",
  "agents",
  "workflows",
  "advanced",
  "about",
];

/* The strip is a hairline the width of the window with an underline mark under
 * the active tab. Its labels sit on the same 760px column as the page below,
 * so the first tab and the page title share a left edge.
 *
 * The mark is the kit's own `line` variant, not a hand-rolled bottom border:
 * that variant parks its bar one pixel under the list, which is exactly where
 * this container's hairline is, so the mark reads as a break in the rule. */
export const SettingsHub: React.FC = () => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const tabs = useMemo(
    () => (settings?.debug_mode ? [...BASE_TABS, "debug" as const] : BASE_TABS),
    [settings?.debug_mode],
  );
  const visibleTab = tabs.includes(activeTab) ? activeTab : "general";

  return (
    <Tabs
      data-testid="settings-hub"
      value={visibleTab}
      onValueChange={(id) => {
        const next = tabs.find((tab) => tab === id);
        if (next) setActiveTab(next);
      }}
      className="gap-0"
    >
      <div className="border-b border-gray-alpha-400">
        <TabsList
          variant="line"
          aria-label={t("settings.hub.navigation")}
          className={cn(PAGE_COLUMN, "justify-start gap-6")}
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="flex-none px-0 text-sm font-normal text-gray-900 hover:text-gray-1000 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none data-[state=active]:text-gray-1000 after:bg-gray-1000"
            >
              {t(`settings.hub.tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => {
        const ActiveSettings = TAB_COMPONENTS[tab];
        return (
          <TabsContent key={tab} value={tab}>
            <ActiveSettings />
          </TabsContent>
        );
      })}
    </Tabs>
  );
};
