import { flushSync } from "react-dom";

/**
 * Runs a whole-view swap through the View Transitions API when the engine and
 * the person's motion preference both allow it, and plainly when they do not.
 *
 * Scope is deliberately narrow: top-level route changes only. A list that
 * reorders uses FLIP on `transform` instead — View Transitions snapshot the
 * whole document region, which is the wrong tool and the wrong cost for moving
 * rows inside a list.
 *
 * Both gates are real on Sona's target, not defensive padding:
 *  - WKWebView inherits Safari's engine, and same-document transitions shipped
 *    in Safari 18. `tauri.conf.json` sets `minimumSystemVersion: 10.15`, whose
 *    system WebKit predates that by years, so the API genuinely may not exist.
 *  - `prefers-reduced-motion` is honoured everywhere including WebKit, and an
 *    unrequested cross-fade of the entire window is exactly what it is for.
 *
 * Both fall through to the identical synchronous update — no animation, never
 * different behaviour.
 *
 * `flushSync` is required, not incidental: `startViewTransition` snapshots the
 * DOM when its callback returns, and React would otherwise still be holding the
 * state update in a batch, so the "after" snapshot would be the before.
 */
export const runViewTransition = (update: () => void): void => {
  const reducedMotion =
    "matchMedia" in window &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reducedMotion || !("startViewTransition" in document)) {
    update();
    return;
  }

  document.startViewTransition(() => {
    flushSync(update);
  });
};
