import { useRef } from "react";
import type { VocabularyEntry } from "@/bindings";
import type { ModeVocabularyEditor } from "./ModeAdvanced";

/**
 * A mode's spelling pairs as editable rows.
 *
 * The persisted list is positional and every keystroke rebuilds it, so there is
 * no id in the data to key a row by — and keying by index remounts the input a
 * person is typing in as soon as a row above it is removed. So identity is kept
 * beside the list: one key minted per entry object, carried onto the
 * replacement object an edit produces, in a `WeakMap` so a dropped row's key
 * goes with it.
 */
export const useVocabularyRows = (
  entries: readonly VocabularyEntry[],
  onChange: (next: VocabularyEntry[]) => void,
): ModeVocabularyEditor => {
  const keys = useRef(new WeakMap<VocabularyEntry, string>());
  const nextKey = useRef(0);

  const rowKey = (entry: VocabularyEntry): string => {
    const existingKey = keys.current.get(entry);
    if (existingKey) return existingKey;

    const key = `mode-vocabulary-${nextKey.current}`;
    nextKey.current += 1;
    keys.current.set(entry, key);
    return key;
  };

  return {
    rowKey,
    incomplete: entries.some(
      (entry) => entry.spoken.trim() === "" || entry.written.trim() === "",
    ),
    setField: (index, field, value) => {
      const next = entries.map((entry, row) => {
        if (row !== index) return entry;
        const edited = { ...entry, [field]: value };
        // Carry the row key onto the replacement so the input keeps focus.
        keys.current.set(edited, rowKey(entry));
        return edited;
      });
      onChange(next);
    },
    add: () => {
      const entry: VocabularyEntry = { spoken: "", written: "" };
      keys.current.set(entry, `mode-vocabulary-${nextKey.current}`);
      nextKey.current += 1;
      onChange([...entries, entry]);
    },
    remove: (index) => onChange(entries.filter((_, row) => row !== index)),
  };
};
