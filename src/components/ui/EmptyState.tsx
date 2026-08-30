import React from "react";

/** Why the view is empty, which is what decides how the state should read. */
export type EmptyStateVariant =
  | "blank" /* first run: nothing has been created yet */
  | "informational" /* first run, but there is one obvious thing to do */
  | "no-results" /* a filter matched nothing; the data still exists */
  | "error"; /* the fetch failed; pair the action with a retry */

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** One action, the thing the person most likely came here to do. */
  action?: React.ReactNode;
  variant?: EmptyStateVariant;
  className?: string;
}

/* No illustration, no icon: a sentence explaining what is missing and one way
 * out of it. Only the informational variant earns a surface — a blank slate or
 * a zero-result filter is absence, and drawing a box around absence just adds
 * a second empty rectangle. Announced politely so a list that finishes loading
 * empty does not go silent for screen reader users. */
const CONTAINER_CLASSES = {
  blank: "px-1 py-8",
  informational:
    "rounded-card border border-transparent bg-surface-raised px-4 py-6 shadow-card",
  "no-results": "px-1 py-6",
  error: "px-1 py-6",
} as const;

const TITLE_CLASSES = {
  blank: "text-text-primary",
  informational: "text-text-primary",
  "no-results": "text-text-primary",
  error: "text-danger-strong",
} as const;

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  action,
  variant = "blank",
  className = "",
}) => {
  /* A region that is empty because a read failed is an error, not a status:
   * swapping content for the error variant has to reach assistive tech at
   * the same urgency the visible red title reaches everyone else. Every
   * other reason a view is empty is announced politely. */
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex flex-col items-start gap-3 ${CONTAINER_CLASSES[variant]} ${className}`}
    >
      <div className="space-y-1">
        <p
          className={`text-[13px] leading-[19px] font-medium ${TITLE_CLASSES[variant]}`}
        >
          {title}
        </p>
        {description && (
          <p className="max-w-[62ch] text-[12px] leading-4 text-pretty text-text-secondary">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
};
