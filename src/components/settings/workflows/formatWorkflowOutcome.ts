import type { TFunction } from "i18next";
import type { WorkflowRunReceipt } from "@/bindings";

export const formatWorkflowOutcome = (
  receipt: WorkflowRunReceipt,
  t: TFunction,
): string => {
  const counts = receipt.outcome_counts;

  switch (receipt.outcome_code) {
    case "person_links":
      return t("settings.workflows.outcomes.personLinks", {
        count: counts.changes,
      });
    case "briefing":
      return t("settings.workflows.outcomes.briefing", {
        count: counts.persons,
      });
    case "continuity":
      return [
        t("settings.workflows.outcomes.continuitySeries", {
          count: counts.series,
        }),
        t("settings.workflows.outcomes.continuityCarried", {
          count: counts.carried,
        }),
      ].join(" · ");
    case "vocabulary_candidates":
      return t("settings.workflows.outcomes.vocabularyCandidates", {
        count: counts.candidates,
      });
    case "document_links":
      return t("settings.workflows.outcomes.documentLinks", {
        count: counts.changes,
      });
    case "already_processed":
      return t("settings.workflows.outcomes.alreadyProcessed");
    case "failed":
      return t("settings.workflows.outcomes.failed");
    case "skipped":
      return t("settings.workflows.outcomes.skipped");
    default: {
      const exhaustive: never = receipt.outcome_code;
      return exhaustive;
    }
  }
};
