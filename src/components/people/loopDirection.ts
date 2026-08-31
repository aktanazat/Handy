import type { MeetingLoopDirection } from "@/bindings";

/* D27: which way a ledger row points.
 *
 * "What did I promise Steven" and "what is Steven still sitting on" are the
 * two halves of one relationship, and a page that ran them together as one
 * list answered neither. The store decides the direction once, where the row
 * is built, from the owner the user picked or the voice that said it; these
 * surfaces only group by it. */

export interface DirectedGroups<Row> {
  /** What the user owes out of meetings with this person. */
  mine: Row[];
  /** What this person owes. */
  waitingOn: Row[];
}

/**
 * Split rows into the two lists a person reads.
 *
 * Only `mine` and `waiting_on` reach a person page or a brief — the store
 * drops unattributed rows before either surface sees them, because a row
 * nobody owns is not part of anybody's relationship. Bucketing on `mine`
 * rather than testing both names keeps the split total, so a row can never
 * fall out of the page by being neither.
 */
export const groupByDirection = <
  Row extends { direction: MeetingLoopDirection },
>(
  rows: readonly Row[],
): DirectedGroups<Row> => ({
  mine: rows.filter((row) => row.direction === "mine"),
  waitingOn: rows.filter((row) => row.direction !== "mine"),
});
