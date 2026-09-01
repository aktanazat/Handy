/* Commit-on-intent, in one place.
 *
 * Three review surfaces put a field on screen only while somebody is changing
 * something — the meeting title, a speaker's name, a transcript turn — and all
 * three then leave the same three ways: Enter, blur, Escape. Writing that
 * grammar three times is how two of them end up committing an emptied field
 * and the third does not. */

/**
 * The four members the grammar reads off a key event. React's keyboard
 * event for an input or textarea satisfies this structurally, so handlers
 * built here slot straight into `onKeyDown`, and a test can construct the
 * event as a plain object instead of impersonating React's type.
 */
export interface InlineEditKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly currentTarget: { readonly value: string };
  preventDefault(): void;
}

/**
 * What a finished inline edit asks the store for: the trimmed draft, or `null`
 * when there is nothing to ask. An emptied field is not a request to delete
 * the text, and an untouched one is not a correction — both are somebody
 * changing their mind, which costs no revision.
 */
export const committedEdit = (
  draft: string,
  current: string,
): string | null => {
  const next = draft.trim();
  return next.length === 0 || next === current ? null : next;
};

/**
 * The keyboard half of the same grammar: Enter is the commit, Escape abandons
 * the draft. Shift+Enter is left alone so a turn that wants a line break can
 * still have one.
 */
export const inlineEditKeys =
  (commit: (draft: string) => void, cancel: () => void) =>
  (event: InlineEditKeyEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commit(event.currentTarget.value);
    }
  };
