import React from "react";
import { Button } from "@/components/vg/button";
import { Kbd } from "@/components/vg/kbd";
import { cn } from "@/lib/cn";
import {
  formatKeyCombination,
  keyCapParts,
  type OSType,
} from "@/lib/utils/keyboard";

/* Pieces neither the shadcn kit nor the shared settings grammar carries: a
 * segmented picker, the keycap chord and the activation rule list. Nothing
 * here holds state.
 *
 * Page, section and row shapes come from `@/components/settings/rows` — one
 * owner for the settings grammar, so Modes and Meetings cannot drift. The
 * whole modes surface resolves through shared theme utilities. */

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
   *  the surrounding row already shows the visible label. */
  legend: string;
  value: Value;
  options: readonly SegmentedOption<Value>[];
  onChange: (value: Value) => void;
  disabled?: boolean;
  /** Equal-width columns instead of a wrapping row. */
  layout?: "wrap" | "grid";
}

/* A preset, a tone or a context level is one of N values on a form, so the
 * markup stays a radio group: `role="tab"` without a panel would be a lie.
 * Selection reads without colour — the chosen segment also gains weight and
 * the raised fill — so it survives greyscale and forced colors. */
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
    disabled={disabled}
    className={cn(
      "m-0 min-w-0 gap-1 border-0 p-0.5",
      "rounded-md border border-gray-alpha-400 bg-background-200",
      layout === "grid"
        ? "grid grid-cols-2 sm:grid-cols-4"
        : /* A fieldset is block-level, so a wrapped set would stretch to the
           * column and leave a long dead region past its last segment. */
          "flex w-fit flex-wrap",
    )}
  >
    <legend className="sr-only">{legend}</legend>
    {options.map((option) => (
      <label
        key={option.value}
        title={option.disabled ? option.reason : undefined}
        className="min-w-0 cursor-pointer has-[:disabled]:cursor-not-allowed"
      >
        <input
          type="radio"
          className="peer sr-only"
          name={name}
          value={option.value}
          checked={value === option.value}
          disabled={option.disabled}
          onChange={() => onChange(option.value)}
        />
        <span
          className={cn(
            "flex h-7 items-center justify-center overflow-hidden rounded-[4px] border border-transparent px-3 text-center text-[13px] whitespace-nowrap text-ellipsis text-gray-900",
            "peer-enabled:hover:bg-gray-alpha-100 peer-enabled:hover:text-gray-1000",
            "peer-checked:border-gray-alpha-400 peer-checked:bg-background-100 peer-checked:font-medium peer-checked:text-gray-1000",
            "peer-disabled:text-gray-700",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-blue-700 peer-focus-visible:outline-none",
          )}
        >
          {option.label}
        </span>
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
  className,
}) => {
  const keys = compact
    ? keyCapParts(chord, osType)
    : chord
        .split("+")
        .map((part) => formatKeyCombination(part, osType))
        .filter((label) => label.length > 0);
  if (keys.length === 0) return null;

  /* The wrapper owns the tooltip the narrow list column needs, so the caps
   * stay `Kbd`. The tooltip is the spelled-out chord in both forms: that is
   * where "Left Option" survives. */
  return (
    <span
      className={cn("inline-flex min-w-0 flex-nowrap gap-1", className)}
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
  /** The capture control. Shown above the list, or beside the empty line. */
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
    /* Absence, not an object: two lines and the control that fills them. A box
     * around an empty list would only draw a second empty rectangle. */
    return (
      <div role="status" className="flex flex-col items-start gap-2">
        <p className="text-sm text-gray-1000">{emptyTitle}</p>
        <p className="text-[13px] leading-5 text-gray-800">
          {emptyDescription}
        </p>
        {action}
      </div>
    );
  }

  return (
    /* `items-start` so the capture control keeps its intrinsic width here
     * exactly as it does in the empty branch, instead of stretching. */
    <div className="flex flex-col items-start gap-2">
      {action}
      <ul
        aria-label={label}
        className="w-full divide-y divide-gray-alpha-400 border-y border-gray-alpha-400"
      >
        {items.map((item) => (
          <li key={item.id} className="flex min-h-10 items-center gap-3 py-1.5">
            <span className="min-w-0 flex-1">
              <code className="block truncate text-[12.5px] leading-5 text-gray-1000">
                {item.target}
              </code>
              {item.detail ? (
                <span className="block text-[12px] leading-4 text-gray-800">
                  {item.detail}
                </span>
              ) : null}
            </span>
            <Button
              type="button"
              /* Bordered, not ghost: a bare text control at the right of a
               * machine-value row reads as more of the path. */
              variant="outline"
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
      </ul>
    </div>
  );
};
