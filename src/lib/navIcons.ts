import {
  Library,
  Mic,
  Package,
  Settings,
  SlidersHorizontal,
  Video,
} from "lucide-react";

/** The rail and palette both resolve destination glyphs from this map. */
export const destinationIcons = {
  overview: Mic,
  history: Library,
  modes: SlidersHorizontal,
  meetings: Video,
  settings: Settings,
  models: Package,
} as const;
