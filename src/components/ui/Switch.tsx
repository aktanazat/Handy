import React, { useId } from "react";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name. Pass the same text a visible label would carry. */
  label: string;
  id?: string;
  disabled?: boolean;
  describedBy?: string;
  className?: string;
}

/* A checkbox in a track. The input stays a real checkbox so the label, focus
 * ring, keyboard toggle and form semantics come from the platform; the track
 * and knob are drawn from the peer state. */
export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  label,
  id,
  disabled = false,
  describedBy,
  className = "",
}) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <label
      htmlFor={inputId}
      className={`inline-flex items-center ${disabled ? "cursor-not-allowed" : "cursor-pointer"} ${className}`}
    >
      <input
        id={inputId}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="glass-toggle relative h-5 w-9 rounded-full transition-[background-color,border-color] duration-150 ease-out peer-checked:border-inverse-background peer-checked:bg-inverse-background peer-disabled:opacity-50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus-ring after:absolute after:start-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:border after:border-border after:bg-surface after:transition-transform after:duration-150 after:ease-out peer-checked:after:translate-x-4 rtl:peer-checked:after:-translate-x-4" />
    </label>
  );
};
