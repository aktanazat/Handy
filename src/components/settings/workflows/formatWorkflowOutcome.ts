import type { TFunction } from "i18next";
import type { WorkflowRunReceipt } from "@/bindings";

/**
 * What a run did, said the way a person would say it: "Remembered 2 people",
 * "Carried 2 open loops forward". One sentence per outcome code, counted from
 * the receipt the run wrote — never from the workflow's name, which is the
 * subsystem's word for itself and belongs in no sentence a reader sees.
 */
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
      return t("settings.workflows.outcomes.briefing");
    case "continuity":
      return t("settings.workflows.outcomes.continuity", {
        count: counts.carried,
      });
    case "vocabulary_candidates":
      return t("settings.workflows.outcomes.vocabularyCandidates", {
        count: counts.candidates,
      });
    case "document_links":
      return t("settings.workflows.outcomes.documentLinks", {
        count: counts.changes,
      });
    case "learning_suggestions":
      return t("learningV2.outcomes.noticed", {
        count: counts.suggestions,
      });
    case "series_primed":
      return t("learningV2.outcomes.primed");
    /* D20 narrates a day, not a change: the run writes nothing, so its
     * receipt existing is the whole sentence. */
    case "digest_raised":
      return t("settings.workflows.outcomes.digestRaised");
    /* The consent popup's own history, narrated: what happened to the
     * recording, never what happened to a prompt or a receipt. */
    case "prompt_recorded":
      return t("settings.workflows.outcomes.promptRecorded");
    case "prompt_ignored":
      return t("settings.workflows.outcomes.promptIgnored");
    case "auto_record_started":
      return t("settings.workflows.outcomes.autoRecordStarted");
    case "auto_record_stopped":
      return t("settings.workflows.outcomes.autoRecordStopped");
    case "prep_presented":
      return t("meetings.prep.label");
    case "prep_record_armed":
      return t("meetings.prep.recordWhenStarts");
    case "prep_brief_opened":
      return t("meetings.prep.openBrief");
    case "prep_dismissed":
      return t("meetings.prep.dismiss");
    case "wrap_presented":
      return t("consentPanel.wrap.label");
    case "wrap_notes_opened":
      return t("consentPanel.wrap.openNotes");
    case "wrap_follow_up_copied":
      return t("consentPanel.wrap.copied");
    case "wrap_done":
      return t("consentPanel.wrap.done");
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

/**
 * Whether the sentence above names something that happened to the reader's
 * data. A pass that found nothing still writes a receipt — "Noticed 0 things",
 * "Nothing new to do" — and the run log is where those belong. A feed of
 * recent effects has no room for a run that had none.
 */
export const workflowOutcomeHasEffect = (
  receipt: WorkflowRunReceipt,
): boolean => {
  const counts = receipt.outcome_counts;

  switch (receipt.outcome_code) {
    case "person_links":
    case "document_links":
      return counts.changes > 0;
    case "continuity":
      return counts.carried > 0;
    case "vocabulary_candidates":
      return counts.candidates > 0;
    case "learning_suggestions":
      return counts.suggestions > 0;
    case "already_processed":
    case "skipped":
      return false;
    /* Each of these narrates a single event that either happened or was never
     * recorded, so the receipt's existence is the effect. */
    case "briefing":
    case "series_primed":
    case "digest_raised":
    case "prompt_recorded":
    case "prompt_ignored":
    case "auto_record_started":
    case "auto_record_stopped":
    case "prep_presented":
    case "prep_record_armed":
    case "prep_brief_opened":
    case "prep_dismissed":
    case "wrap_presented":
    case "wrap_notes_opened":
    case "wrap_follow_up_copied":
    case "wrap_done":
    case "failed":
      return true;
    default: {
      const exhaustive: never = receipt.outcome_code;
      return exhaustive;
    }
  }
};
