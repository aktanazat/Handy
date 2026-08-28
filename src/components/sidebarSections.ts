import type { ComponentType } from "react";
import { Overview } from "./overview/Overview";
import { HistorySettings } from "./settings/history/HistorySettings";
import { MeetingsSettings } from "./settings/meetings/MeetingsSettings";
import { ModelsSettings } from "./settings/models/ModelsSettings";
import { ModesSettings } from "./settings/modes/ModesSettings";
import { SettingsHub } from "./settings/SettingsHub";

interface SectionConfig {
  labelKey: string;
  component: ComponentType;
}

export const SECTIONS_CONFIG = {
  overview: {
    labelKey: "sidebar.overview",
    component: Overview,
  },
  meetings: {
    labelKey: "sidebar.meetings",
    component: MeetingsSettings,
  },
  history: {
    labelKey: "sidebar.history",
    component: HistorySettings,
  },
  modes: {
    labelKey: "sidebar.modes",
    component: ModesSettings,
  },
  models: {
    labelKey: "sidebar.models",
    component: ModelsSettings,
  },
  settings: {
    labelKey: "sidebar.settings",
    component: SettingsHub,
  },
} as const satisfies Record<string, SectionConfig>;

export type SidebarSection = keyof typeof SECTIONS_CONFIG;
