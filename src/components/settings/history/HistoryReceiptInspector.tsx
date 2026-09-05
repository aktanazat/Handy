import React from "react";
import { useTranslation } from "react-i18next";
import type { HistoryRunReceipt } from "@/bindings";
import { HistoryReceiptCard } from "./HistoryReceiptCard";

interface HistoryReceiptInspectorProps {
  receipts: HistoryRunReceipt[] | null | undefined;
  /** The row this entry was reprocessed or retried from, when it has one. */
  parentId: number | null;
}

/* The full receipt, as plain key/value text under the row's own hairline:
 * quoted machine output, not a card. There is no second disclosure inside it
 * and no surface of its own — the row's expander is the only toggle, and a box
 * inside the row's box is the nesting this wave took out. */
export const HistoryReceiptInspector: React.FC<
  HistoryReceiptInspectorProps
> = ({ receipts, parentId }) => {
  const { t } = useTranslation();

  /* Three ways to have no receipt to show, and they are not the same thing:
   * the read is still running, the read failed, or the run genuinely recorded
   * none. The panel says which. */
  let body: React.ReactNode;
  if (receipts === undefined) {
    body = (
      <p
        className="text-[13px] leading-[18px] text-gray-900"
        aria-live="polite"
      >
        {t("settings.history.receipts.loading")}
      </p>
    );
  } else if (receipts === null) {
    body = (
      <p className="text-[13px] leading-[18px] text-gray-900">
        {t("settings.history.receipts.unavailable")}
      </p>
    );
  } else if (receipts.length === 0) {
    body = (
      <p className="text-[13px] leading-[18px] text-gray-900">
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
    <div className="flex flex-col" data-testid="history-receipts">
      {/* A reprocess and a retry both write a new row pointing at the one they
       * came from. Naming the id says which row, which is what someone looking
       * at two near-identical transcripts actually needs. It reads here with
       * the rest of the provenance instead of spending a metadata cell on
       * every collapsed row. */}
      {parentId !== null ? (
        <p className="mb-2 text-[13px] leading-[18px] text-gray-800 tabular-nums">
          {t("settings.history.derivedFromId", "from #{{id}}", {
            id: parentId,
          })}
        </p>
      ) : null}
      {body}
    </div>
  );
};
