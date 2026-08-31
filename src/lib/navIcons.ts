import {
  Library,
  Mic,
  Package,
  Settings,
  SlidersHorizontal,
  Video,
  Users,
} from "lucide-react";

/** The rail and palette both resolve destination glyphs from this map. */
export const destinationIcons = {
  overview: Mic,
  history: Library,
  modes: SlidersHorizontal,
  meetings: Video,
  people: Users,
  settings: Settings,
  models: Package,
} as const;
