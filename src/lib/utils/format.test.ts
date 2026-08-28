import { describe, expect, test } from "bun:test";
import { formatModelSize } from "./format";

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
