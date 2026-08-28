import React, { useId } from "react";
import { SettingContainer } from "./SettingContainer";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  isUpdating?: boolean;
  label: string;
  description: string;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  tooltipPosition?: "top" | "bottom";
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  isUpdating = false,
  label,
  description,
  descriptionMode = "inline",
  grouped = false,
  tooltipPosition = "top",
}) => {
  const inputId = useId();
  const unavailable = disabled || isUpdating;

  return (
    <SettingContainer
      title={label}
      description={description}
      descriptionMode={descriptionMode}
      grouped={grouped}
      disabled={disabled}
      tooltipPosition={tooltipPosition}
      controlId={inputId}
    >
      <label
        htmlFor={inputId}
        className={`flex items-center ${unavailable ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <input
          id={inputId}
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={unavailable}
          aria-describedby={`${inputId}-description`}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="glass-toggle relative h-5 w-9 rounded-full peer-checked:bg-inverse-background peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-strong peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas after:absolute after:start-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:border after:border-border after:bg-surface after:transition-transform after:duration-150 peer-checked:after:translate-x-4 rtl:peer-checked:after:-translate-x-4" />
      </label>
      {isUpdating && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface/80">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-secondary border-t-transparent" />
        </div>
      )}
    </SettingContainer>
  );
};
