import * as React from "react";
import { FactChip, Microlabel, SettingsCard } from "@/components/settings/rows";
import { cn } from "@/lib/cn";

export interface ChartCardDelta {
  value: string;
  direction?: "positive" | "negative" | "neutral";
}

export interface ChartCardFact {
  label: string;
  value: React.ReactNode;
}

export interface ChartCardProps
  extends Omit<React.ComponentProps<typeof SettingsCard>, "children"> {
  label: string;
  metric: React.ReactNode;
  delta?: ChartCardDelta;
  children: React.ReactNode;
  footerFacts?: ChartCardFact[];
}

/* `bg-blue-alpha-200` and `bg-red-alpha-200` named tokens that do not exist:
 * only the gray scale has alphas, so a positive or negative delta drew its
 * text on nothing. The soft accent and the soft red do exist. */
const deltaClass = {
  positive: "bg-accent-soft text-accent-strong",
  negative: "bg-red-100 text-red-900",
  neutral: "bg-gray-alpha-200 text-gray-900",
} as const;

export function ChartCard({
  label,
  metric,
  delta,
  children,
  footerFacts,
  className,
  ...props
}: ChartCardProps) {
  const headingId = React.useId();

  return (
    <SettingsCard
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col gap-4 p-4", className)}
      {...props}
    >
      <div className="flex min-h-6 items-center">
        <h3 id={headingId} className="min-w-0 truncate">
          <Microlabel>{label}</Microlabel>
        </h3>
      </div>

      <div className="flex min-h-8 items-baseline gap-2">
        <div className="text-[24px] leading-7 font-medium tracking-tight text-gray-1000 tabular-nums">
          {metric}
        </div>
        {delta === undefined ? null : (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[12px] tabular-nums",
              deltaClass[delta.direction ?? "neutral"],
            )}
          >
            {delta.value}
          </span>
        )}
      </div>

      <div className="min-h-16">{children}</div>

      {footerFacts === undefined || footerFacts.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-alpha-400 pt-3">
          {footerFacts.map((fact) => (
            <FactChip key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </div>
      )}
    </SettingsCard>
  );
}
