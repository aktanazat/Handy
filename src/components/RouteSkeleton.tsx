import React from "react";

export interface SkeletonProps {
  /** Sizing utilities, for example "h-4 w-40". */
  className?: string;
}

/* A placeholder block. Never announce these: the region that owns them says
 * what is loading. */
export const Skeleton: React.FC<SkeletonProps> = ({ className = "" }) => (
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
