import * as React from "react";
import { XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";
import { Button } from "@/components/vg/button";

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      /* The scrim fades on the same clock as the surface it dims — in on
       * --duration-standard, out on --duration-fast — so the two never read as
       * two events. Opacity only: `.popup-motion`'s scale would shrink a
       * fixed inset-0 layer and show the page's edges through the corners for
       * a frame. */
      className={cn(
        "fixed inset-0 z-50 bg-backdrop ease-[var(--ease-in-out)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[var(--duration-fast)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[var(--duration-standard)] data-[state=open]:ease-[var(--ease-out)]",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  material = "solid",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /**
   * Whether this modal may go translucent when the Material setting is Glass.
   *
   * Solid by default, and the default is the load-bearing half. A modal whose
   * body is measured data — a table, an import preview, a transcript, a diff —
   * is read, and reading rows through a backdrop that moves when the window
   * behind it moves is worse than reading them off a plate, whatever the
   * contrast ratio measures. styles/primitives.css states the same rule for
   * content surfaces; this is that rule applied to modals, and stating it as
   * the default rather than as a convention is what makes the next data modal
   * somebody adds opaque without their having read any of this.
   *
   * Prose asks for glass: a release note, a confirmation, a consent sentence.
   * Rows do not.
   */
  material?: "solid" | "glass";
}) {
  const { t } = useTranslation();
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        /* No `data-material` attribute here on purpose: that name belongs to
         * the document root, which Rust owns and writes per window, and a copy
         * of it on a descendant would make `[data-material="glass"] .x`
         * selectors match inside a solid modal. The class carries the choice. */
        /* `popup-motion` (styles/popups.css) is the one entrance and exit
         * every floating surface in the app shares: 180ms on --ease-out from
         * --popup-enter-scale in, 120ms on --ease-in-out to opacity 0 out,
         * fade-only under reduced motion. It replaces the kit's `animate-in`
         * stack, whose 0.95 zoom and 200ms were a second dialect of the same
         * sentence — and whose scale the palette then re-timed to 150ms, so no
         * two popups in the app moved alike.
         *
         * `--surface-raised`, not `bg-background`: the page's own colour over a
         * dimmed copy of that same page read as a hole rather than as a sheet
         * on top of it, and the raised step is what says "this is nearer to
         * you than the window". A modal that opted into glass has the fill
         * replaced by `--glass-tint` and a specular line laid over
         * `--shadow-dialog` by the material rule, so it keeps exactly one
         * shadow either way. */
        /* One width for every modal: 560px, or the window less a 14px gutter
         * when the window is narrower than that. Written as a single
         * `max-w-[min(...)]` rather than as the kit's `max-w-[calc(...)]` plus
         * `sm:max-w-lg` pair, because those are two conflicting classes in two
         * different variant groups: tailwind-merge cannot collapse them, so a
         * caller asking for `max-w-xl` lost to the `sm:` rule in the cascade
         * and got 448px instead. One class is one thing to override. */
        className={cn(
          "popup-motion fixed top-[50%] left-[50%] z-50 grid w-full max-w-[min(560px,calc(100%-2rem))] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-dialog border border-gray-alpha-400 bg-surface-raised p-6 shadow-[var(--shadow-dialog)] outline-none",
          material === "glass" && "glass-surface",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          /* `end-4`, not `right-4`: the shell sets `dir` per language, and a
           * close button pinned to the physical right sits at the start of a
           * right-to-left dialog, where its title begins.
           *
           * A quiet control rather than a dimmed one. `opacity-70` fades the
           * glyph AND whatever it sits on, which on a frosted panel means the
           * backdrop shows through the mark itself; `--gray-900` is the same
           * visual weight, stated as the secondary tier it belongs to, and it
           * still passes AA. The focus classes are gone so base.css's 2px
           * bronze `--focus-outline` applies here like it does everywhere
           * else — the kit's translucent ring was the app's only glow. The
           * `data-[state=open]` pair went with them: a Close has no open
           * state, so those two utilities never matched anything. */
          <DialogPrimitive.Close
            data-slot="dialog-close"
            /* Aligned to the title, not to the corner. The dialog pads 21px,
             * the title's line box is 25px, so its optical centre sits 33.5px
             * down: a 28px button starts at 19px. `end-4` is 14px, which puts
             * the 14px glyph's own right edge on the 21px text column — the
             * button's box overhangs it by the 7px of air inside it, which is
             * how an icon button optically aligns with type. */
            className="absolute top-[19px] end-4 grid size-[28px] place-items-center rounded-md text-gray-900 transition-colors hover:bg-hover hover:text-gray-1000 disabled:pointer-events-none motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[14px]"
          >
            <XIcon />
            <span className="sr-only">{t("common.close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      /* A header band, as the reference draws it: the title leading from the
       * reader's side, the close button opposite it, and a hairline under both
       * that runs the full width of the sheet. `-mx-6 px-6` is what makes the
       * rule full-bleed while the words stay on the dialog's text column; a
       * modal that replaces the 24px padding (`p-0`) has to cancel the pull
       * with `mx-0`, which RecorderDialog — the one such modal with a real
       * header — does.
       *
       * Logical `text-start`, for the same reason as the close button: the
       * title has to lead from the side the reader starts on. The kit's
       * `text-center sm:text-start` pair centred it below 640px, a width this
       * app's fixed 900px window never sees. */
      className={cn(
        "-mx-6 flex flex-col gap-2 border-b border-gray-alpha-400 px-6 pb-4 text-start",
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="dialog-footer"
      /* One action fills the width — the reference's black plate across the
       * foot of a dialog — and two or more sit at the trailing edge. `:only-child`
       * is what tells them apart, so a caller states its intent by how many
       * buttons it renders rather than by remembering a class. `showCloseButton`
       * adds a second child, which correctly cancels the full-width rule. */
      className={cn(
        "flex flex-row justify-end gap-2 [&>:only-child]:w-full",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{t("common.close")}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      /* 16/25 semibold: the app's own lede role, not the kit's 15.75px on a
       * zero line box. A modal title is the largest type on its surface, and
       * body on that surface is now 14 — a 14px title tied with it.
       *
       * `pe-12` clears the close button (14px inset + 28px box) so a long
       * title wraps above it instead of running under the glyph. The clearance
       * lives here rather than on the header because a caller that restates
       * the header's padding — RecorderDialog does — would drop it. */
      className={cn(
        "text-[16px] leading-[25px] font-semibold pe-12",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-[14px] leading-[21px] text-gray-900", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
