import React from "react";

export type CardPadding = "none" | "sm" | "md";

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  as?: "div" | "article" | "li";
  padding?: CardPadding;
}

const CARD_PADDING_CLASSES = {
  none: "",
  sm: "p-3",
  md: "p-4",
} as const;

/* A flat hairline surface. Cards are for content that is genuinely
 * card-shaped: a stat tile, a model entry. Lists of rows want List and Row.
 * A card never contains another card; nest with spacing and dividers. */
export const Card: React.FC<CardProps> = ({
  as = "div",
  padding = "md",
  className = "",
  children,
  ...props
}) => {
  const Element = as;
  return (
    <Element
      className={`rounded-panel border border-border bg-surface ${CARD_PADDING_CLASSES[padding]} ${className}`}
      {...props}
    >
      {children}
    </Element>
  );
};

export interface SectionProps {
  title?: string;
  description?: string;
  /** Controls rendered opposite the title, usually one button. */
  actions?: React.ReactNode;
  headingLevel?: 2 | 3;
  children: React.ReactNode;
  className?: string;
}

/* A titled region of a page. Sections are separated by space, not boxes:
 * the heading block sits above bare content. Use SettingsGroup when the
 * content is a divided panel of setting rows. */
export const Section: React.FC<SectionProps> = ({
  title,
  description,
  actions,
  headingLevel = 2,
  children,
  className = "",
}) => {
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <section className={`settings-group ${className}`}>
      {(title || actions) && (
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {title && <Heading>{title}</Heading>}
            {description && <p>{description}</p>}
          </div>
          {actions && (
            <div className="flex flex-none items-center gap-2">{actions}</div>
          )}
        </div>
      )}
      {children}
    </section>
  );
};
