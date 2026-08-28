import React from "react";
import { Button, EmptyState, Kbd, List, Row } from "@/components/ui";
import { formatKeyCombination, type OSType } from "@/lib/utils/keyboard";

/* Pieces the design system does not carry, composed here rather than added to
 * src/components/ui: a segmented picker and the two list shapes the modes page
 * needs. Nothing here holds state. */

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
  disabled?: boolean;
  /** Why this option cannot be chosen. Surfaced as the option's tooltip. */
  reason?: string;
}

export interface SegmentedRadioGroupProps<Value extends string> {
  /** Radio group name. Unique per editor so two groups never share a value. */
  name: string;
  /** Accessible name for the group. Rendered for assistive tech only, since
   *  the surrounding setting row already shows the visible label. */
  legend: string;
  value: Value;
  options: readonly SegmentedOption<Value>[];
  onChange: (value: Value) => void;
  disabled?: boolean;
  /** Equal-width columns instead of a wrapping row. */
  layout?: "wrap" | "grid";
}

/* Selection reads without color: the chosen segment is heavier and carries a
 * 2px rule under its label, so it survives greyscale and high contrast. */
export const SegmentedRadioGroup = <Value extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  disabled = false,
  layout = "wrap",
}: SegmentedRadioGroupProps<Value>) => (
  <fieldset
    className={`mode-segment ${layout === "grid" ? "mode-segment-grid" : ""}`}
    disabled={disabled}
  >
    <legend className="sr-only">{legend}</legend>
    {options.map((option) => (
      <label
        key={option.value}
        className="mode-segment-option"
        title={option.disabled ? option.reason : undefined}
      >
        <input
          type="radio"
          className="sr-only"
          name={name}
          value={option.value}
          checked={value === option.value}
          disabled={option.disabled}
          onChange={() => onChange(option.value)}
        />
        <span>{option.label}</span>
      </label>
    ))}
  </fieldset>
);

export interface ShortcutChordProps {
  /** Raw chord such as `option_left+shift+space`. Empty means unbound. */
  chord: string;
  osType: OSType;
  className?: string;
}

/* One cap per key. `formatKeyCombination` stays the single source of key
 * naming, called per part so the chord can be split into caps. */
export const ShortcutChord: React.FC<ShortcutChordProps> = ({
  chord,
  osType,
  className = "",
}) => {
  const keys: string[] = [];
  for (const part of chord.split("+")) {
    const label = formatKeyCombination(part, osType);
    if (label.length > 0) keys.push(label);
  }
  if (keys.length === 0) return null;

  return (
    <span className={`mode-chord ${className}`} title={keys.join(" + ")}>
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key}</Kbd>
      ))}
    </span>
  );
};

export interface ActivationRuleItem {
  id: string;
  /** The stored match key: a bundle identity or a host. */
  target: string;
  /** Scope or qualifier shown under the target. */
  detail?: string;
  removeLabel: string;
  onRemove: () => void;
}

export interface ActivationRuleListProps {
  label: string;
  items: readonly ActivationRuleItem[];
  /** The capture control. Shown above the list, or inside the empty state. */
  action: React.ReactNode;
  emptyTitle: string;
  /** What a rule looks like, so an empty list still teaches the shape. */
  emptyDescription: string;
  removeText: string;
  disabled?: boolean;
}

export const ActivationRuleList: React.FC<ActivationRuleListProps> = ({
  label,
  items,
  action,
  emptyTitle,
  emptyDescription,
  removeText,
  disabled = false,
}) => {
  if (items.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={action}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {action}
      <List label={label}>
        {items.map((item) => (
          <Row
            key={item.id}
            title={
              <code className="font-mono text-[12.5px]">{item.target}</code>
            }
            description={item.detail}
            actions={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={item.removeLabel}
                disabled={disabled}
                onClick={item.onRemove}
              >
                {removeText}
              </Button>
            }
          />
        ))}
      </List>
    </div>
  );
};
