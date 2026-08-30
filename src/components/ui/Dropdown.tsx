import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/* `T` is the caller's own value domain rather than `string`: a settings row
 * that selects an `OverlayStyle` instantiates `Dropdown<OverlayStyle>` and its
 * `onSelect` hands an `OverlayStyle` straight back, so no caller has to assert
 * a string into its enum. Defaulted to `string` for lists of opaque ids
 * (device names, model ids) where there is no narrower domain to name. */
export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface DropdownProps<T extends string = string> {
  options: DropdownOption<T>[];
  className?: string;
  selectedValue: T | null;
  onSelect: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  onRefresh?: () => void;
  /** `filter` is the compact mono KEY: VALUE chip a filter bar reads in: it
   *  sizes to its own value instead of to a settings column, and its selected
   *  value is filled rather than accented, matching the segmented controls it
   *  sits beside. */
  variant?: "default" | "filter";
  /** The KEY half of a filter chip, rendered as a mono microlabel before the
   *  value. Without one the chip is value-only. */
  filterKey?: string;
}

export function Dropdown<T extends string = string>({
  options,
  selectedValue,
  onSelect,
  className = "",
  placeholder = "Select an option...",
  disabled = false,
  onRefresh,
  variant = "default",
  filterKey,
}: DropdownProps<T>) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (
        dropdownRef.current &&
        target instanceof Node &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find(
    (option) => option.value === selectedValue,
  );
  /* A stored value with no matching option is still the chosen value: a
   * microphone that got unplugged, a model that was deleted, a list that has
   * not enumerated yet. Falling back to the placeholder there tells the user
   * nothing is selected, which is a lie about state — show the stored value.
   * The placeholder then means what it says: nothing is selected.
   *
   * It deliberately stops there and does not call the value unavailable. This
   * layer sees an option list, so it cannot tell a device that enumeration
   * confirmed gone from one whose enumeration failed, was denied, or is still
   * in flight; only the owner of the enumeration knows that. */
  const selectedLabel = selectedOption?.label || selectedValue || placeholder;

  const handleSelect = (value: T) => {
    onSelect(value);
    setIsOpen(false);
  };

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen) onRefresh?.();
    setIsOpen((current) => !current);
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={
          variant === "filter"
            ? `meeting-filter-chip ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`
            : `control-surface grid w-full min-w-44 grid-cols-[1fr_auto] items-center gap-2 border px-3 text-start text-[13px] font-medium text-text-primary transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-in-out)] ${
                disabled
                  ? "cursor-not-allowed opacity-70"
                  : "cursor-pointer hover:border-border-strong hover:bg-hover"
              }`
        }
        /* The label truncates, and a device name is exactly the kind of long
         * string a narrow settings column clips. Keep the whole value one
         * hover away rather than losing it to an ellipsis. */
        title={selectedLabel}
        onClick={handleToggle}
        onKeyDown={(event) => {
          if (event.key === "Escape") setIsOpen(false);
        }}
        disabled={disabled}
      >
        {variant === "filter" && filterKey !== undefined ? (
          <span className="filter-chip-key">{filterKey}</span>
        ) : null}
        <span className={variant === "filter" ? "" : "truncate"}>
          {selectedLabel}
        </span>
        <svg
          className={`${variant === "filter" ? "h-3 w-3" : "h-4 w-4"} text-text-secondary transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)] ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {isOpen && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          /* A filter chip is as narrow as its own value, so its menu sizes to
           * the longest option instead of to the chip. */
          className={`glass-popover absolute top-full z-50 mt-1 max-h-60 overflow-y-auto border p-1 ${
            variant === "filter" ? "start-0 min-w-max" : "inset-x-0"
          }`}
        >
          {options.length === 0 ? (
            <div className="px-2 py-2 text-[13px] text-text-secondary">
              {t("common.noOptionsFound")}
            </div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selectedValue === option.value}
                className={`min-h-9 w-full rounded-xs px-2 text-start text-[13px] text-text-primary transition-colors duration-[var(--duration-fast)] ease-[var(--ease-in-out)] hover:bg-hover ${
                  selectedValue === option.value
                    ? "bg-inverse-background font-medium text-inverse-text hover:bg-inverse-background"
                    : ""
                } ${option.disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                onClick={() => handleSelect(option.value)}
                disabled={option.disabled}
              >
                <span className="whitespace-normal break-words">
                  {option.label}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
