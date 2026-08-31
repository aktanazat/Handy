import type { PersonMeetingLink } from "@/bindings";

export const confirmedPersonLinks = (
  links: readonly PersonMeetingLink[],
): PersonMeetingLink[] =>
  links.filter((link) => link.confidence === "confirmed");

/** Six UTC calendar-month buckets, oldest first. UTC keeps the projection
 * deterministic at local midnight and matches the store's UTC timestamps. */
export const monthlyMeetingCadence = (
  links: readonly PersonMeetingLink[],
  nowUtcMs: number = Date.now(),
  monthCount = 6,
): number[] => {
  const now = new Date(nowUtcMs);
  const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const firstMonth = currentMonth - monthCount + 1;
  const values = Array.from({ length: monthCount }, () => 0);

  for (const link of links) {
    if (link.confidence !== "confirmed") continue;
    const at = new Date(link.meeting.at_utc_ms);
    const month = at.getUTCFullYear() * 12 + at.getUTCMonth();
    const index = month - firstMonth;
    if (index >= 0 && index < monthCount) values[index] += 1;
  }

  return values;
};

export const latestConfirmedMeetingAt = (
  links: readonly PersonMeetingLink[],
): number | null => {
  let latest: number | null = null;
  for (const link of links) {
    if (link.confidence !== "confirmed") continue;
    if (latest === null || link.meeting.at_utc_ms > latest) {
      latest = link.meeting.at_utc_ms;
    }
  }
  return latest;
};
