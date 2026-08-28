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

/* Roving tabindex: one stop in the Tab order, arrows move between tabs.
 * Selection follows focus, which is the expected behaviour when switching
 * panels is cheap. */
export const Tabs: React.FC<TabsProps> = ({
  items,
  value,
  onChange,
  label,
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
      className={`inline-flex items-center gap-0.5 ${className}`}
    >
      {items.map((item) => {
        const active = item.id === value;
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
            className={`min-h-8 cursor-pointer rounded-control px-3 text-[13px] whitespace-nowrap transition-[background-color,color] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-60 ${
              active
                ? "bg-subtle font-semibold text-text-primary"
                : "font-medium text-text-secondary enabled:hover:bg-hover enabled:hover:text-text-primary enabled:active:bg-pressed"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
};
