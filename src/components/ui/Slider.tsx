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
  /* The track paints its own filled portion: WebKit's native range rendering
   * (accent-color) left the rail invisible on both themes, so `.ui-range` in
   * styles/primitives.css draws rail + fill from this one custom property. */
  const fillPercent = max > min ? ((value - min) / (max - min)) * 100 : 0;

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
          className="ui-range min-w-32 flex-1"
          /* SAFETY: React.CSSProperties has no index for custom properties;
           * the cast admits the --range-fill variable the track CSS reads. */
          style={{ "--range-fill": `${fillPercent}%` } as React.CSSProperties}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {showValue && (
          <output
            htmlFor={inputId}
            className="w-12 text-end font-mono text-[12px] leading-4 tabular-nums text-text-primary"
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
