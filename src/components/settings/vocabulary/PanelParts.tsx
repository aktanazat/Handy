import React from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/vg/skeleton";

/**
 * What a list of user-authored rules needs on top of the settings grammar.
 *
 * The surface, the microlabel, the row, the field and the status line all come
 * from `@/components/settings/rows`; nothing here draws a box or a heading.
 * What is left is the list itself, the column names its cells line up under,
 * the one addressable line a field is allowed to carry, and the two states a
 * list has before it has rows.
 */

/**
 * Literal text the person typed for the machine — a trigger, a replacement, a
 * prompt — set in mono so a trailing space or a homoglyph is visible. The `md:`
 * repeat is load-bearing: the kit's field steps its own size down at that
 * breakpoint, and a bare `text-[12.5px]` would lose to it there.
 */
export const literalText = "font-mono text-[12.5px] md:text-[12.5px]";

export interface RuleListProps {
  /** Accessible name for the collection. */
  label: string;
  children: React.ReactNode;
  className?: string;
}

export const RuleList: React.FC<RuleListProps> = ({
  label,
  children,
  className,
}) => (
  <ul
    // Tailwind's reset drops the marker, which also drops list semantics in
    // WebKit. The explicit role puts them back.
    role="list"
    aria-label={label}
    className={cn("divide-y divide-gray-alpha-400", className)}
  >
    {children}
  </ul>
);

/**
 * One rule. The wash names the row under the pointer, and `group/row` lets the
 * row's own actions stay out of the way until the pointer or the keyboard
 * arrives — which is why the focus-within state is not optional.
 */
export const RuleRow: React.FC<React.ComponentProps<"li">> = ({
  className,
  ...props
}) => (
  <li
    className={cn(
      "group/row px-4 py-2.5 transition-colors hover:bg-gray-alpha-100 focus-within:bg-gray-alpha-100",
      className,
    )}
    {...props}
  />
);

/**
 * A row's own actions, dimmed until the row is hovered or something inside it
 * takes focus. Opacity alone would strand a keyboard, so the focus-within
 * state carries exactly the same weight as the hover one.
 */
export const RowActions: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <span
    className={cn(
      "flex items-center gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100",
      className,
    )}
  >
    {children}
  </span>
);

export interface ColumnHeaderProps {
  /** The grid template shared with the rows below, so cells line up. */
  gridClassName: string;
  start: string;
  end: string;
}

/* Column names for a two-field row, in the mono microlabel a category is set
 * in. Hidden from assistive tech because every field below carries its own
 * label: this is a visual alignment cue and nothing else. */
export const ColumnHeader: React.FC<ColumnHeaderProps> = ({
  gridClassName,
  start,
  end,
}) => (
  <div
    aria-hidden="true"
    className={cn(
      gridClassName,
      "px-4 pt-3 pb-1 font-mono text-[11px] tracking-[0.12em] text-gray-800 uppercase",
    )}
  >
    <span className="truncate">{start}</span>
    <span className="truncate">{end}</span>
  </div>
);

export interface HintProps {
  /** Set when a field points at this text through aria-describedby. */
  id?: string;
  tone?: "muted" | "danger";
  live?: "off" | "polite";
  children: React.ReactNode;
  className?: string;
}

/**
 * The one sentence a field is allowed: what is wrong with what was typed, or
 * the syntax the field expects. Addressable, because a field has to be able to
 * point at it with aria-describedby — which is the only reason this exists
 * next to `Notice`. A line that restates its label is not a hint.
 */
export const Hint: React.FC<HintProps> = ({
  id,
  tone = "muted",
  live = "off",
  children,
  className,
}) => (
  <p
    id={id}
    aria-live={live}
    className={cn(
      "text-[12.5px] leading-[18px]",
      tone === "danger" ? "text-red-900" : "text-gray-700",
      className,
    )}
  >
    {children}
  </p>
);

export interface EmptyLineProps {
  /** One line, and never a restatement of the heading above it. */
  text: string;
  /** The thing the person most likely came here to do. */
  action?: React.ReactNode;
}

export const EmptyLine: React.FC<EmptyLineProps> = ({ text, action }) => (
  <div
    role="status"
    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
  >
    {/* Same optical size as `Notice`: an empty line and an assurance line are
     * the same weight of sentence, and `text-sm` is 12.25px at this app's
     * 14px root, which would demote one of them. */}
    <p className="text-[13px] leading-5 text-pretty text-gray-700">{text}</p>
    {action}
  </div>
);

export interface LoadingRowsProps {
  /** Announced while the rows are placeholders. */
  label: string;
  rows?: number;
}

export const LoadingRows: React.FC<LoadingRowsProps> = ({
  label,
  rows = 3,
}) => (
  <div role="status" aria-label={label} className="space-y-2 px-4 py-3">
    {Array.from({ length: rows }, (_, row) => (
      <div key={row} className="flex items-center gap-2">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 flex-1" />
      </div>
    ))}
  </div>
);
