import React from "react";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
  /** Marks the field invalid and wires aria-invalid for assistive tech. */
  invalid?: boolean;
  /** Leading indicator — a search glyph, a status dot. Never interactive. */
  icon?: React.ReactNode;
  /** Trailing control — a clear button, a unit, a count. May be interactive. */
  trailing?: React.ReactNode;
}

/* Border, radius and fill are the default button's, so a field and the button
 * next to it read as the same family. Focus moves the border colour and the
 * outline together rather than only drawing a ring outside the box. */
const INPUT_BASE_CLASSES =
  "control-surface border text-[13px] font-medium text-text-primary transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-in-out)] placeholder:text-text-tertiary focus-visible:border-focus-ring";

/* Padding is declared per side, never as the `px-*` shorthand. Tailwind resolves
 * `px-2` against `ps-7` by stylesheet order, not by the order of the class
 * attribute, and the shorthand was winning — which put the placeholder back
 * under the Library search glyph even with the slot padding applied. One
 * utility per side removes the contest instead of trying to win it. */
const INPUT_VARIANT_CLASSES = {
  default: { height: "min-h-8", padLead: "ps-3", padTrail: "pe-3" },
  compact: { height: "min-h-7", padLead: "ps-2", padTrail: "pe-2" },
} as const;

/* Icon geometry, and the reason this component owns a wrapper at all.
 *
 * Every call site that wanted a leading glyph used to absolutely position it
 * over the field and then guess at a padding override, which is how the Library
 * search shipped with its placeholder running under the magnifier. The padding
 * is not a caller's business: it is (inset + slot + gap), all three of which
 * belong to the variant. So the slot lives here, the input's own padding-inline
 * is replaced on the side that has a slot, and no page can get it wrong.
 *
 * The two slots are not symmetric, because they do not hold the same thing.
 * Leading is exactly one glyph, never interactive, so it is a fixed box centred
 * on the glyph size. Trailing holds a control — a clear button is 28px in the
 * default variant — so it is width-auto and hugs whatever it is given; a fixed
 * 16px box there would let a real button overhang the field's own border. The
 * trailing inset is 4px rather than the leading 8px so that inset + a 28px
 * button lands exactly on the 36px reserved by `pe-9`.
 *
 * leading  default: 8px inset + 16px glyph + 8px gap = 32px (ps-8)
 *          compact: 6px inset + 14px glyph + 8px gap = 28px (ps-7)
 * trailing default: 4px inset + up to 28px control + 4px = 36px (pe-9)
 *          compact: 4px inset + up to 24px control + 4px = 32px (pe-8)
 */
const SLOT_CLASSES = {
  default: {
    lead: "start-2 w-4 [&>svg]:h-4 [&>svg]:w-4",
    trail: "end-1 [&>svg]:h-4 [&>svg]:w-4",
    padLead: "ps-8",
    padTrail: "pe-9",
  },
  compact: {
    lead: "start-1.5 w-3.5 [&>svg]:h-3.5 [&>svg]:w-3.5",
    trail: "end-1 [&>svg]:h-3.5 [&>svg]:w-3.5",
    padLead: "ps-7",
    padTrail: "pe-8",
  },
} as const;

export const Input: React.FC<InputProps> = ({
  className = "",
  variant = "default",
  invalid = false,
  disabled,
  icon,
  trailing,
  ...props
}) => {
  const stateClasses = disabled
    ? "cursor-not-allowed bg-control-disabled text-text-disabled"
    : invalid
      ? "cursor-text border-danger-strong hover:border-danger-strong"
      : "cursor-text hover:border-border-strong active:bg-control-active";

  const slots = SLOT_CLASSES[variant];
  const slotted = Boolean(icon || trailing);
  const variantClasses = INPUT_VARIANT_CLASSES[variant];
  const layout = [
    variantClasses.height,
    /* Only a slotted field claims the row; a bare one keeps whatever intrinsic
       width its call site already lays out around. */
    slotted ? "min-w-0 flex-1" : "",
    icon ? slots.padLead : variantClasses.padLead,
    trailing ? slots.padTrail : variantClasses.padTrail,
  ]
    .filter(Boolean)
    .join(" ");

  const field = (
    <input
      className={`${INPUT_BASE_CLASSES} ${layout} ${stateClasses} ${className}`}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      {...props}
    />
  );

  if (!slotted) return field;

  return (
    <div className="relative flex w-full items-center">
      {icon && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute flex items-center justify-center text-text-tertiary ${slots.lead}`}
        >
          {icon}
        </span>
      )}
      {field}
      {trailing && (
        <span
          className={`absolute flex items-center justify-center text-text-tertiary ${slots.trail}`}
        >
          {trailing}
        </span>
      )}
    </div>
  );
};
