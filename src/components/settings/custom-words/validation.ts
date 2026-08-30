import type { TFunction } from "i18next";
import {
  duplicateSpokenPhrases,
  spokenMatchKey,
  type PairEntry,
} from "@/lib/vocabularyDraft";

/** What the new-pair fields say about the draft, and whether Add may fire. */
export interface DraftState {
  hint: { text: string; blocking: boolean } | null;
  /** Both fields filled and nothing the backend would refuse. */
  addable: boolean;
}

/* The backend normalizes and validates the whole list on save. Naming the
 * same rules here means a rejected write becomes a hint on the row instead
 * of an error toast about the list. */
export const vocabularyBlockers = (
  entries: readonly PairEntry[],
  t: TFunction,
): string[] => {
  const blockers: string[] = [];
  if (entries.some((entry) => !entry.spoken.trim() || !entry.written.trim())) {
    blockers.push(
      t(
        "settings.advanced.customWords.errors.incompleteRow",
        "Complete or remove every row before saving.",
      ),
    );
  }
  const conflictingSpoken = duplicateSpokenPhrases(entries);
  if (conflictingSpoken.length > 0) {
    blockers.push(
      t("settings.advanced.customWords.errors.duplicateSpoken", {
        defaultValue:
          "More than one row matches {{spoken}}. Sona keeps one rule per spoken phrase.",
        spoken: conflictingSpoken.join(", "),
      }),
    );
  }
  const unusableSpoken = entries
    .filter(
      (entry) =>
        entry.spoken.trim() !== "" && spokenMatchKey(entry.spoken) === "",
    )
    .map((entry) => entry.spoken);
  if (unusableSpoken.length > 0) {
    blockers.push(
      t("settings.advanced.customWords.errors.unusableSpoken", {
        defaultValue:
          "{{spoken}} needs at least one letter or number to be recognized.",
        spoken: unusableSpoken.join(", "),
      }),
    );
  }
  return blockers;
};

export const emojiBlockers = (
  entries: readonly PairEntry[],
  t: TFunction,
): string[] =>
  entries.some((entry) => !entry.spoken.trim() || !entry.written.trim())
    ? [
        t(
          "settings.advanced.emoji.errors.incompleteRow",
          "Complete or remove every row before saving.",
        ),
      ]
    : [];

export const vocabularyDraftState = (
  spoken: string,
  written: string,
  entries: readonly PairEntry[],
  t: TFunction,
): DraftState => {
  const draftSpoken = spoken.trim();
  const draftWritten = written.trim();
  const started = spoken !== "" || written !== "";
  const incomplete = draftSpoken === "" || draftWritten === "";
  const pairExists =
    !incomplete &&
    entries.some(
      (entry) => entry.spoken === draftSpoken && entry.written === draftWritten,
    );
  const spokenTaken =
    spokenMatchKey(draftSpoken) !== "" &&
    entries.some(
      (entry) => spokenMatchKey(entry.spoken) === spokenMatchKey(draftSpoken),
    );
  /* Anything the backend would refuse. Named on the field, so Add is never
   * disabled without saying why. */
  const blocker = pairExists
    ? t("settings.advanced.customWords.errors.duplicate")
    : spokenTaken
      ? t("settings.advanced.customWords.errors.duplicateSpoken", {
          defaultValue:
            "More than one row matches {{spoken}}. Sona keeps one rule per spoken phrase.",
          spoken: draftSpoken,
        })
      : !incomplete && spokenMatchKey(draftSpoken) === ""
        ? t("settings.advanced.customWords.errors.unusableSpoken", {
            defaultValue:
              "{{spoken}} needs at least one letter or number to be recognized.",
            spoken: draftSpoken,
          })
        : null;

  if (blocker !== null) {
    return { hint: { text: blocker, blocking: true }, addable: false };
  }
  if (incomplete) {
    return {
      hint: started
        ? {
            text: t("settings.advanced.customWords.errors.incomplete"),
            blocking: false,
          }
        : null,
      addable: false,
    };
  }
  return { hint: null, addable: true };
};

export const emojiDraftState = (
  spoken: string,
  written: string,
  entries: readonly PairEntry[],
  t: TFunction,
): DraftState => {
  const draftSpoken = spoken.trim();
  const draftWritten = written.trim();
  const started = spoken !== "" || written !== "";
  const incomplete = draftSpoken === "" || draftWritten === "";
  const exists = entries.some(
    (entry) => entry.spoken === draftSpoken && entry.written === draftWritten,
  );

  if (incomplete) {
    return {
      hint: started
        ? {
            text: t("settings.advanced.emoji.errors.incomplete"),
            blocking: false,
          }
        : null,
      addable: false,
    };
  }
  if (exists) {
    return {
      hint: {
        text: t("settings.advanced.emoji.errors.duplicate"),
        blocking: true,
      },
      addable: false,
    };
  }
  return { hint: null, addable: true };
};
