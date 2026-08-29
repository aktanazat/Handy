import { describe, expect, test } from "bun:test";
import {
  formatDurationShort,
  formatEntryTimestamp,
  formatModelSize,
  formatRelativeTime,
} from "./format";

const wholeNumber = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const oneDecimal = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

describe("formatModelSize", () => {
  test("preserves unit and precision boundaries", () => {
    expect(formatModelSize(null)).toBe("Unknown size");
    expect(formatModelSize(99.4)).toBe(`${oneDecimal.format(99.4)} MB`);
    expect(formatModelSize(100)).toBe(`${wholeNumber.format(100)} MB`);
    expect(formatModelSize(1024)).toBe(`${oneDecimal.format(1)} GB`);
    expect(formatModelSize(10240)).toBe(`${wholeNumber.format(10)} GB`);
  });
});

describe("formatDurationShort", () => {
  test("uses explicit units and drops zero remainders", () => {
    expect(formatDurationShort(0)).toBe("0s");
    expect(formatDurationShort(15)).toBe("15s");
    expect(formatDurationShort(192)).toBe("3m 12s");
    expect(formatDurationShort(180)).toBe("3m");
    expect(formatDurationShort(3840)).toBe("1h 4m");
    expect(formatDurationShort(7200)).toBe("2h");
  });
});

describe("formatEntryTimestamp", () => {
  test("includes the year only when it differs from now", () => {
    const now = new Date(2026, 7, 28, 12, 0, 0);
    const sameYearTs = new Date(2026, 7, 28, 18, 52).getTime();
    const otherYearTs = new Date(2025, 7, 28, 18, 52).getTime();
    expect(formatEntryTimestamp(sameYearTs, now).includes("2026")).toBe(false);
    expect(formatEntryTimestamp(otherYearTs, now)).toContain("2025");
  });
});

describe("formatRelativeTime", () => {
  test("scales units and falls back to the absolute date", () => {
    const now = new Date(2026, 7, 28, 12, 0, 0).getTime();
    const hourAgo = formatRelativeTime(now - 3600_000, now);
    expect(hourAgo).toContain("hour");
    const minutesAgo = formatRelativeTime(now - 120_000, now);
    expect(minutesAgo).toContain("minute");
    const old = formatRelativeTime(now - 86400_000 * 30, now);
    expect(old.includes("ago")).toBe(false);
  });
});
