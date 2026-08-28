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
  return (
    <section className="settings-group space-y-1.5">
      {title && (
        <div className="px-0.5">
          <h2 className="text-[13px] font-semibold leading-[18px] text-text-secondary">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-xs leading-4 text-text-tertiary">
              {description}
            </p>
          )}
        </div>
      )}
      <div className="settings-group-panel">
        <div className="divide-y">{children}</div>
      </div>
    </section>
  );
};
