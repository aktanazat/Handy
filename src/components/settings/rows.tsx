import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/vg/tooltip";

/* The grammar every settings surface is written in.
 *
 * A page is one centered column. A section is a mono microlabel over a single
 * `background-100` surface whose rows are separated by hairlines — not a stack
 * of boxes. A row states its setting once, on the left, and puts its control
 * flush right. There is no second sentence: a row that genuinely needs one
 * carries it as a tooltip, and a row that does not need one does not get one.
 *
 * The old `SettingContainer` printed a title *and* a description on every row,
 * which is why the pages read as the same sentence three times — group title,
 * row title, row description. `hint` is deliberately awkward to reach for. */

/* The page column, in one place. The shell's permission banners and its route
 * skeleton have to line up with page content, so they consume this too — and
 * vertical rhythm is not part of it, because a banner strip and a page do not
 * share the same padding. */
export const PAGE_COLUMN = "mx-auto w-full max-w-[760px] px-8";

/* The widest a control may grow beside its row label. Written in px because
 * under this app's 14px root the `max-w-[22rem]` it replaces rendered at
 * 308px, not the 352 its name implies. */
export const FIELD_MAX_W = "max-w-[308px]";

/* A section's surface: one `background-100` box inside a hairline, rows
 * divided by hairlines rather than spaced apart. `SettingsSection` draws it
 * under a label, `SettingsSurface` draws it alone, and the history feed puts
 * it on an `<ol>` — hence a class string and not only a component. */
export const SETTINGS_SURFACE =
  "divide-y divide-gray-alpha-400 overflow-hidden rounded-card border border-gray-alpha-400 bg-background-100";

/* Explicit px, not `text-2xl`. This app sets `:root { font-size: 14px }`
 * (styles/base.css), so every rem utility renders at 87.5% of its name:
 * `text-2xl` would be 21px here, not the 24 the type scale intends. Any size
 * that has to be a specific size is written in px on these pages. */
export const PageTitle: React.FC<React.ComponentProps<"h1">> = ({
  className,
  ...props
}) => (
  <h1
    className={cn(
      "text-[24px] leading-[30px] font-medium tracking-tight text-gray-1000",
      className,
    )}
    {...props}
  />
);

export const SettingsPage: React.FC<
  {
    /** Optional only because `header` can replace the title line outright. */
    title?: string;
    /** Actions for the page as a whole, rendered on the title line. */
    actions?: React.ReactNode;
    /**
     * Replaces the title line, for a page whose head is not a title beside an
     * action row: an editable meeting title, a back link over a title, a
     * loading placeholder. Those three used to hand-roll the whole column to
     * get it, which is how the measure came to be written in seven places.
     */
    header?: React.ReactNode;
    children: React.ReactNode;
  } & Omit<React.ComponentProps<"div">, "title" | "children">
> = ({ title, actions, header, children, className, ...props }) => (
  <div
    className={cn(PAGE_COLUMN, "flex flex-col gap-10 py-12", className)}
    {...props}
  >
    {header ?? (
      <div className="flex items-center justify-between gap-4">
        <PageTitle>{title}</PageTitle>
        {actions}
      </div>
    )}
    {children}
  </div>
);

/** Mono, uppercase, wide-tracked: the type a measurement is set in. */
export const Microlabel: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <span
    className={cn(
      "font-mono text-[11px] uppercase tracking-[0.12em] text-gray-800",
      className,
    )}
  >
    {children}
  </span>
);

/* No provider of its own: every window root mounts one `TooltipProvider` and
 * the primitives assume it. A unit test that renders a hinted row in isolation
 * brings its own — Radix's `Tooltip` throws without one. */
const HintTooltip: React.FC<{ label: string; hint: React.ReactNode }> = ({
  label,
  hint,
}) => (
  <Tooltip>
    <TooltipTrigger
      type="button"
      aria-label={label}
      className="text-gray-700 transition-colors hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
    >
      <Info aria-hidden="true" className="size-3.5" />
    </TooltipTrigger>
    <TooltipContent className="max-w-64">{hint}</TooltipContent>
  </Tooltip>
);

/** A named measurement — `DURATION 12:04`. Label and value, nothing else. */
export const FactChip: React.FC<{
  label: string;
  value: React.ReactNode;
  className?: string;
}> = ({ label, value, className }) => (
  <span
    className={cn(
      "inline-flex items-baseline gap-1.5 font-mono text-[11px]",
      className,
    )}
  >
    <span className="uppercase tracking-[0.12em] text-gray-700">{label}</span>
    <span className="tabular-nums text-gray-1000">{value}</span>
  </span>
);

