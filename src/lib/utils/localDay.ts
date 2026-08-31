import type { TFunction } from "i18next";

/* The local day, as every list in this app cuts and labels it.
 *
 * Grouping, the heading and the row's clock time are one grammar, which is why
 * they share a module: the heading owns the date, and that is exactly what lets
 * a row drop it. Two features read it — the dictation log and meeting history —
 * so it lives in neither of them. Before this, meeting history imported the day
 * arithmetic out of the history feature folder and rendered the *library's*
 * copy of "Today", and the bucketer itself existed twice.
 */

/**
 * Local midnight for a moment: a day group's identity, its React key, and the
 * heading's input.
 */
export const startOfLocalDay = (timestampMs: number): number => {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export interface LocalDayGroup<Item> {
  /** Local midnight in ms — stable React key and the heading's input. */
  startOfDayMs: number;
  items: Item[];
}

/**
 * One page of anything timestamped, split into day groups in the order it
 * arrived — both backends answer newest first, so the groups come out
 * reverse-chronological without a sort.
 *
 * Keyed accumulation rather than a break on day change: a page boundary lands
 * mid-day often enough, and appending a second "Today" under the first one is
 * exactly the seam paging must not show.
 *
 * `at` is the accessor rather than a field name because the two callers store
 * the moment differently — unix seconds on a history entry, UTC milliseconds on
 * a meeting — and converting at the boundary keeps that out of here.
 */
export const groupByLocalDay = <Item>(
  items: readonly Item[],
  at: (item: Item) => number,
): LocalDayGroup<Item>[] => {
  const byDay = new Map<number, Item[]>();
  for (const item of items) {
    const startOfDayMs = startOfLocalDay(at(item));
    const bucket = byDay.get(startOfDayMs);
    if (bucket) bucket.push(item);
    else byDay.set(startOfDayMs, [item]);
  }
  return Array.from(byDay, ([startOfDayMs, dayItems]) => ({
    startOfDayMs,
    items: dayItems,
  }));
};

/* Two formatters, made once. The heading names the weekday because a bare
 * "Aug 28" makes the reader do the conversion; the year appears only when it
 * is not the current one. */
const DAY_THIS_YEAR = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});

const DAY_OTHER_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * "Today" | "Yesterday" | "Thursday, Aug 28" | "Aug 28, 2025".
 *
 * Argument order follows `lib/utils/format`: the moment first, the clock last.
 * Any instant inside the day is accepted, not only its midnight, so a caller
 * grouping its own rows can label a group from the first row's timestamp.
 */
export const localDayHeading = (
  timestampMs: number,
  t: TFunction,
  nowMs: number = Date.now(),
): string => {
  const day = startOfLocalDay(timestampMs);
  const today = startOfLocalDay(nowMs);
  if (day === today) return t("common.day.today");

  /* Date arithmetic, not `today - 86400000`: a day is 23 or 25 hours twice a
   * year, and on those two mornings the subtraction labels yesterday as the
   * day before. */
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return t("common.day.yesterday");

  const date = new Date(day);
  return date.getFullYear() === new Date(nowMs).getFullYear()
    ? DAY_THIS_YEAR.format(date)
    : DAY_OTHER_YEAR.format(date);
};

const TIME_OF_DAY = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** "6:52 PM" — the whole of what a row says about when, its day says the rest. */
export const formatTimeOfDay = (timestampMs: number): string =>
  TIME_OF_DAY.format(timestampMs);
