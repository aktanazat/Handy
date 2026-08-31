import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands, type VocabularyEntry } from "@/bindings";
import type { ImportReview } from "../custom-words/ImportPreviewDialog";

/**
 * The CSV round trip, and the two-step review one import goes through.
 *
 * Preview, apply and export address the persisted spelling list as a file
 * rather than as rows, and the review dialog exists only for the duration of
 * one import — so none of it belongs to the rule list that owns the rows.
 *
 * What it does need from that owner is named here rather than reimplemented:
 * `runWrite` is the serialized write every command on this surface shares,
 * carrying the one busy flag and the one retryable failure, and `onApplied`
 * hands the applied rows back to whoever owns the live list.
 */

/** Every vocabulary command on this surface addresses the global list. */
export const GLOBAL_VOCABULARY_SCOPE = { kind: "global" } as const;

export interface VocabularyImportState {
  review: ImportReview | null;
  previewImport: (file: File) => void;
  applyImport: () => void;
  exportCsv: () => void;
  setReviewStep: (step: ImportReview["step"]) => void;
  closeReview: () => void;
}

export interface VocabularyImportOptions {
  /** The owner's serialized write, with its busy and failure state. */
  runWrite: (write: () => Promise<void>, retry: () => void) => Promise<void>;
  /** The rows an apply persisted, for the owner of the live list. */
  onApplied: (entries: VocabularyEntry[]) => Promise<void>;
}

export const useVocabularyImport = ({
  runWrite,
  onApplied,
}: VocabularyImportOptions): VocabularyImportState => {
  const { t } = useTranslation();
  const [review, setReview] = useState<ImportReview | null>(null);

  const previewImport = (file: File) =>
    void runWrite(
      async () => {
        const csv = await file.text();
        const result = await commands.previewVocabularyCsv(
          GLOBAL_VOCABULARY_SCOPE,
          csv,
        );
        if (result.status !== "ok") throw new Error(String(result.error));
        setReview({ csv, preview: result.data, step: "review" });
      },
      () => previewImport(file),
    );

  const applyImport = () => {
    if (!review?.preview.can_apply) return;
    const csv = review.csv;
    void runWrite(
      async () => {
        const result = await commands.applyVocabularyCsv(
          GLOBAL_VOCABULARY_SCOPE,
          csv,
        );
        if (result.status !== "ok") throw new Error(String(result.error));
        await onApplied(result.data);
        setReview(null);
        toast.success(t("settings.advanced.customWords.imported"));
      },
      () => applyImport(),
    );
  };

  const exportCsv = () =>
    void runWrite(
      async () => {
        const result = await commands.exportVocabularyCsv(
          GLOBAL_VOCABULARY_SCOPE,
        );
        if (result.status !== "ok") throw new Error(String(result.error));
        const url = URL.createObjectURL(
          new Blob([result.data], { type: "text/csv;charset=utf-8" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "sona-vocabulary.csv";
        link.click();
        URL.revokeObjectURL(url);
      },
      () => exportCsv(),
    );

  return {
    review,
    previewImport,
    applyImport,
    exportCsv,
    setReviewStep: (step) =>
      setReview((current) => (current ? { ...current, step } : current)),
    closeReview: () => setReview(null),
  };
};
