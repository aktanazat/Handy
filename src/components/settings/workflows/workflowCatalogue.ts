import type { WorkflowId } from "@/bindings";

/* Where each workflow's human name and description live.
 *
 * Exhaustive by construction: `Record<WorkflowId, string>` fails to typecheck
 * the moment the Rust enum grows a variant, so a new workflow cannot ship
 * showing a raw id. The learning loops' copy lives in its own namespace; the
 * five original workflows keep the keys their translations already use. */
export const WORKFLOW_NAME_KEY = {
  person_linking: "settings.workflows.items.person_linking.name",
  pre_meeting_briefing: "settings.workflows.items.pre_meeting_briefing.name",
  continuity: "settings.workflows.items.continuity.name",
  vocabulary_mining: "settings.workflows.items.vocabulary_mining.name",
  document_linking: "settings.workflows.items.document_linking.name",
  meeting_activity: "settings.workflows.items.meeting_activity.name",
  spoken_punctuation: "learningV2.workflows.spokenPunctuation.name",
  correction_learning: "learningV2.workflows.correctionLearning.name",
  mode_habits: "learningV2.workflows.modeHabits.name",
  capture_advisor: "learningV2.workflows.captureAdvisor.name",
  series_priming: "learningV2.workflows.seriesPriming.name",
} satisfies Record<WorkflowId, string>;

/* Workflows the Settings list never shows — `WorkflowId::PERMANENT` in Rust,
 * where a test asserts these two and `CONFIGURABLE` partition the enum. */
export type PermanentWorkflowId = "meeting_activity" | "series_priming";

/* Where each workflow's description lives, for the workflows that have one.
 *
 * A description is read by exactly one surface — the Settings list — and that
 * list renders `WorkflowId::CONFIGURABLE`. So the two permanent workflows have
 * a name and no description, and the type says both halves of that: every
 * configurable workflow must appear, and asking about any workflow is allowed
 * and may answer "none". */
export const WORKFLOW_DESCRIPTION_KEY: Partial<Record<WorkflowId, string>> &
  Record<Exclude<WorkflowId, PermanentWorkflowId>, string> = {
  person_linking: "settings.workflows.items.person_linking.description",
  pre_meeting_briefing:
    "settings.workflows.items.pre_meeting_briefing.description",
  continuity: "settings.workflows.items.continuity.description",
  vocabulary_mining: "settings.workflows.items.vocabulary_mining.description",
  document_linking: "settings.workflows.items.document_linking.description",
  spoken_punctuation: "learningV2.workflows.spokenPunctuation.description",
  correction_learning: "learningV2.workflows.correctionLearning.description",
  mode_habits: "learningV2.workflows.modeHabits.description",
  capture_advisor: "learningV2.workflows.captureAdvisor.description",
};
