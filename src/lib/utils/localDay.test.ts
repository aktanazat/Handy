import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createInstance } from "i18next";
import { groupByLocalDay, localDayHeading, startOfLocalDay } from "./localDay";

/* The day, for both lists that are read by it.
 *
 * These checks used to live beside the dictation log because the bucketer did;
 * meeting history then carried a line-for-line copy of it and rendered the
 * library's own "Today". One module, one set of checks, and the grouping is
 * exercised through both element shapes so a change that suits one caller
 * cannot quietly break the other.
 *
 * Two defects are pinned dead here, both of which shipped: a page-split day
 * appearing twice, and `midnight - 86400000` renaming the day before yesterday
 * as "Yesterday" on the two mornings a day is not 24 hours long. */

const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: {
      translation: JSON.parse(
        fs.readFileSync(
          path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
            "i18n",
            "locales",
            "en",
            "translation.json",
          ),
          "utf8",
        ),
      ),
    },
  },
  interpolation: { escapeValue: false },
  parseMissingKeyHandler: () => "__MISSING__",
});

const NOON = 12 * 60 * 60 * 1000;
const today = startOfLocalDay(Date.now()) + NOON;

const dayBefore = (from: number, days: number) => {
  const date = new Date(from);
  date.setDate(date.getDate() - days);
  return date.getTime();
};

/** A dictation entry keeps unix seconds; a meeting keeps UTC milliseconds. */
interface EntryFixture {
  id: number;
  timestamp: number;
}
interface MeetingFixture {
  session_id: string;
  created_at_utc_ms: number;
}

const entryAt = (id: number, timestampMs: number): EntryFixture => ({
  id,
  timestamp: Math.floor(timestampMs / 1000),
});
const meetingAt = (
  sessionId: string,
  createdAtUtcMs: number,
): MeetingFixture => ({
  session_id: sessionId,
  created_at_utc_ms: createdAtUtcMs,
});

const entryDays = (entries: EntryFixture[]) =>
  groupByLocalDay(entries, (entry) => entry.timestamp * 1000);

describe("grouping by local day", () => {
  test("splits a page into days, newest day first", () => {
    expect(
      entryDays([
        entryAt(3, today),
        entryAt(2, dayBefore(today, 1)),
        entryAt(1, dayBefore(today, 5)),
      ]).map((group) => group.items.map((entry) => entry.id)),
    ).toEqual([[3], [2], [1]]);
  });

  test("a day split across two pages stays one group", () => {
    // The next page's first rows are usually the same day as the last page's
    // last rows. Breaking on day *change* would print that day twice.
    const groups = entryDays([
      entryAt(4, today),
      entryAt(3, dayBefore(today, 1)),
      entryAt(2, today - 60_000),
      entryAt(1, dayBefore(today, 1) - 60_000),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual([4, 2]);
    expect(groups[1]?.items.map((entry) => entry.id)).toEqual([3, 1]);
  });

  test("groups key on local midnight, so a late-night row files under its own day", () => {
    const lateLastNight =
      startOfLocalDay(dayBefore(today, 1)) + 23.5 * 3600_000;
    const earlyToday = startOfLocalDay(today) + 30 * 60 * 1000;

    expect(
      entryDays([entryAt(2, earlyToday), entryAt(1, lateLastNight)]),
    ).toHaveLength(2);
  });

  test("cuts a meeting page at the same instant it cuts a dictation page", () => {
    /* The accessor is the only thing that differs between the two callers, so
     * the same three moments have to bucket identically through both. */
    const moments = [today, dayBefore(today, 1), today - 60_000];

    expect(
      groupByLocalDay(
        moments.map((at, index) => meetingAt(`session-${index}`, at)),
        (meeting) => meeting.created_at_utc_ms,
      ).map((group) => group.items.map((meeting) => meeting.session_id)),
    ).toEqual([["session-0", "session-2"], ["session-1"]]);
    expect(
      entryDays(moments.map((at, index) => entryAt(index, at))).map((group) =>
        group.items.map((entry) => entry.id),
      ),
    ).toEqual([[0, 2], [1]]);
  });

  test("an empty page is no groups, not one empty group", () => {
    expect(entryDays([])).toEqual([]);
  });
});

describe("the day heading", () => {
  test("names today and yesterday in words, and older days by date", () => {
    const t = i18n.t.bind(i18n);

    expect(localDayHeading(today, t, today)).toBe("Today");
    expect(localDayHeading(dayBefore(today, 1), t, today)).toBe("Yesterday");

    const older = localDayHeading(dayBefore(today, 9), t, today);
    expect(older).not.toBe("Today");
    expect(older).not.toBe("Yesterday");
    // Weekday plus month and day, no year: this year needs no year.
    expect(older).toMatch(/day,/);
    expect(older).not.toContain(String(new Date(today).getFullYear()));
  });

  test("reads its copy from a namespace neither list owns", () => {
    /* The keys were `libraryV2.day.*` while the meetings page rendered them,
     * which is how the Meetings surface came to print the Library's words. */
    expect(String(i18n.t("common.day.today"))).toBe("Today");
    expect(String(i18n.t("common.day.yesterday"))).toBe("Yesterday");
  });

  test("crosses a DST boundary without renaming yesterday", () => {
    /* The subtraction this replaces (`midnight - 86400000`) lands at 23:00 or
     * 01:00 on the two mornings a day is not 24 hours long, and labels the day
     * before yesterday as "Yesterday". Checked on both US transitions. */
    for (const transition of ["2026-03-08T12:00:00", "2026-11-01T12:00:00"]) {
      const now = new Date(transition).getTime();

      expect(localDayHeading(dayBefore(now, 1), i18n.t.bind(i18n), now)).toBe(
        "Yesterday",
      );
      expect(
        localDayHeading(dayBefore(now, 2), i18n.t.bind(i18n), now),
      ).not.toBe("Yesterday");
    }
  });

  test("adds the year once the day is not in this one", () => {
    const lastYear = new Date(today);
    lastYear.setFullYear(lastYear.getFullYear() - 1);

    expect(
      localDayHeading(lastYear.getTime(), i18n.t.bind(i18n), today),
    ).toContain(String(lastYear.getFullYear()));
  });
});
