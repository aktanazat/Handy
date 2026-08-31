import type { SpeakerTalkShare } from "../meetingAnalytics";

/* D25: who did the talking, in one line.
 *
 * The shares themselves are not computed here. `talk_metrics` in Rust owns
 * them — it reads the diarized spans, handles overlap, and hands back
 * per-mille — and the Insights strip prints the same numbers. This turns those
 * shares into bar widths, which is the only arithmetic the row adds.
 *
 * The widths are whole percents that sum to exactly 100, by largest remainder.
 * A bar assembled from independently rounded parts leaves a sliver of
 * background showing at the end, and a hairline with a gap in it reads as a
 * rendering bug rather than as a measurement. */

export interface TalkTimeSlice {
  speakerId: string;
  name: string;
  /** The measurement, straight from the analytics. */
  permille: number;
  /** The slice's width as a whole percent. Slices sum to 100. */
  percent: number;
}

/**
 * One slice per speaker who actually said something, widest first.
 *
 * Speakers with no measured speech are dropped rather than drawn as zero-width
 * slices: a name on a bar it contributes nothing to is a lie about the
 * conversation, and the legend beside the bar would list somebody who never
 * spoke.
 */
export const talkTimeSlices = (
  shares: readonly SpeakerTalkShare[],
  nameOf: (speakerId: string) => string,
): TalkTimeSlice[] => {
  const heard = shares
    .filter((share) => share.share_permille > 0)
    .sort((left, right) => right.share_permille - left.share_permille);
  const total = heard.reduce((sum, share) => sum + share.share_permille, 0);
  if (total === 0) return [];

  /* Largest remainder: floor every share, then hand the leftover whole
   * percents to the slices that lost the most in the rounding. */
  const exact = heard.map((share) => (share.share_permille * 100) / total);
  const floors = exact.map(Math.floor);
  const spare = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((left, right) => right.remainder - left.remainder);
  for (let given = 0; given < spare; given += 1) {
    floors[order[given % order.length].index] += 1;
  }

  return heard.map((share, index) => ({
    speakerId: share.speaker_id,
    name: nameOf(share.speaker_id),
    permille: share.share_permille,
    percent: floors[index],
  }));
};
