import React, { Suspense, lazy, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { CommandPaletteAction } from "./commandPaletteActions";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
}

/* The chord's chunk. Nothing about the palette is needed until it is summoned,
 * and it is the surface that carries Motion's animation runtime into this part
 * of the app, so the whole thing loads on first open and then stays: the
 * surface has to remain mounted across `open` for its exit spring to have
 * anything to play. */
const CommandPaletteSurface = lazy(() => import("./CommandPaletteDialog"));

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  actions,
}) => {
  const [version, setVersion] = useState("");
  const [summoned, setSummoned] = useState(false);

  useEffect(() => {
    if (open) setSummoned(true);
  }, [open]);

  useEffect(() => {
    let active = true;
    void getVersion()
      .then((appVersion) => {
        if (active) setVersion(appVersion);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!summoned) return null;

  return (
    <Suspense fallback={null}>
      <CommandPaletteSurface
        open={open}
        onClose={onClose}
        actions={actions}
        version={version}
      />
    </Suspense>
  );
};
