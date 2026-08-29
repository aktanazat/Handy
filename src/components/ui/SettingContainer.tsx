import React, { useId } from "react";

export interface SettingContainerProps {
  title: string;
  description: string;
  /**
   * One extra line under the description, at caption weight: static copy about
   * how to *use* the control, like the tap/hold gesture on a dictation chord.
   *
   * Not a general hint slot. Anything field-adjacent — toned, `aria-live`, or
   * pointed at by a control's `aria-describedby` — belongs in
   * `vocabulary/PanelParts.Hint`, rendered as a child so it sits under the
   * field it describes rather than beside the title.
   */
  hint?: React.ReactNode;
  children: React.ReactNode;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  layout?: "horizontal" | "stacked";
  disabled?: boolean;
  tooltipPosition?: "top" | "bottom";
  controlId?: string;
}

export const SettingContainer: React.FC<SettingContainerProps> = ({
  title: titleText,
  description: descriptionText,
  hint,
  children,
  grouped = false,
  layout = "horizontal",
  disabled = false,
  controlId,
}) => {
  const titleId = useId();
  const generatedDescriptionId = useId();
  const descriptionId = controlId
    ? `${controlId}-description`
    : generatedDescriptionId;
  /* Disabled copy is dimmed by colour in primitives.css (`.setting-row-disabled`),
   * not by opacity: Geist never fades a control out, and opacity would also dim
   * the keycaps and badges a row may hold. */
  const title = (
    <h3
      id={titleId}
      className="text-[13px] leading-[19px] font-medium text-text-primary"
    >
      {controlId ? <label htmlFor={controlId}>{titleText}</label> : titleText}
    </h3>
  );
  const description = (
    <p
      id={descriptionId}
      className="mt-0.5 text-[12px] leading-4 text-text-secondary"
    >
      {descriptionText}
    </p>
  );
  const hintLine = hint ? <p className="setting-hint">{hint}</p> : null;

  if (layout === "stacked") {
    return (
      <div
        role="group"
        aria-disabled={disabled || undefined}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`${grouped ? "py-3" : "setting-panel py-3"} ${disabled ? "setting-panel-disabled" : ""}`}
      >
        {title}
        {description}
        {hintLine}
        <div className="mt-3 min-w-0">{children}</div>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-disabled={disabled || undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={`setting-row ${disabled ? "setting-row-disabled" : ""}`}
    >
      <div className="setting-copy">
        {title}
        {description}
        {hintLine}
      </div>
      <div className="setting-control relative">{children}</div>
    </div>
  );
};
