import type { VocabularyEntry } from "@/bindings";
import { spokenMatchKey } from "@/lib/vocabularyDraft";

export const addVocabularyCandidate = (
  entries: readonly VocabularyEntry[],
  text: string,
): VocabularyEntry[] => {
  const term = text.trim();
  if (term === "") return [...entries];
  const spokenKey = spokenMatchKey(term);
  const writtenKey = term.toLowerCase();
  if (
    entries.some(
      (entry) =>
        spokenMatchKey(entry.spoken) === spokenKey ||
        entry.written.trim().toLowerCase() === writtenKey,
    )
  ) {
    return [...entries];
  }
  return [...entries, { spoken: term, written: term }];
};