export const SettingsSection: React.FC<{
  label: string;
  /** A control that belongs to the whole section, right of its label. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ label, action, children, className }) => (
  <section className={cn("flex flex-col gap-3", className)}>
    <div className="flex min-h-6 items-center justify-between gap-4">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-gray-800">
        {label}
      </h2>
      {action}
    </div>
    <div className={SETTINGS_SURFACE}>{children}</div>
  </section>
);

/**
 * `SettingsSection`'s surface without its label, for the one surface per tab
 * or page whose heading already names it. Printing "Recognition" as a section
 * heading directly under a selected tab reading "Recognition" is the repeat
 * this avoids.
 */
export const SettingsSurface: React.FC<React.ComponentProps<"div">> = ({
  className,
  ...props
}) => <div className={cn(SETTINGS_SURFACE, className)} {...props} />;

/* One concept, one box. A class string as well as a component because four of
 * its sites cannot be a `<section>`: two are `<div>`s inside a `<dl>`, one is
 * the `<p role="alert">` that states an import failure, and the meeting
 * preview is an `<li>`. */
export const SETTINGS_CARD =
  "rounded-card border border-gray-alpha-400 bg-background-100";

export const SettingsCard: React.FC<React.ComponentProps<"section">> = ({
  className,
  ...props
}) => <section className={cn(SETTINGS_CARD, className)} {...props} />;

export interface SettingsRowProps {
  /* A translated string, not a node: every caller labels rows with prose, and
   * the string doubles as the hint affordance's accessible name. */
  label: string;
  /**
   * The one thing about this row a reader cannot infer from its label and its
   * control. Rendered behind an info affordance, never inline. Most rows do
   * not need one; if the sentence only restates the label, delete it.
   */
  hint?: React.ReactNode;
  /** Accessible name for the hint affordance. Defaults to the label. */
  hintLabel?: string;
  /** A measured value that belongs beside the label, set in mono. */
  fact?: React.ReactNode;
  /** Associates the label with the control it names. */
  controlId?: string;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  hint,
  hintLabel,
  fact,
  controlId,
  disabled = false,
  children,
  className,
}) => {
  /* Disabled rows dim their type rather than their opacity: opacity would take
   * the keycaps and the mono facts down with it. */
  const labelClass = cn(
    /* 13px, the size a settings row has always been here — `text-sm` is
     * 12.25px under the 14px root and would quietly demote every label to the
     * secondary tier. */
    "truncate text-[13px]",
    disabled ? "text-gray-700" : "text-gray-1000",
  );
  return (
    <div
      data-slot="settings-row"
      data-disabled={disabled || undefined}
      className={cn(
        "flex min-h-[52px] items-center justify-between gap-6 px-4 py-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {controlId ? (
          <label htmlFor={controlId} className={labelClass}>
            {label}
          </label>
        ) : (
          <span className={labelClass}>{label}</span>
        )}
        {hint ? <HintTooltip label={hintLabel ?? label} hint={hint} /> : null}
        {fact ? <Microlabel>{fact}</Microlabel> : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
};

/**
 * A row whose control is too wide to sit beside its label — a text area, a
 * list, a recorder. Same hairline surface, label stacked over the control.
 */
export const SettingsField: React.FC<SettingsRowProps> = ({
  label,
  hint,
  hintLabel,
  fact,
  controlId,
  disabled = false,
  children,
  className,
}) => {
  const labelClass = cn(
    "text-[13px]",
    disabled ? "text-gray-700" : "text-gray-1000",
  );
  return (
    <div
      data-slot="settings-field"
      data-disabled={disabled || undefined}
      className={cn("flex flex-col gap-2 px-4 py-3", className)}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          {controlId ? (
            <label htmlFor={controlId} className={labelClass}>
              {label}
            </label>
          ) : (
            <span className={labelClass}>{label}</span>
          )}
          {hint ? <HintTooltip label={hintLabel ?? label} hint={hint} /> : null}
        </div>
        {fact ? <Microlabel>{fact}</Microlabel> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
};

const NOTICE_TONES = {
  muted: "text-gray-800",
  /** Something arrived that the reader did not ask for — a waiting update. */
  info: "text-blue-900",
  warning: "text-amber-900",
  danger: "text-red-900",
} as const;

/**
 * One line of state — save blocked, a conflict, a failed command. A sentence,
 * not a box: Geist does not draw a panel around a status. `live` announces it
 * to assistive tech, which is the whole reason this is a primitive rather than
 * a `<p>` each surface writes for itself.
 */
export const Notice: React.FC<{
  tone?: keyof typeof NOTICE_TONES;
  live?: boolean;
  /**
   * Interrupt the reader instead of queueing behind them: `role="alert"`
   * carries an implicit assertive live region. For an action the user is
   * waiting on that was refused — a failed save, a rejected consent, a write
   * conflict.
   */
  assertive?: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({
  tone = "muted",
  live = true,
  assertive = false,
  children,
  className,
}) => (
  <p
    role={assertive ? "alert" : live ? "status" : undefined}
    aria-live={assertive ? "assertive" : live ? "polite" : undefined}
    className={cn("text-[13px] leading-5", NOTICE_TONES[tone], className)}
  >
    {children}
  </p>
);
