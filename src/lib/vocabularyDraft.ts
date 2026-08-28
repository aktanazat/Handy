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

/**
 * The key the recognizer matches a spoken phrase by: alphanumeric characters
 * only, lowercased. Mirrors `vocabulary_spoken_key` in the Rust text pipeline,
 * which is what makes "Open AI" and "open-ai" the same rule.
 */
export const spokenMatchKey = (spoken: string): string =>
  spoken.replace(/[^\p{Alphabetic}\p{N}]/gu, "").toLowerCase();

/**
 * Spoken phrases that more than one row claims once normalized.
 *
 * The backend rejects the whole list in that case ("Vocabulary entries need
 * unique spoken phrases after normalization"), so the editor blocks the save
 * and names the offending phrases instead of forwarding a doomed write.
 */
export const duplicateSpokenPhrases = (
  entries: readonly PairEntry[],
): string[] => {
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const key = spokenMatchKey(entry.spoken);
    if (key === "") continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const reported = new Set<string>();
  const duplicates: string[] = [];
  for (const entry of entries) {
    const key = spokenMatchKey(entry.spoken);
    if ((seen.get(key) ?? 0) < 2 || reported.has(key)) continue;
    reported.add(key);
    duplicates.push(entry.spoken);
  }
  return duplicates;
};

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
): T[] =>
  samePairEntries(current, previousSaved) ? [...incomingSaved] : [...current];

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
