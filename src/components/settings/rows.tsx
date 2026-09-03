import * as React from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/vg/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/vg/tooltip";

/* The grammar every settings surface is written in.
 *
 * A page is one centered column. A section is a sentence-case microlabel over
 * a single `background-100` surface whose rows are separated by hairlines, not
 * a stack of boxes. A row states its setting once, on the left, and puts its control
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
    className={cn(
      PAGE_COLUMN,
      "flex flex-col gap-10 pt-12 pb-[72px]",
      className,
    )}
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

/** Sentence-case SF at 13px in the secondary text color. */
export const Microlabel: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <span className={cn("text-[13px] leading-5 text-gray-900", className)}>
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
      className="text-gray-700 transition-colors hover:text-gray-1000 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
    >
      <Info aria-hidden="true" className="size-3.5" />
    </TooltipTrigger>
    <TooltipContent className="max-w-64">{hint}</TooltipContent>
  </Tooltip>
);

/** A named measurement: label and value, nothing else. */
export const FactChip: React.FC<{
  label: string;
  value: React.ReactNode;
  className?: string;
}> = ({ label, value, className }) => (
  <span
    className={cn("inline-flex items-baseline gap-1.5 text-[13px]", className)}
  >
    <span className="text-gray-900">{label}</span>
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
      <h2 className="text-[13px] leading-5 text-gray-900">{label}</h2>
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
  /** A measured value that belongs beside the label. */
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
  /* Disabled rows dim their type without changing the controls beside it. */
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
        {/* A fact is a measurement, so its digits are tabular: a percentage
         * beside a slider must not shift the label under the drag. */}
        {fact ? <Microlabel className="tabular-nums">{fact}</Microlabel> : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
};

/**
 * A row's own controls, dimmed until the row is hovered or something inside it
 * takes focus. This is where a destructive control waits: a reading surface
 * does not print "delete" on every line, and the row under the pointer is the
 * only one being asked about. Opacity alone would strand a keyboard, so the
 * focus-within state carries exactly the same weight as the hover one.
 *
 * Needs a `group/row` ancestor — whichever element the pointer enters declares
 * it, which is the row itself in every current caller.
 */
export const RowActions: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <span
    className={cn(
      "flex items-center gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100",
      className,
    )}
  >
    {children}
  </span>
);

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
        {fact ? <Microlabel className="tabular-nums">{fact}</Microlabel> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
};

/**
 * A row whose control is a jump: the setting it names lives on another
 * surface, and this row is the one place that says where.
 *
 * Essentials uses it so a page of ten rows can still reach the editors behind
 * it without growing a section for each one.
 */
export const SettingsLinkRow: React.FC<{
  label: string;
  /** The verb on the button. "Open" for a catalog, "Edit" for an editor. */
  action: string;
  hint?: React.ReactNode;
  fact?: React.ReactNode;
  onOpen: () => void;
}> = ({ label, action, hint, fact, onOpen }) => (
  <SettingsRow label={label} hint={hint} fact={fact}>
    <Button type="button" variant="outline" size="sm" onClick={onOpen}>
      {action}
      <ChevronRight aria-hidden="true" />
    </Button>
  </SettingsRow>
);

/**
 * A task, a credential, or a reference that is one row until a reader needs
 * it. Advanced keeps its one-time setups here so they do not read as switches
 * that happen to be off.
 *
 * The kit has no collapsible, so this is `<details>` — no JavaScript for the
 * open state, and keyboard and screen-reader behaviour for free. The summary
 * is a settings row: label left, the state that decides whether you open it
 * on the right. `lazy` defers mounting the body until first open, for bodies
 * that fetch on mount (the agent-bridge console); a native `<details>` keeps
 * closed content in the DOM, so eager children would fetch unseen.
 */
export const SettingsDisclosure: React.FC<{
  label: string;
  /** The measured state a reader checks before opening this. */
  fact?: React.ReactNode;
  /** Mount children on first open instead of eagerly. */
  lazy?: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ label, fact, lazy = false, children, className }) => {
  const [opened, setOpened] = React.useState(!lazy);
  return (
    <details
      className={cn("group", className)}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-4 px-4 py-2.5 text-[13px] text-gray-1000 transition-colors hover:bg-gray-alpha-100 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        {label}
        <span className="flex shrink-0 items-center gap-3">
          {fact ? (
            <Microlabel className="tabular-nums">{fact}</Microlabel>
          ) : null}
          <ChevronDown
            aria-hidden="true"
            className="size-4 text-gray-700 transition-transform group-open:rotate-180"
          />
        </span>
      </summary>
      <div className="divide-y divide-gray-alpha-400 border-t border-gray-alpha-400">
        {opened ? children : null}
      </div>
    </details>
  );
};

const NOTICE_TONES = {
  muted: "text-gray-800",
  /** Something arrived that the reader did not ask for — a waiting update. */
  info: "text-accent-strong",
  warning: "text-amber-900",
  danger: "text-red-900",
} as const;

/**
 * One line of state: save blocked, a conflict, a failed command. `live`
 * announces it to assistive tech, which is why this is a shared component.
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
