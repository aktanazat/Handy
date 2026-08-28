import React, { useId } from "react";

interface SettingContainerProps {
  title: string;
  description: string;
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
  const copyClasses = disabled ? "opacity-75" : "";
  const title = (
    <h3
      id={titleId}
      className={`text-sm font-medium leading-5 text-text-primary ${copyClasses}`}
    >
      {controlId ? <label htmlFor={controlId}>{titleText}</label> : titleText}
    </h3>
  );
  const description = (
    <p
      id={descriptionId}
      className={`mt-0.5 text-[13px] leading-[18px] text-text-secondary ${copyClasses}`}
    >
      {descriptionText}
    </p>
  );

  if (layout === "stacked") {
    return (
      <div
        role="group"
        aria-disabled={disabled || undefined}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`${grouped ? "p-3" : "setting-panel p-3"} ${disabled ? "setting-panel-disabled" : ""}`}
      >
        {title}
        {description}
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
      </div>
      <div className="setting-control relative">{children}</div>
    </div>
  );
};
