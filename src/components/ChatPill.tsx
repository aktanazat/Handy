import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/vg/tooltip";

/* The shell's standing way into the agent.
 *
 * ⌘K already carries an "Open agent" row, but a palette row is a thing you
 * have to know is there. This is the same door with a handle on it, in the one
 * place every route leaves empty: the band above the page's first heading, at
 * the content pane's right gutter. It is mounted once by the shell (App.tsx)
 * outside the page scroll region, so it neither scrolls away nor has to be
 * restated by twelve pages.
 *
 * It is a door and not a switch: while the chat column is open the pill is off
 * screen and the column's own X is what closes it. Two controls for one fold,
 * one of them sitting in a 512pt page that has just been narrowed to make room
 * for the other, is the duplication this surface keeps being rebuilt to
 * remove.
 *
 * Geometry, stated once here because this component owns where it sits and the
 * shell only owns which box it sits in. The app's root is 14px, so every rem
 * utility renders at 87.5% of its name and the numbers a shape depends on are
 * written in px:
 *
 *   - `top-[7px]` with `h-[28px]`: centred in the 42px band that every page's
 *     `py-12` leaves above its first heading, clearing page content by 7px.
 *     On macOS that centre line is also the overlay title bar's, so the pill
 *     sits on the traffic lights' row at the far side of the window, which is
 *     empty on every route.
 *   - `end-[28px]`: the page column's own gutter (`PAGE_COLUMN`'s `px-8` =
 *     2rem = 28px), so the pill's outer edge and the page's content edge are
 *     the same line. Logical, not `right-`: the shell sets `dir` per language.
 *
 * The heading band itself was not available: `SettingsPage` puts page actions
 * at its right edge — Modes' "New mode", Models' catalog size, a live
 * meeting's phase chip — and a floating pill there would cover them. */
const PLACEMENT = "absolute top-[7px] end-[28px] z-10";

/* The glyph: one ring, three arcs, one aurora hue each, in the order the
 * capture wash layers them (styles/aurora.css). Stroke only and static — the
 * wash on Capture is the surface that is allowed to move, and a second
 * animated aurora in the chrome would compete with it. The hues carry their
 * own alpha, which is why the ring needs no plate under it: at 0.2 on white
 * the palest of them is still a stronger line than the pill's own hairline. */
const GLYPH_SIZE = 14;
const GLYPH_STROKE = 1.5;
const GLYPH_CENTER = GLYPH_SIZE / 2;
const GLYPH_RADIUS = (GLYPH_SIZE - GLYPH_STROKE) / 2;

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** One third of the ring, and the two thirds each arc skips. */
const ARC = round((2 * Math.PI * GLYPH_RADIUS) / 3);
const ARC_GAP = round(ARC * 2);

const AURORA_HUES = [
  "--aurora-blue",
  "--aurora-cyan",
  "--aurora-violet",
] as const;

const AuroraRing: React.FC = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={GLYPH_SIZE}
    height={GLYPH_SIZE}
    viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`}
    /* Rotated so the first hue starts at the top; the ring is otherwise
     * three-fold symmetric. */
    className="-rotate-90 flex-none"
  >
    {AURORA_HUES.map((hue, index) => (
      /* No `strokeLinecap`: the arcs are contiguous, and a round cap would
       * overlap its neighbour by half a stroke — two translucent hues over
       * each other, which draws three dots on a ring that has none. */
      <circle
        key={hue}
        cx={GLYPH_CENTER}
        cy={GLYPH_CENTER}
        r={GLYPH_RADIUS}
        fill="none"
        strokeWidth={GLYPH_STROKE}
        strokeDasharray={`${ARC} ${ARC_GAP}`}
        strokeDashoffset={round(ARC * index)}
        style={{ stroke: `var(${hue})` }}
      />
    ))}
  </svg>
);

export interface ChatPillProps {
  /** `agent_panel_enabled`. Off means the affordance does not exist at all. */
  enabled: boolean;
  /** `agent_panel_paired`. Off means no relay would answer a turn. */
  paired: boolean;
  /**
   * Whether the chat column beside it is showing. While it is, there is no
   * pill at all — the column's own X is what closes it.
   */
  open: boolean;
  /** Presses only ever open: closing belongs to the column's X and to Esc. */
  onOpen: () => void;
}

export const ChatPill: React.FC<ChatPillProps> = ({
  enabled,
  paired,
  open,
  onOpen,
}) => {
  const { t } = useTranslation();
  const pillRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  /* Closing the column brings the pill back, and whoever closed it with the
   * column's X or with Escape has just had the element under their focus taken
   * off screen. Focus returns here, where the press started, rather than
   * falling back to the body. Only after the column has actually been open:
   * on a fresh window this effect must not steal focus from whatever the route
   * put it on. */
  useEffect(() => {
    if (wasOpen.current && !open) pillRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  /* Nothing to offer and nothing to explain: the agent is off by setting, and
   * a disabled control pointing at a switch the reader turned off themselves
   * is noise. Settings is where it comes back. */
  if (!enabled) return null;

  /* The column is showing, and it carries the X that closes it. A pill left
   * standing in the page the column just took its width from would be a second
   * control for one fold, in the half of the window with less room for it. */
  if (open) return null;

  const pill = (
    <button
      type="button"
      ref={pillRef}
      data-slot="chat-pill"
      /* The label reads "Chat", which does not say chat with what. The
       * accessible name does. */
      aria-label={t("chat.label")}
      /* The column it opens is not showing — a pill on screen is a column that
       * is closed — so the state it reports is always the collapsed one. It
       * reports it anyway: this is the control that reveals that region, and a
       * disclosure that says nothing about its region is one a screen reader
       * has to guess at. */
      aria-expanded={paired ? false : undefined}
      /* `aria-disabled`, not `disabled`: the reason it is inert lives in the
       * tooltip below, and a `disabled` button takes neither hover nor focus,
       * so it would be the one state that cannot reach its own explanation.
       * Dimmed type rather than opacity, like every disabled settings row. */
      aria-disabled={paired ? undefined : true}
      onClick={paired ? onOpen : undefined}
      className={cn(
        PLACEMENT,
        "inline-flex h-[28px] items-center gap-1.5 rounded-full border border-gray-alpha-400 bg-raised ps-2.5 pe-3 text-[13px] leading-[18px] transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        paired ? "text-gray-1000 hover:bg-gray-alpha-100" : "text-gray-800",
      )}
    >
      <AuroraRing />
      {t("chat.open")}
    </button>
  );

  if (paired) return pill;

  /* Radix opens on focus as well as hover and points the trigger's
   * aria-describedby at this sentence while it is open, so the reason is one
   * tab away rather than pointer-only — and it is said once, here, instead of
   * being copied into a title attribute as well. */
  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent>{t("chat.unpaired")}</TooltipContent>
    </Tooltip>
  );
};
