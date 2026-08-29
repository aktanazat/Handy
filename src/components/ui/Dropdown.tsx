import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface DropdownProps {
  options: DropdownOption[];
  className?: string;
  selectedValue: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onRefresh?: () => void;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  selectedValue,
  onSelect,
  className = "",
  placeholder = "Select an option...",
  disabled = false,
  onRefresh,
}) => {
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

  const handleSelect = (value: string) => {
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
        className={`control-surface grid min-h-9 w-full min-w-44 grid-cols-[1fr_auto] items-center gap-2 border px-3 text-start text-sm font-medium text-text-primary transition-colors ${
          disabled
            ? "cursor-not-allowed opacity-70"
            : "cursor-pointer hover:border-border-strong hover:bg-hover"
        }`}
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
        <span className="truncate">{selectedLabel}</span>
        <svg
          className={`h-4 w-4 text-text-secondary transition-transform duration-150 ${
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
          className="glass-popover absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto border p-1"
        >
          {options.length === 0 ? (
            <div className="px-2 py-2 text-sm text-text-secondary">
              {t("common.noOptionsFound")}
            </div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selectedValue === option.value}
                className={`min-h-8 w-full rounded-md px-2 text-start text-sm text-text-primary transition-colors hover:bg-hover ${
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
};
