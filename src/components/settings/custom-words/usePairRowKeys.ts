import { useCallback, useRef } from "react";
import type { PairEntry } from "@/lib/vocabularyDraft";

/**
 * React keys for pair rows, tied to the entry object rather than its text.
 *
 * A row is edited in place, so its spoken phrase is not an identity: two rows
 * can hold the same text mid-edit. Editing replaces the entry object, and
 * `preserveRowKey` hands the old object's key to the new one, so the row keeps
 * the same key across a keystroke.
 */
export const usePairRowKeys = () => {
  const keysByEntryRef = useRef(new WeakMap<object, string>());
  const nextKeyRef = useRef(0);

  const getRowKey = useCallback((entry: PairEntry) => {
    const existingKey = keysByEntryRef.current.get(entry);
    if (existingKey) return existingKey;

    const nextKey = `pair-${nextKeyRef.current}`;
    nextKeyRef.current += 1;
    keysByEntryRef.current.set(entry, nextKey);
    return nextKey;
  }, []);

  const preserveRowKey = useCallback(
    (previous: PairEntry, next: PairEntry) => {
      keysByEntryRef.current.set(next, getRowKey(previous));
    },
    [getRowKey],
  );

  return { getRowKey, preserveRowKey };
};
