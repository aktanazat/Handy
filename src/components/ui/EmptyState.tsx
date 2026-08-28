import React from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** One action, the thing the person most likely came here to do. */
  action?: React.ReactNode;
  className?: string;
}

/* No illustration, no icon: a sentence explaining what is missing and one
 * way out of it. Announced politely so a list that finishes loading empty
 * does not go silent for screen reader users. */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  action,
  className = "",
}) => {
  return (
    <div
      role="status"
      className={`flex flex-col items-start gap-3 rounded-panel border border-border bg-surface px-4 py-6 ${className}`}
    >
      <div className="space-y-1">
        <p className="text-[13px] leading-[19px] font-medium text-text-primary">
          {title}
        </p>
        {description && (
          <p className="max-w-[62ch] text-[12.5px] leading-[18px] text-text-secondary text-pretty">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
};
