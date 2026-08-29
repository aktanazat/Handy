import React from "react";

export interface ListProps extends React.HTMLAttributes<HTMLUListElement> {
  /** Accessible name for the list, so its purpose is announced. */
  label: string;
  /** Hairline between rows. Off when rows are already separated by space. */
  dividers?: boolean;
  children: React.ReactNode;
}

/* Dense rows with hairline dividers: the default shape for collections in
 * this app. Reach for Card only when an entry is genuinely a tile. */
export const List: React.FC<ListProps> = ({
  label,
  dividers = true,
  className = "",
  children,
  ...props
}) => {
  return (
    <ul
      // Tailwind's reset removes the marker, which also drops list semantics
      // in WebKit. The explicit role puts them back.
      role="list"
      aria-label={label}
      className={`overflow-hidden rounded-panel border border-border bg-surface ${dividers ? "divide-y divide-border" : ""} ${className}`}
      {...props}
    >
      {children}
    </ul>
  );
};

export interface RowProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small leading affordance: a check, a 16px icon, a number. */
  leading?: React.ReactNode;
  /** Right-aligned metadata such as a time or a duration. */
  meta?: React.ReactNode;
  /** Controls at the end of the row. Never place these inside onSelect. */
  actions?: React.ReactNode;
  /** Makes the row body a button. Actions stay outside it, so they stay
   * reachable and the markup keeps one interactive element per target. */
  onSelect?: () => void;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
}

const ROW_BODY_CLASSES =
  "flex min-h-10 flex-1 items-center gap-3 px-4 py-2 text-start";

export const Row: React.FC<RowProps> = ({
  title,
  description,
  leading,
  meta,
  actions,
  onSelect,
  selected = false,
  disabled = false,
  className = "",
}) => {
  const body = (
    <>
      {leading && (
        <span className="flex size-4 flex-none items-center justify-center text-text-tertiary">
          {leading}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[13px] leading-[19px] ${selected ? "font-semibold" : "font-medium"} text-text-primary`}
        >
          {title}
        </span>
        {description && (
          <span className="block truncate text-[12px] leading-4 text-text-secondary">
            {description}
          </span>
        )}
      </span>
      {meta && (
        <span className="flex-none font-mono text-[12px] leading-4 text-text-tertiary tabular-nums">
          {meta}
        </span>
      )}
    </>
  );

  return (
    <li
      className={`flex items-center ${selected ? "bg-subtle" : ""} ${className}`}
      aria-current={selected ? "true" : undefined}
    >
      {onSelect ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onSelect}
          className={`${ROW_BODY_CLASSES} cursor-pointer transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-in-out)] outline-offset-[-2px] enabled:hover:bg-hover enabled:active:bg-pressed disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {body}
        </button>
      ) : (
        <div className={ROW_BODY_CLASSES}>{body}</div>
      )}
      {actions && (
        <span className="flex flex-none items-center gap-1 pe-3">
          {actions}
        </span>
      )}
    </li>
  );
};
