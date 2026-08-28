import React, { useId } from "react";
import { SettingContainer } from "./SettingContainer";
import { ResetButton } from "./ResetButton";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  label: string;
  description: string;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  showValue?: boolean;
  formatValue?: (value: number) => string;
  onReset?: () => void;
  isResetting?: boolean;
}

export const Slider: React.FC<SliderProps> = ({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  disabled = false,
  label,
  description,
  descriptionMode = "inline",
  grouped = false,
  showValue = true,
  formatValue = (currentValue) => currentValue.toFixed(2),
  onReset,
  isResetting = false,
}) => {
  const inputId = useId();

  return (
    <SettingContainer
      title={label}
      description={description}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="horizontal"
      disabled={disabled}
      controlId={inputId}
    >
      <div className="flex h-9 items-center gap-2">
        <input
          id={inputId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-describedby={`${inputId}-description`}
          className="h-1.5 min-w-32 flex-1 cursor-pointer appearance-none rounded-full accent-[var(--color-inverse-background)] disabled:cursor-not-allowed disabled:opacity-70"
          style={{ accentColor: "var(--color-inverse-background)" }}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {showValue && (
          <output
            htmlFor={inputId}
            className="w-12 text-end text-sm font-medium tabular-nums text-text-primary"
          >
            {formatValue(value)}
          </output>
        )}
        {onReset && (
          <ResetButton onClick={onReset} disabled={disabled || isResetting} />
        )}
      </div>
    </SettingContainer>
  );
};
