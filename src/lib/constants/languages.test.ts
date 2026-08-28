import { describe, expect, test } from "bun:test";
import { getUniqueCapabilityLanguages } from "./languages";

describe("getUniqueCapabilityLanguages", () => {
  test("keeps first canonical language occurrence without mutating input", () => {
    const supportedLanguages = ["en-US", "en", "zh-Hant", "zh", "fr-CA", "fr"];

    expect(getUniqueCapabilityLanguages(supportedLanguages)).toEqual([
      "en",
      "zh",
      "fr",
    ]);
    expect(supportedLanguages).toEqual([
      "en-US",
      "en",
      "zh-Hant",
      "zh",
      "fr-CA",
      "fr",
    ]);
  });
});
