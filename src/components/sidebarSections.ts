import { lazy } from "react";
import type { ComponentType } from "react";

/* Every section is a route-level chunk. The shell, the top bar and the
 * command palette ship in the entry bundle; a section's page code arrives
 * when it is first opened, behind the Suspense skeleton in App.tsx.
 *
 * The dynamic imports below are the split points themselves: a static import
 * would pull all six pages back into the entry bundle, which is the thing
 * this file exists to prevent. Each loader re-wraps the page's named export
 * as a default, which is the shape React.lazy resolves. */

const Overview = lazy(async () => ({
  default: (await import("./overview/Overview")).Overview,
}));

const HistorySettings = lazy(async () => ({
  default: (await import("./settings/history/HistorySettings")).HistorySettings,
}));

const MeetingsSettings = lazy(async () => ({
  default: (await import("./settings/meetings/MeetingsSettings"))
    .MeetingsSettings,
}));

const ModelsSettings = lazy(async () => ({
  default: (await import("./settings/models/ModelsSettings")).ModelsSettings,
}));

const ModesSettings = lazy(async () => ({
  default: (await import("./settings/modes/ModesSettings")).ModesSettings,
}));

const SettingsHub = lazy(async () => ({
  default: (await import("./settings/SettingsHub")).SettingsHub,
}));

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
