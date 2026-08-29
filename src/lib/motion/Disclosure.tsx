import React from "react";
import { AnimatePresence, m } from "motion/react";
import { MotionScope } from ".";
import { springGentle } from "./presets";

/* Lives apart from index.tsx on purpose: `m` and `AnimatePresence` drag in
 * Motion's element core, and index.tsx is imported eagerly by the app shell.
 * Keeping the two in one module put ~16 kB gz of animation runtime in the main
 * chunk whether anything animated or not. */

export interface DisclosureProps {
  /** The caller owns the trigger and the state; this owns the travel. */
  open: boolean;
  children: React.ReactNode;
  /** Wire the trigger's `aria-controls` to this. */
  id?: string;
  className?: string;
}

/**
 * Height-and-opacity expand/collapse on `springGentle`.
 *
 * `AnimatePresence initial={false}` means a section that is already open when
 * the page mounts is simply open — the first paint is not an animation. The
 * wrapper clips during travel because a spring on height would otherwise let
 * the content spill past the closed edge for a frame.
 */
export const Disclosure: React.FC<DisclosureProps> = ({
  open,
  children,
  id,
  className,
}) => (
  <MotionScope>
    <AnimatePresence initial={false}>
      {open ? (
        <m.div
          key="disclosure"
          id={id}
          className={className}
          style={{ overflow: "hidden" }}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={springGentle}
        >
          {children}
        </m.div>
      ) : null}
    </AnimatePresence>
  </MotionScope>
);

export default Disclosure;
