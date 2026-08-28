import { FileAudio, FolderOpen, MessageSquare, Mic, Video } from "lucide-react";
import type { ReactNode } from "react";

const ICON_SIZE = 16;

export interface CommandPaletteAction {
  id: string;
  group: "navigation" | "actions";
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

export const commandActionIcons = {
  mic: <Mic size={ICON_SIZE} aria-hidden="true" />,
  video: <Video size={ICON_SIZE} aria-hidden="true" />,
  file: <FileAudio size={ICON_SIZE} aria-hidden="true" />,
  folder: <FolderOpen size={ICON_SIZE} aria-hidden="true" />,
  agent: <MessageSquare size={ICON_SIZE} aria-hidden="true" />,
} as const;
