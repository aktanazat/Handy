import React from "react";

export interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
}) => {
  /* Type and spacing live in primitives.css (`.settings-group`), which is
   * unlayered and therefore beats Tailwind's `@layer utilities` — inline size
   * or colour utilities here would be dead source. The group is a heading plus
   * spacing, not a panel: `.settings-group-panel` no longer draws a box, it
   * only carries the inter-row hairlines. */
  return (
    <section className="settings-group">
      {title && (
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      )}
      <div className="settings-group-panel">
        <div className="divide-y">{children}</div>
      </div>
    </section>
  );
};
