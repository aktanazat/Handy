import { lazy } from "react";
import type { ComponentType } from "react";
import {
  commandActionIcons,
  type CommandPaletteAction,
} from "./commandPaletteActions";

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
  /**
   * The name this destination ships under, wherever it is listed. There is one
   * spelling per destination: the rail and the palette both read this, so the
   * two lists cannot disagree about what a place is called.
   */
  labelKey: string;
  /** Which palette glyph names it. One glyph per concept, no glyph twice. */
  icon: keyof typeof commandActionIcons;
  /**
   * Whether the sidebar rail carries a row for it. Models is reachable from the
   * palette and from inside pages, and has never had a row.
   */
  inRail: boolean;
  component: ComponentType;
}

/**
 * Every navigation destination in the app, and the only place any of them is
 * described.
 *
 * Declaration order below is the order these are listed in — the rail takes the
 * `inRail` ones in this order, the palette takes all of them in this order. That
 * is why the order is not also a number on each entry: a second statement of one
 * fact is a second thing to keep true.
 */
export const SECTIONS_CONFIG = {
  overview: {
    labelKey: "topNav.capture",
    icon: "mic",
    inRail: true,
    component: Overview,
  },
  history: {
    labelKey: "topNav.library",
    icon: "audio",
    inRail: true,
    component: HistorySettings,
  },
  modes: {
    labelKey: "sidebar.modes",
    icon: "modes",
    inRail: true,
    component: ModesSettings,
  },
  /* A first-class destination, not a segment inside Library: this is the same
   * meetings surface the deep-link handler targets, so nothing forked. */
  meetings: {
    labelKey: "sidebar.meetings",
    icon: "video",
    inRail: true,
    component: MeetingsSettings,
  },
  settings: {
    labelKey: "sidebar.settings",
    icon: "settings",
    inRail: true,
    component: SettingsHub,
  },
  models: {
    labelKey: "sidebar.models",
    icon: "models",
    inRail: false,
    component: ModelsSettings,
  },
} as const satisfies Record<string, SectionConfig>;

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

/** Every destination, in the order the registry declares them. */
export const SECTION_ORDER =
  /* SAFETY: `SECTIONS_CONFIG` is a closed `const` literal in this module, so
   * its keys are exactly `SidebarSection`; `Object.keys` only erases that to
   * string[]. It also keeps insertion order for string keys, which is the
   * declaration order above, and that order is the point of this list. */
  Object.keys(SECTIONS_CONFIG) as SidebarSection[];

/** The rail's rows: everything except the destinations only the palette lists. */
export const RAIL_SECTIONS: readonly SidebarSection[] = SECTION_ORDER.filter(
  (section) => SECTIONS_CONFIG[section].inRail,
);

/**
 * The palette's destination rows, derived from the registry above so the palette
 * cannot name or order a destination differently from the rail.
 */
export const buildNavigationActions = (
  t: (key: string) => string,
  onNavigate: (section: SidebarSection) => void,
): CommandPaletteAction[] =>
  SECTION_ORDER.map((section) => {
    const config = SECTIONS_CONFIG[section];
    return {
      id: `nav-${section}`,
      group: "navigation",
      label: t(config.labelKey),
      icon: commandActionIcons[config.icon],
      run: () => onNavigate(section),
    };
  });
