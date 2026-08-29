import React, { Suspense, lazy, useId, useRef } from "react";

/* Lazy, so `m` and the projection runtime never reach the eager chunk. */
const TabsIndicator = lazy(() => import("./TabsIndicator"));

export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
  /** id of the element this tab controls, when the panel is rendered nearby. */
  panelId?: string;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab strip. */
  label: string;
  /** `default` is the underlined strip; `secondary` is the segmented pill. */
  variant?: "default" | "secondary";
  className?: string;
}

const nextEnabledIndex = (
  items: readonly TabItem[],
  from: number,
  step: number,
): number => {
  const count = items.length;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (from + step * offset + count * count) % count;
    if (!items[index].disabled) return index;
  }
  return from;
};

/* The underlined strip owns its own rail, because an underline that marks the
 * active tab needs a line to sit on. The 2px marker is pulled one pixel down so
 * it covers the rail instead of stacking above it.
 *
 * The segmented strip is a real track: a hairline box holding the segments, so
 * the control reads as a switch before you know which segment is on. The active
 * segment is then unmistakable — raised fill AND its own border AND the weight
 * jump. `bg-subtle` alone was none of those in light, where subtle sits 4/255
 * off the page and the strip read as three plain words. Segments are concentric
 * with the track: 6px outer, 2px padding, 4px inner.
 *
 * In both variants the mark is ONE element that moves between segments rather
 * than a per-segment pseudo-element switching on and off: same `layoutId`, so
 * Motion measures where it was, where it landed, and springs the difference.
 * A cross-fade told you the state had changed; a slide tells you which way. */
const LIST_CLASSES = {
  default: "flex items-stretch gap-4 border-b border-border",
  secondary:
    "inline-flex items-center gap-0.5 rounded-control border border-border bg-surface-sunken p-0.5",
} as const;

const TAB_CLASSES = {
  default:
    "relative isolate min-h-9 cursor-pointer px-0.5 text-[13px] whitespace-nowrap transition-colors duration-[var(--duration-fast)] ease-[var(--ease-in-out)] disabled:cursor-not-allowed disabled:text-text-disabled",
  secondary:
    "relative isolate min-h-7 cursor-pointer rounded-xs border border-transparent px-3 text-[13px] whitespace-nowrap transition-colors duration-[var(--duration-fast)] ease-[var(--ease-in-out)] disabled:cursor-not-allowed disabled:text-text-disabled",
} as const;

const TAB_STATE_CLASSES = {
  default: {
    active: "font-semibold text-text-primary",
    idle: "font-medium text-text-secondary enabled:hover:text-text-primary",
  },
  secondary: {
    active: "font-semibold text-text-primary",
    idle: "font-medium text-text-secondary enabled:hover:bg-hover enabled:hover:text-text-primary enabled:active:bg-pressed",
  },
} as const;

/* The moving mark. `isolate` on the segment keeps the negative z-index inside
 * the button, so the fill sits under its own label and still over the track. */
const INDICATOR_CLASSES = {
  default: "absolute inset-x-0 -bottom-px h-0.5 bg-text-primary",
  secondary:
    "absolute inset-0 -z-10 rounded-xs border border-border bg-surface-raised",
} as const;

/* Roving tabindex: one stop in the Tab order, arrows move between tabs.
 * Selection follows focus, which is the expected behaviour when switching
 * panels is cheap. */
export const Tabs: React.FC<TabsProps> = ({
  items,
  value,
  onChange,
  label,
  variant = "default",
  className = "",
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  /* One strip's mark must not chase another strip's active segment, and two
   * strips are on screen at once (top nav plus a panel's own). */
  const indicatorLayoutId = `tabs-indicator-${useId()}`;

  const focusTab = (index: number) => {
    const tabs =
      listRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    tabs?.[index]?.focus();
    onChange(items[index].id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((item) => item.id === value);
    if (current === -1) return;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusTab(nextEnabledIndex(items, current, 1));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusTab(nextEnabledIndex(items, current, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTab(nextEnabledIndex(items, items.length - 1, 1));
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab(nextEnabledIndex(items, 0, -1));
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={`${LIST_CLASSES[variant]} ${className}`}
    >
      {items.map((item) => {
        const active = item.id === value;
        const state = TAB_STATE_CLASSES[variant];
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={active}
            aria-controls={item.panelId}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={`${TAB_CLASSES[variant]} ${active ? state.active : state.idle}`}
          >
            {active ? (
              /* The fallback is the same mark without the travel, so the strip
               * is never briefly unmarked while the chunk loads. */
              <Suspense
                fallback={
                  <span
                    className={INDICATOR_CLASSES[variant]}
                    aria-hidden="true"
                  />
                }
              >
                <TabsIndicator
                  layoutId={indicatorLayoutId}
                  className={INDICATOR_CLASSES[variant]}
                />
              </Suspense>
            ) : null}
            {item.label}
          </button>
        );
      })}
    </div>
  );
};
