import React from "react";
/* `framer-motion`, not `motion/react`: the `motion/react` entry does
 * `import * as fm from "framer-motion"` and binds `motion` and `m` at module
 * scope, so importing anything at all from it pins the whole element runtime.
 * This module is the one Motion module the eager chunk contains, so it imports
 * a single React context and nothing else. Measured: 0 B of eager growth,
 * against 10.3 kB when `LazyMotion` lived here too. */
import { MotionConfigContext } from "framer-motion";

/**
 * Mounted once, around the whole main window: the interaction layer's policy,
 * and nothing that costs bytes.
 *
 * `reducedMotion: "user"` hands the decision to the OS. Motion then resolves
 * every positional key — x, y, scale, height, width, top/left/right/bottom —
 * instantly, and leaves opacity free to cross-fade, which is the behaviour the
 * accessibility setting actually asks for. It is declared here, above every
 * surface, because a per-surface copy is a per-surface chance to forget it.
 *
 * The feature bundles are NOT here: each animating surface wraps itself in
 * `MotionScope`, which loads them on demand. See ./index.tsx.
 */
export const MotionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const inherited = React.useContext(MotionConfigContext);
  const config = React.useMemo(
    () => ({ ...inherited, reducedMotion: "user" as const }),
    [inherited],
  );
  return (
    <MotionConfigContext.Provider value={config}>
      {children}
    </MotionConfigContext.Provider>
  );
};

export default MotionProvider;
