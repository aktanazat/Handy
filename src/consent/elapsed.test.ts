import { describe, expect, test } from "bun:test";

import { elapsedLabel } from "./elapsed";

const NOW = new Date(2026, 7, 30, 12, 0, 0).getTime();

describe("the recording pill's clock", () => {
  test("counts minutes and seconds under an hour", () => {
    expect(elapsedLabel(NOW, NOW)).toBe("0:00");
    expect(elapsedLabel(NOW - 7_000, NOW)).toBe("0:07");
    expect(elapsedLabel(NOW - 7 * 60_000 - 2_000, NOW)).toBe("7:02");
    expect(elapsedLabel(NOW - 59 * 60_000 - 59_000, NOW)).toBe("59:59");
  });

  test("adds an hours field once there is one to show", () => {
    expect(elapsedLabel(NOW - 60 * 60_000, NOW)).toBe("1:00:00");
    expect(elapsedLabel(NOW - 64 * 60_000 - 7_000, NOW)).toBe("1:04:07");
  });

  /* The shipped panel read "534032:50": unbounded minutes from a fixture whose
   * start was a year in the past. A year is still a year, but it reads as
   * elapsed time now instead of as a serial number. */
  test("keeps a long-running clock readable", () => {
    expect(elapsedLabel(NOW - 371 * 24 * 60 * 60_000, NOW)).toBe("8904:00:00");
  });

  /* No start means no elapsed time. Counting from the epoch, or backwards from
   * a start that has not happened, is what put the serial number on screen. */
  test("reads zero when there is no start to count from", () => {
    expect(elapsedLabel(null, NOW)).toBe("0:00");
    expect(elapsedLabel(undefined, NOW)).toBe("0:00");
    expect(elapsedLabel(0, NOW)).toBe("0:00");
    expect(elapsedLabel(NOW + 30_000, NOW)).toBe("0:00");
  });
});
