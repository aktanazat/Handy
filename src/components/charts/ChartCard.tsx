import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FactChip, Microlabel, SettingsCard } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { cn } from "@/lib/cn";

export interface ChartCardRange {
  label: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
}

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
  range?: ChartCardRange;
  children: React.ReactNode;
  footerFacts?: ChartCardFact[];
}

const deltaClass = {
  positive: "bg-blue-alpha-200 text-blue-900",
  negative: "bg-red-alpha-200 text-red-900",
  neutral: "bg-gray-alpha-200 text-gray-900",
} as const;

export function ChartCard({
  label,
  metric,
  delta,
  range,
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
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h3 id={headingId} className="min-w-0 truncate">
          <Microlabel>{label}</Microlabel>
        </h3>
        {range === undefined ? null : (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={range.previousLabel}
              disabled={range.previousDisabled}
              onClick={range.onPrevious}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="min-w-[9.5ch] text-center text-[11px] text-gray-800 tabular-nums">
              {range.label}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={range.nextLabel}
              disabled={range.nextDisabled}
              onClick={range.onNext}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex min-h-8 items-baseline gap-2">
        <div className="text-[24px] leading-7 font-medium tracking-tight text-gray-1000 tabular-nums">
          {metric}
        </div>
        {delta === undefined ? null : (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
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
