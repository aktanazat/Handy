import React from "react";
import { Skeleton, StatusText, type StatusTone } from "../../ui";

/**
 * Pieces for content that lives *inside* a flat settings section.
 *
 * `List`, `EmptyState` and `Card` each draw their own hairline panel, which
 * inside a settings section would be a box within a box. These keep the
 * dividers, the type scale and the empty-state shape, and drop the chrome.
 * Used across the vocabulary panels, the modes editor and the model catalog:
 * one flat-list convention, not one per page.
 */

export interface RuleListProps {
  /** Accessible name for the collection. */
  label: string;
  children: React.ReactNode;
  className?: string;
}

export const RuleList: React.FC<RuleListProps> = ({
  label,
  children,
  className = "",
}) => (
  <ul
    // Tailwind's reset drops the marker, which also drops list semantics in
    // WebKit. The explicit role puts them back.
    role="list"
    aria-label={label}
    className={`divide-y divide-border ${className}`}
  >
    {children}
  </ul>
);

export interface ColumnHeaderProps {
  /** The grid template shared with the rows below, so cells line up. */
  gridClassName: string;
  start: string;
  end: string;
}

/* Column names for a two-field row, on the uppercase mono microlabel the rest
 * of the app uses for a category. Hidden from assistive tech because every
 * field below carries its own label; this is a visual alignment cue. */
export const ColumnHeader: React.FC<ColumnHeaderProps> = ({
  gridClassName,
  start,
  end,
}) => (
  <div aria-hidden="true" className={`${gridClassName} microlabel px-0.5`}>
    <span className="truncate">{start}</span>
    <span className="truncate">{end}</span>
  </div>
);

export interface HintProps {
  /** Set when a field points at this text through aria-describedby. */
  id?: string;
  tone?: StatusTone;
  live?: "off" | "polite";
  children: React.ReactNode;
  className?: string;
}

/* StatusText, addressable. The primitive owns the type scale and the tone but
 * takes no id, and a field hint has to be referable. */
export const Hint: React.FC<HintProps> = ({
  id,
  tone = "muted",
  live = "off",
  children,
  className = "",
}) => (
  <span id={id} className={`block ${className}`}>
    <StatusText tone={tone} live={live}>
      {children}
    </StatusText>
  </span>
);

export interface EmptyHintProps {
  title: string;
  description?: string;
  /** One action, the thing the person most likely came here to do. */
  action?: React.ReactNode;
}

export const EmptyHint: React.FC<EmptyHintProps> = ({
  title,
  description,
  action,
}) => (
  <div role="status" className="flex flex-col items-start gap-2.5 py-2">
    <div className="space-y-1">
      <p className="text-[13px] leading-[19px] font-medium text-text-primary">
        {title}
      </p>
      {description && (
        <p className="max-w-[62ch] text-[12.5px] leading-[18px] text-pretty text-text-secondary">
          {description}
        </p>
      )}
    </div>
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
  <div role="status" aria-label={label} className="space-y-2 py-1">
    {Array.from({ length: rows }, (_, row) => (
      <div key={row} className="flex items-center gap-2">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 flex-1" />
      </div>
    ))}
  </div>
);
