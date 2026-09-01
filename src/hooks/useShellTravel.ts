import { useCallback, useState } from "react";
import type { TransitionEvent } from "react";

/* The shell's one clock.
 *
 * Opening and closing the chat used to be two transitions on two boxes — the
 * rail's width and the column's width — which is two clocks, a stagger between
 * the page's two edges, and a full layout of everything in the page on every
 * frame of both. The shell moves one thing now: the chat column's frame slides
 * on `transform`, over a rail and a page that are already at the width they
 * will end at. Nothing is laid out while it travels.
 *
 * That leaves one piece of state, which is what this owns: whether the shell is
 * mid-travel. It is the hook the CSS in styles/shell.css keys off to put
 * `will-change` on the frame for exactly as long as the frame is moving, and to
 * hold every other transition in the window still while it does — a hover wash
 * or a colour fade that lands mid-slide is a second clock the reader can see.
 */

/** The registered custom property the shell transitions for this travel. */
const SHELL_CLOCK = "--shell-chat-offset";

/**
 * Marks the shell as travelling while the chat column is on its way.
 *
 * The flag is raised during the render that flips `open`, not in an effect, so
 * the gate attribute and the frame's new transform land in the same commit and
 * therefore the same frame: `will-change` that arrives a frame after the
 * transform has already started is `will-change` that promoted nothing.
 *
 * It is lowered by the shell's own `transitionend` for the registered travel
 * property. Nothing else can lower it and there is no timer: a press either
 * starts that transition or, under `prefers-reduced-motion`, starts no
 * transition at all. Interrupting a travel with a second press re-targets the
 * shell's same clock, so the flag stays up across the reversal and comes down
 * when the new target arrives.
 */
export const useShellTravel = (open: boolean) => {
  const [moving, setMoving] = useState(false);
  const [settled, setSettled] = useState(open);

  if (settled !== open) {
    setSettled(open);
    /* This branch only runs after a client-side press (or its controlled
     * equivalent), never while static markup is rendered. */
    setMoving(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  const onTransitionEnd = useCallback((event: TransitionEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== SHELL_CLOCK) return;
    setMoving(false);
  }, []);

  return { moving, onTransitionEnd };
};
