/* Survivors of the legacy kit, not a design system.
 *
 * src/components/vg is the primitive kit: every button, input, select, dialog,
 * popover, menu, switch, slider, tab and tooltip in the app comes from there,
 * Geist-coloured through app/globals.css's `@theme inline` bridge. It is the
 * only place a primitive may be added, and components.json points the shadcn
 * CLI at it ("ui": "@/components/vg") so generated components land there too.
 *
 * What is left here is app-specific and has no vg counterpart yet:
 *
 *   AudioPlayer, AudioPlayerGroup  a transcript's audio scrubber, not a generic
 *                                  control — Library owns its whole interaction
 *   RouteSkeleton                  the shape of a settings page before its
 *                                  chunk arrives, sized to this app's rhythm
 *   Toaster                        the app's one toast root (vg/sonner was
 *                                  deleted unused; adopting it means moving
 *                                  this root, not adding a second one)
 *   Badge, Button, Dialog          still consumed by the onboarding and
 *                                  whats-new surfaces, which were not part of
 *                                  the redesign pass
 *
 * Each of these retires by moving its consumers onto a vg primitive, not by
 * being widened here. Nothing new goes in this folder.
 */

export { AudioPlayer, AudioPlayerGroup } from "./AudioPlayer";
export type { AudioPlayerProps } from "./AudioPlayer";

export { default as Badge } from "./Badge";
export type { BadgeProps } from "./Badge";

export { Button } from "./Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";

export { Dialog } from "./Dialog";
export type { DialogProps } from "./Dialog";

export { RouteSkeleton } from "./Skeleton";
export type { RouteSkeletonProps } from "./Skeleton";

export { Toaster } from "./Toast";
