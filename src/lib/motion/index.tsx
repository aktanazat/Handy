import React from "react";
import { LazyMotion } from "motion/react";

/* Sona's interaction layer.
 *
 * The design directive's §3 rule — 120-160ms ease-out, "no springs, no bounce"
 * — still governs everything that merely changes appearance: hover washes,
 * colour steps, focus rings. Springs are the amendment for surfaces the pointer
 * is *inside*: a dragged row, a palette answering a chord, an indicator chasing
 * a segment. There the motion is the feedback, and a fixed-duration ease cannot
 * carry the velocity the hand already put into the gesture.
 *
 * Presets and their measured tuning live in ./presets. The app-level policy
 * lives in ./provider, which is the only Motion module the eager chunk
 * contains. Everything that renders a motion element sits behind a dynamic
 * import — ./Disclosure, ui/TabsIndicator and settings/modes/ModesReorder —
 * so the measured eager cost of the whole adoption is 0 B gz. The command
 * palette was on that list until it moved to cmdk and a CSS transition.
 *
 * The measured-value law is untouched and is stricter here than in CSS:
 * theme.css kills `transition` and `animation` on a measured value, but Motion
 * writes style values frame by frame, so CSS cannot stop it. A measured value
 * may therefore never live inside a motion component at all. motion.test.tsx
 * enforces that mechanically, across the repo. */
export * from "./presets";
export { MotionProvider } from "./provider";
export type { DisclosureProps } from "./Disclosure";

/* The module specifier is the code-split boundary, so this loader is the one
 * place in the app where a dynamic import is the point rather than a
 * workaround: it resolves to a chunk the eager bundle never contains. */
const loadDomMax = () => import("./domMax").then((module) => module.default);

export interface MotionScopeProps {
  children: React.ReactNode;
  /**
   * Leave this on unless the subtree renders Motion's own `Reorder.*`
   * components: they are built out of `motion.li` internally and declare
   * `ignoreStrict`, which downgrades the guard to a console warning on every
   * render. Those subtrees are already isolated in their own async chunk, so
   * the guard has nothing left to protect and only produces noise.
   */
  strict?: boolean;
}

/**
 * Wraps a subtree that animates, and loads the feature bundle it needs.
 *
 * `strict` is the bundle guard: rendering a `motion.*` component inside throws
 * in development, because those components carry every feature Motion has and
 * would undo the split. Surfaces render `m.*` and get their features here.
 *
 * The bundle is `domMax` — animation plus drag and layout projection — because
 * three of the four surfaces need projection, and the fourth then shares an
 * already-loaded chunk instead of pulling a second, smaller one. Children
 * render immediately either way: before the chunk lands they place themselves
 * without animating, which is the correct first frame rather than a hole.
 */
export const MotionScope: React.FC<MotionScopeProps> = ({
  children,
  strict = true,
}) => (
  <LazyMotion strict={strict} features={loadDomMax}>
    {children}
  </LazyMotion>
);
