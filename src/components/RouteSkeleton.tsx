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

/* Shape of a page before its chunk arrives: the title block, then the sections
 * under it, on the page's own rhythm — a 26px title line and `gap-8` between
 * sections, which is what `SettingsPage` lays out. The layout used to live in
 * shell.css as `.app-route-skeleton`, from when this file was frozen legacy;
 * it is four utilities, so it says them here and the rule is gone. */
export const RouteSkeleton: React.FC<RouteSkeletonProps> = ({ label }) => (
  <div
    className="flex w-full flex-col gap-8 pt-1"
    role="status"
    aria-label={label}
  >
    <div className="space-y-2">
      <Skeleton className="h-[26px] w-56" />
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
