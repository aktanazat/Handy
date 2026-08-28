/**
 * Pure draft-merge helpers for the vocabulary editors (CustomWords).
 *
 * The editors keep unsaved local rows in component state while the backend
 * owns the persisted list. These helpers decide when an incoming settings
 * refresh may replace local state and how a CSV apply must preserve drafts.
 */

export interface PairEntry {
  spoken: string;
  written: string;
}

const pairKey = (entry: PairEntry): string =>
  `${entry.spoken}\u0000${entry.written}`;

export const samePairEntries = (
  left: readonly PairEntry[],
  right: readonly PairEntry[],
): boolean =>
  left.length === right.length &&
  left.every(
    (entry, index) =>
      entry.spoken === right[index]?.spoken &&
      entry.written === right[index]?.written,
  );

/**
 * Resolve the editor list after a settings refresh.
 *
 * A refresh may replace the local list only when the user has no unsaved
 * edits since the last synced snapshot (current === previousSaved). Any local
 * divergence means the user is mid-edit; the incoming saved list is ignored so
 * an unrelated settings refresh never discards the draft.
 */
export const resolveRefreshDraft = <T extends PairEntry>(
  current: readonly T[],
  previousSaved: readonly T[],
  incomingSaved: readonly T[],
): T[] => (samePairEntries(current, previousSaved) ? [...incomingSaved] : [...current]);

/**
 * Merge a CSV apply result with unsaved local drafts.
 *
 * The backend replaces the persisted vocabulary with the CSV rows. Rows the
 * user typed locally but never saved are not part of that result; dropping
 * them silently would lose work. This keeps every local row that the CSV does
 * not also define, so drafts survive an apply and stay visible as unsaved.
 */
export const mergeAppliedCsv = <T extends PairEntry>(
  localDrafts: readonly T[],
  appliedResult: readonly T[],
): T[] => {
  const appliedPairs = new Set(appliedResult.map(pairKey));
  const survivingDrafts = localDrafts.filter(
    (entry) => !appliedPairs.has(pairKey(entry)),
  );
  return [...appliedResult, ...survivingDrafts];
};
