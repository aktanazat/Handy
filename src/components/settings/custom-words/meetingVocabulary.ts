import { z } from "zod";
import type { VocabularyEntry } from "@/bindings";
import { spokenMatchKey } from "@/lib/vocabularyDraft";

// Deliberate device-local cache for this wave. The roadmap moves dismissals to
// proper persisted settings so they can follow the user's Sona data.
export const VOCABULARY_DISMISSALS_KEY =
  "sona:vocabulary-candidates:dismissed:v1";

interface VocabularyDismissalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const dismissalList = z.array(z.string());

export const readVocabularyDismissals = (
  storage: VocabularyDismissalStorage,
): Set<string> => {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(VOCABULARY_DISMISSALS_KEY) ?? "[]",
    );
    const parsed = dismissalList.safeParse(value);
    return new Set(parsed.success ? parsed.data : []);
  } catch {
    return new Set();
  }
};

export const writeVocabularyDismissals = (
  storage: VocabularyDismissalStorage,
  terms: ReadonlySet<string>,
): void => {
  storage.setItem(VOCABULARY_DISMISSALS_KEY, JSON.stringify([...terms]));
};

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
