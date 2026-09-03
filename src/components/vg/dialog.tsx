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
        className={cn(
          "popup-motion fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-dialog border bg-surface-raised p-6 shadow-[var(--shadow-dialog)] outline-none sm:max-w-lg",
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
            className="absolute top-4 end-4 grid size-7 place-items-center rounded-control text-gray-900 transition-colors hover:bg-gray-alpha-200 hover:text-gray-1000 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
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
      /* Logical `text-start`, for the same reason as the close button: the
       * title has to lead from the side the reader starts on, opposite the
       * button. */
      className={cn("flex flex-col gap-2 text-center sm:text-start", className)}
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
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
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
      /* 14/20 semibold: the app's own heading role, not the kit's 15.75px on a
       * zero line box. A modal title is the largest type on its surface, and
       * the ladder's ceiling for a title is 14 (theme.css). */
      className={cn("text-[14px] leading-5 font-semibold", className)}
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
      className={cn("text-[13px] leading-5 text-gray-900", className)}
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
