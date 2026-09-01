import type { TFunction } from "i18next";
import type { HistoryRunReceipt } from "@/bindings";

/* Why an empty transcript is empty. The copy that used to sit here called
 * every case a failure and told the reader to press a retry icon that no
 * longer exists — retry is a named item in the row's menu now.
 *
 * The gate is `capture_status === "complete"`, and it is load-bearing rather
 * than incidental. Only three run outcomes reach Complete with no text, and
 * they are the only three worth distinguishing. Everything else that lands
 * here also carries no `engine_used` and would otherwise be misread as a
 * failure: all three no-speech provenances, a truncated capture (whose prefix
 * is forbidden from being auto-transcribed, so there was never a
 * transcription to fail), and every legacy row, since `capture_status`
 * arrived in a later migration and retries and imports keep it NULL. Those
 * all get the neutral statement, which is true for each of them.
 *
 * Within Complete, the discriminators are already on the receipt (actions.rs,
 * verified by DictationTrust): the held path sets `cloud_status` explicitly,
 * and the failure path builds its receipt from `mode_receipt()` and so
 * carries no `engine_used`, while a real decode always names the engine it
 * ran on. The held case ALSO has no `engine_used`, so the order of these two
 * branches is the thing that keeps a held run off the failure line. Anything
 * else is a run the model heard and post-processing then emptied — "scratch
 * that", or a filler-only clip with filler removal on, which is the default.
 * Nothing in the schema keeps the pre-post-processing output, so for that
 * last case the app states what it can observe instead of guessing. */
export const emptyTranscriptLine = (
  t: TFunction,
  receipt: HistoryRunReceipt | null,
): string => {
  if (receipt?.capture_status === "complete") {
    if (receipt.mode.cloud_status === "held_cloud_unavailable") {
      return t(
        "settings.history.cloudHeld",
        "Sona held the cloud result: nothing trustworthy came back and no local model was available.",
      );
    }
    if (receipt.mode.engine_used == null) {
      return t(
        "settings.history.transcriptionEngineFailed",
        "Transcription failed, so nothing was recorded.",
      );
    }
  }
  return t(
    "settings.history.noTextRecorded",
    "No text was recorded for this entry.",
  );
};
