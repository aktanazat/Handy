import type { HistoryTrendPoint } from "@/bindings";

export const ACTIVITY_DAYS_PER_PAGE = 7;

export function activityPage(
  points: readonly HistoryTrendPoint[],
  pageIndex: number,
) {
  const pageCount = Math.max(
    1,
    Math.ceil(points.length / ACTIVITY_DAYS_PER_PAGE),
  );
  const page = Math.min(pageIndex, pageCount - 1);
  const end = points.length - page * ACTIVITY_DAYS_PER_PAGE;
  const start = Math.max(0, end - ACTIVITY_DAYS_PER_PAGE);
  return { page, start, points: points.slice(start, end) };
}
