import { useEffect, useRef, useState } from "react";
import {
  commands,
  type HistoryEntry,
  type HistoryRunReceipt,
} from "@/bindings";

type ReceiptLoad = readonly [number, HistoryRunReceipt[] | null];

const loadRunReceipts = async (
  historyIds: number[],
): Promise<ReceiptLoad[]> => {
  const receipts: ReceiptLoad[] = [];
  const batchSize = 4;

  for (let start = 0; start < historyIds.length; start += batchSize) {
    const batch = historyIds.slice(start, start + batchSize);
    const batchReceipts = await Promise.all(
      batch.map(async (historyId) => {
        try {
          const result = await commands.getHistoryRunReceipts(historyId);
          return [
            historyId,
            result.status === "ok" ? result.data : null,
          ] as const;
        } catch {
          return [historyId, null] as const;
        }
      }),
    );
    receipts.push(...batchReceipts);
  }

  return receipts;
};

// Receipt data is intentionally separate from transcript rows. It is derived
// from the typed receipt command and can be discarded whenever this page closes.
export const useVisibleReceipts = (entries: HistoryEntry[]) => {
  const [receiptsByHistoryId, setReceiptsByHistoryId] = useState<
    Record<number, HistoryRunReceipt[] | null>
  >({});
  const receiptRequestsRef = useRef(new Set<number>());

  // Receipts follow the visible page: rows that left the list drop their cache
  // and request marks, then the rows that arrived are fetched. The resolved
  // receipts are deliberately not an input — `receiptRequestsRef` already
  // records what was asked for, so this runs once per page, not once per batch
  // it resolves.
  useEffect(() => {
    let cancelled = false;
    const visibleIds = new Set(entries.map((entry) => entry.id));

    for (const requestedId of receiptRequestsRef.current) {
      if (!visibleIds.has(requestedId)) {
        receiptRequestsRef.current.delete(requestedId);
      }
    }
    setReceiptsByHistoryId((current) => {
      const kept = Object.entries(current).filter(([historyId]) =>
        visibleIds.has(Number(historyId)),
      );
      return kept.length === Object.keys(current).length
        ? current
        : Object.fromEntries(kept);
    });

    const missingIds: number[] = [];
    for (const entry of entries) {
      if (!receiptRequestsRef.current.has(entry.id)) missingIds.push(entry.id);
    }
    if (missingIds.length === 0) return;

    for (const id of missingIds) receiptRequestsRef.current.add(id);

    void loadRunReceipts(missingIds).then((loaded) => {
      if (cancelled) return;
      setReceiptsByHistoryId((current) => ({
        ...current,
        ...Object.fromEntries(loaded),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [entries]);

  return receiptsByHistoryId;
};
