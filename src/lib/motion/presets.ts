import type { Transition } from "motion/react";

/* Sona's interaction physics.
 *
 * The design directive's §3 rule — 120-160ms ease-out, "no springs, no bounce"
 * — still governs everything that merely changes appearance: hover washes,
 * colour steps, focus rings. Springs are the amendment for surfaces the pointer
 * is *inside*: a dragged row, a palette answering a chord, an indicator chasing
 * a segment. There the motion is the feedback, and a fixed-duration ease cannot
 * carry the velocity the hand already put into the gesture.
 *
 * The measured-value law is untouched and is stricter here than in CSS:
 * `.snap-measured` kills `transition` and `animation`, but Motion writes style
 * values frame by frame, so CSS cannot stop it. A measured value therefore may
 * never live inside a motion component at all. motion.test.tsx enforces that
 * mechanically across the repo.
 *
 * Every number below was measured, not guessed: motion.test.tsx drives Motion's
 * own spring generator and asserts each preset reaches 99% of its travel inside
 * the 150-350ms band and overshoots by no more than 1%. */

/** Rest-to-rest tuning, quoted from the generator sweep in motion.test.tsx. */
export interface SpringMeasurement {
  /** ms until the value is permanently within 1% of target. */
  readonly arrival99: number;
  /** ms until Motion's own rest thresholds report `done`. */
  readonly settle: number;
  /** Peak excursion past the target, as a percentage of the travel. */
  readonly overshoot: number;
}

/* UI state changing under a direct command: the palette answering Cmd-K, the
 * tab indicator arriving at the segment you clicked. Stiff and heavily damped
 * — 99% at 178ms, 0.39% overshoot — so it reads as "instant, with weight"
 * rather than as a bounce. */
export const springSnappy = {
  type: "spring",
  stiffness: 700,
  damping: 46,
  mass: 1,
} as const satisfies Transition;

export const SPRING_SNAPPY_MEASURED: SpringMeasurement = {
  arrival99: 178,
  settle: 235,
  overshoot: 0.39,
};

/* Longer travel that nobody is holding: a disclosure opening, a list closing a
 * gap. Softer than snappy because the distance is larger and a stiff spring
 * over a long distance looks like a jump-cut. 99% at 257ms, 0.13% overshoot. */
export const springGentle = {
  type: "spring",
  stiffness: 400,
  damping: 36,
  mass: 1,
} as const satisfies Transition;

export const SPRING_GENTLE_MEASURED: SpringMeasurement = {
  arrival99: 257,
  settle: 339,
  overshoot: 0.13,
};

/* Release from a gesture. Damping is on the high side of the other two on
 * purpose: this spring inherits the pointer's velocity, and a fling at
 * 2400px/s through the snappy tuning rings visibly. Here the same fling
 * overshoots 0.21% and arrives *faster* than from rest (140ms vs 220ms) —
 * the throw is carried, not fought. */
export const springDrag = {
  type: "spring",
  stiffness: 660,
  damping: 48,
  mass: 1,
} as const satisfies Transition;

export const SPRING_DRAG_MEASURED: SpringMeasurement = {
  arrival99: 220,
  settle: 301,
  overshoot: 0,
};

export const SPRING_PRESETS = {
  springSnappy,
  springGentle,
  springDrag,
} as const;

export const SPRING_MEASUREMENTS = {
  springSnappy: SPRING_SNAPPY_MEASURED,
  springGentle: SPRING_GENTLE_MEASURED,
  springDrag: SPRING_DRAG_MEASURED,
} as const;
