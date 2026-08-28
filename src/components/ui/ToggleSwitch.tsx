import React, { useId } from "react";
import { SettingContainer } from "./SettingContainer";
import { Switch } from "./Switch";

export interface ToggleSwitchProps {
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

/* A settings row whose control is a Switch: label and description on the
 * left, the switch on the right. Reach for Switch directly when the row
 * chrome is not wanted. */
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
      <Switch
        id={inputId}
        checked={checked}
        onChange={onChange}
        label={label}
        disabled={unavailable}
        describedBy={`${inputId}-description`}
      />
      {isUpdating && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface/80">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-secondary border-t-transparent" />
        </div>
      )}
    </SettingContainer>
  );
};
