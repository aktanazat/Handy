import React, { useRef } from "react";

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
 * active tab needs a line to sit on. The 2px marker is drawn by a
 * pseudo-element pulled one pixel down so it covers the rail instead of
 * stacking above it.
 *
 * The segmented strip is a real track: a hairline box holding the segments, so
 * the control reads as a switch before you know which segment is on. The active
 * segment is then unmistakable — raised fill AND its own border AND the weight
 * jump. `bg-subtle` alone was none of those in light, where subtle sits 4/255
 * off the page and the strip read as three plain words. Segments are concentric
 * with the track: 6px outer, 2px padding, 4px inner. */
const LIST_CLASSES = {
  default: "flex items-stretch gap-4 border-b border-border",
  secondary:
    "inline-flex items-center gap-0.5 rounded-control border border-border bg-surface-sunken p-0.5",
} as const;

const TAB_CLASSES = {
  default:
    "relative min-h-9 cursor-pointer px-0.5 text-[13px] whitespace-nowrap transition-colors duration-150 ease-out after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:origin-center after:scale-x-0 after:bg-text-primary after:transition-transform after:duration-180 after:ease-out disabled:cursor-not-allowed disabled:text-text-disabled",
  secondary:
    "min-h-7 cursor-pointer rounded-xs border border-transparent px-3 text-[13px] whitespace-nowrap transition-[background-color,border-color,color] duration-120 ease-in-out disabled:cursor-not-allowed disabled:text-text-disabled",
} as const;

const TAB_STATE_CLASSES = {
  default: {
    active: "font-semibold text-text-primary after:scale-x-100",
    idle: "font-medium text-text-secondary enabled:hover:text-text-primary",
  },
  secondary: {
    active: "border-border bg-surface-raised font-semibold text-text-primary",
    idle: "font-medium text-text-secondary enabled:hover:bg-hover enabled:hover:text-text-primary enabled:active:bg-pressed",
  },
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
            {item.label}
          </button>
        );
      })}
    </div>
  );
};
