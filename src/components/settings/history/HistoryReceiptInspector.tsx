import React from "react";
import { useTranslation } from "react-i18next";
import type { HistoryRunReceipt } from "@/bindings";
import { HistoryReceiptCard } from "./HistoryReceiptCard";

interface HistoryReceiptInspectorProps {
  id: string;
  receipts: HistoryRunReceipt[] | null | undefined;
  /** The row this entry was reprocessed or retried from, when it has one. */
  parentId: number | null;
}

/* The full receipt, as an inset panel of key/value pairs: quoted machine
 * output, not a card. There is no second disclosure inside it — the row's own
 * expander is the only toggle, and everything the run recorded is plain text
 * underneath it. */
export const HistoryReceiptInspector: React.FC<
  HistoryReceiptInspectorProps
> = ({ id, receipts, parentId }) => {
  const { t } = useTranslation();

  /* Three ways to have no receipt to show, and they are not the same thing:
   * the read is still running, the read failed, or the run genuinely recorded
   * none. The panel says which. */
  let body: React.ReactNode;
  if (receipts === undefined) {
    body = (
      <p className="text-sm text-gray-900" aria-live="polite">
        {t("settings.history.receipts.loading")}
      </p>
    );
  } else if (receipts === null) {
    body = (
      <p className="text-sm text-gray-900">
        {t("settings.history.receipts.unavailable")}
      </p>
    );
  } else if (receipts.length === 0) {
    body = (
      <p className="text-sm text-gray-900">
        {t("settings.history.receipts.none")}
      </p>
    );
  } else {
    body = receipts
      .slice()
      .sort((left, right) => right.completed_at_ms - left.completed_at_ms)
      .map((receipt) => (
        <HistoryReceiptCard key={receipt.id} receipt={receipt} />
      ));
  }

  return (
    <div
      id={id}
      className="flex flex-col rounded-md bg-background-200 px-3 py-2.5"
      data-testid="history-receipts"
    >
      {/* A reprocess and a retry both write a new row pointing at the one they
       * came from. Naming the id says which row, which is what someone looking
       * at two near-identical transcripts actually needs. It reads here with
       * the rest of the provenance instead of spending a metadata cell on
       * every collapsed row. */}
      {parentId !== null ? (
        <p className="mb-2 font-mono text-[11px] text-gray-800">
          {t("settings.history.derivedFromId", "from #{{id}}", {
            id: parentId,
          })}
        </p>
      ) : null}
      {body}
    </div>
  );
};
