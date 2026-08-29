import React from "react";

export type CardPadding = "none" | "sm" | "md";

/** `raised` is an object you select, drag or open. `inset` is a quoted block
 *  that belongs to the section around it and must not compete with a card. */
export type CardTone = "raised" | "inset";

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  as?: "div" | "article" | "li";
  padding?: CardPadding;
  tone?: CardTone;
}

const CARD_PADDING_CLASSES = {
  none: "",
  sm: "p-3",
  md: "p-4",
} as const;

/* The two tones differ in exactly one token, and in dark mode that difference
 * is the whole point: a raised card is LIGHTER than the page (grey-100) while
 * an inset panel is DARKER (bg-2). In light mode nothing goes above white, so
 * raised earns its lift from the hairline alone. */
const CARD_TONE_CLASSES = {
  raised: "border-border-subtle bg-surface",
  inset: "border-border-subtle bg-surface-sunken",
} as const;

/* Earn a surface: a card is for content that is genuinely card-shaped — a
 * stat tile, a model entry, something selectable. A settings group is not a
 * card; it is a heading and some spacing. A card never contains another card;
 * nest with spacing and dividers. */
export const Card: React.FC<CardProps> = ({
  as = "div",
  padding = "md",
  tone = "raised",
  className = "",
  children,
  ...props
}) => {
  const Element = as;
  return (
    <Element
      className={`rounded-panel border ${CARD_TONE_CLASSES[tone]} ${CARD_PADDING_CLASSES[padding]} ${className}`}
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
