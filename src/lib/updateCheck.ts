/* The `check_for_updates` surface shared by the Capture page's update banner
 * and Settings > About. Shapes come from the generated bindings so the two
 * consumers cannot drift; the unwrap turns specta's Result envelope back into
 * the rejection both consumers already handle. */

import { commands } from "../bindings";
import type { UpdateCheckResult, UpdateCheckStatus } from "../bindings";

export type { UpdateCheckResult, UpdateCheckStatus };

/** Contacts GitHub unless automatic checks are off, in which case the backend
 * reports "disabled" without any network call. Transport and decode failures
 * come back as a result with status "check_failed", not as a rejection. */
export const checkForUpdates = async (): Promise<UpdateCheckResult> => {
  const result = await commands.checkForUpdates();
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.data;
};
