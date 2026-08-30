import React from "react";

/* A placeholder block. Never announce these: the region that owns them says
 * what is loading.
 *
 * Local rather than `vg/skeleton` because the two are not the same shape: the
 * kit's is `animate-pulse` on `bg-accent` at the kit radius, this one is a
 * slower 1.6s fade on `--color-subtle` at the control radius, and it is
 * `aria-hidden` so the `role="status"` wrapper below is the only thing a
 * screen reader hears. */
const Skeleton: React.FC<{ className?: string }> = ({ className = "" }) => (
  <div aria-hidden="true" className={`ui-skeleton ${className}`} />
);

export interface RouteSkeletonProps {
  /** Announced while the section chunk loads, for example "Loading...". */
  label: string;
}

/* Shape of a page before its chunk arrives: title block, then rows. Sized to
 * the real page rhythm so the swap does not jump. */
export const RouteSkeleton: React.FC<RouteSkeletonProps> = ({ label }) => (
  <div className="app-route-skeleton" role="status" aria-label={label}>
    <div className="space-y-2">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-[132px] w-full" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-[88px] w-full" />
    </div>
  </div>
);
