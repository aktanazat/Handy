import { describe, expect, test } from "bun:test";
import { talkTimeSlices } from "./talkTime";
import type { SpeakerTalkShare } from "../meetingAnalytics";

const share = (speakerId: string, sharePermille: number): SpeakerTalkShare => ({
  speaker_id: speakerId,
  speaking_ns: sharePermille * 1_000_000,
  share_permille: sharePermille,
  turn_count: 1,
  longest_monologue_ns: 0,
});

const named = (speakerId: string) => `Speaker ${speakerId}`;

describe("talkTimeSlices", () => {
  test("orders speakers by how much of the meeting they held", () => {
    const slices = talkTimeSlices(
      [share("quiet", 200), share("loud", 600), share("middle", 200)],
      named,
    );

    expect(slices.map((slice) => slice.speakerId)).toEqual([
      "loud",
      "quiet",
      "middle",
    ]);
    expect(slices[0].percent).toBe(60);
    expect(slices[0].permille).toBe(600);
    expect(slices[0].name).toBe("Speaker loud");
  });

  test("widths always sum to a full bar", () => {
    // Three equal shares are 33.33% each, so naive rounding leaves 1% of the
    // hairline unpainted.
    const thirds = talkTimeSlices(
      [share("a", 333), share("b", 333), share("c", 334)],
      named,
    );
    expect(thirds.reduce((sum, slice) => sum + slice.percent, 0)).toBe(100);

    // Seven speakers is the ugly case: 14.28% each, six percent to hand out.
    const seven = talkTimeSlices(
      Array.from({ length: 7 }, (_unused, index) =>
        share(`speaker-${index}`, 100),
      ),
      named,
    );
    expect(seven.reduce((sum, slice) => sum + slice.percent, 0)).toBe(100);
    expect(seven).toHaveLength(7);
  });

  test("shares that do not add up to a whole are still a full bar", () => {
    // Overlap and unattributable speech mean the store's shares need not sum
    // to 1000. The bar is of the speech that was attributed, not of the clock.
    const slices = talkTimeSlices([share("a", 300), share("b", 100)], named);

    expect(slices.map((slice) => slice.percent)).toEqual([75, 25]);
  });

  test("a speaker who said nothing is left off the bar", () => {
    const slices = talkTimeSlices(
      [share("heard", 1_000), share("silent", 0)],
      named,
    );

    expect(slices).toHaveLength(1);
    expect(slices[0].speakerId).toBe("heard");
    expect(slices[0].percent).toBe(100);
  });

  test("no measured speech is no bar rather than a bar of zeros", () => {
    expect(talkTimeSlices([], named)).toEqual([]);
    expect(talkTimeSlices([share("a", 0), share("b", 0)], named)).toEqual([]);
  });
});
