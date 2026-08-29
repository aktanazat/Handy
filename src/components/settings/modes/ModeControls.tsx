import React from "react";
import { Button, EmptyState, Kbd } from "@/components/ui";
import {
  formatKeyCombination,
  keyCapParts,
  type OSType,
} from "@/lib/utils/keyboard";
import { Hint, RuleList } from "../vocabulary/PanelParts";

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
  /**
   * Draw the engraved-glyph caps instead of the spelled-out key names. For a
   * row that has to keep its caps on the title's own line; the spelled-out
   * chord stays reachable as the tooltip either way.
   */
  compact?: boolean;
  className?: string;
}

/* One cap per key. Both forms come out of `src/lib/utils/keyboard`, so key
 * naming still has a single owner. */
export const ShortcutChord: React.FC<ShortcutChordProps> = ({
  chord,
  osType,
  compact = false,
  className = "",
}) => {
  const keys = compact
    ? keyCapParts(chord, osType)
    : chord
        .split("+")
        .map((part) => formatKeyCombination(part, osType))
        .filter((label) => label.length > 0);
  if (keys.length === 0) return null;

  /* The wrapper owns the tooltip and the truncation the narrow list column
   * needs, so the caps stay `Kbd` rather than `KbdChord`. The tooltip is the
   * spelled-out chord in both forms: that is where "Left Option" survives. */
  return (
    <span
      className={`mode-chord ${className}`}
      title={formatKeyCombination(chord, osType)}
    >
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
    /* A rule list that has never been filled is absence, not an object: the
     * blank variant states what is missing and carries the capture control,
     * and drawing a box around it would only add a second empty rectangle
     * inside the flat section. */
    return (
      <EmptyState
        variant="blank"
        title={emptyTitle}
        description={emptyDescription}
        action={action}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {action}
      <RuleList label={label}>
        {items.map((item) => (
          <li key={item.id} className="flex min-h-9 items-center gap-3 py-1.5">
            <span className="min-w-0 flex-1">
              <code className="block truncate font-mono text-[12.5px] leading-[18px] text-text-primary">
                {item.target}
              </code>
              {item.detail ? <Hint>{item.detail}</Hint> : null}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex-none"
              aria-label={item.removeLabel}
              disabled={disabled}
              onClick={item.onRemove}
            >
              {removeText}
            </Button>
          </li>
        ))}
      </RuleList>
    </div>
  );
};
