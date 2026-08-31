import type { CitedArtifactText, SummaryLineTrace } from "@/bindings";

/** One line of a summary, with the transcript segment it came from when the
 * artifact recorded one. */
export interface SummaryLine {
  text: string;
  segmentId: string | null;
  startOffsetNs: number | null;
}

/**
 * A summary read as the lines it was generated as, each carrying the segment a
 * reader lands on when they press it.
 *
 * `null` means this summary has no line provenance at all — every artifact
 * generated before the map existed, and any artifact whose map went missing —
 * and the caller renders the block the way it always did. Ordinals are counted
 * against the unfiltered split, so a stray blank line cannot shift a line onto
 * the wrong segment.
 */
export const summaryLines = (
  summary: CitedArtifactText,
  trace: SummaryLineTrace[] | null | undefined,
): SummaryLine[] | null => {
  if (trace === undefined || trace === null || trace.length === 0) return null;
  const anchors = new Map(trace.map((entry) => [entry.line, entry.anchor]));
  const lines = summary.text
    .split("\n")
    .map((raw, index) => ({ text: raw.trim(), index }))
    .filter((line) => line.text.length > 0)
    .map(({ text, index }) => {
      const anchor = anchors.get(index);
      return {
        text,
        segmentId: anchor?.segment_id ?? null,
        startOffsetNs: anchor?.start_offset_ns ?? null,
      };
    });
  if (lines.every((line) => line.segmentId === null)) return null;
  return lines;
};
