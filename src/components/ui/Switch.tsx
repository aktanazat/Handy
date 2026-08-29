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
 * ring, keyboard toggle and form semantics come from the platform; the track,
 * knob and every state paint live on `.glass-toggle` in styles/primitives.css,
 * keyed off the input's own :checked/:disabled/:focus-visible — CSS the
 * overlay webview shares, and that no cascade layer can silently defeat. */
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
        className="sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="glass-toggle" aria-hidden="true" />
    </label>
  );
};
