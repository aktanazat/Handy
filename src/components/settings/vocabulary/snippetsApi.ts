import { commands } from "../../../bindings";
import type { Result, Snippet } from "../../../bindings";

/**
 * Text expansion commands, folded onto the generated bindings. The unwrap
 * turns specta's Result envelope back into the rejection the editor already
 * handles, so callers keep plain promises.
 */

export type { Snippet };

const unwrap = async <T>(pending: Promise<Result<T, string>>): Promise<T> => {
  const result = await pending;
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.data;
};

export const listSnippets = (): Promise<Snippet[]> =>
  unwrap(commands.listSnippets());

export const fetchSnippetsEnabled = async (): Promise<boolean> => {
  const settings = await unwrap(commands.getAppSettings());
  return settings.snippets_enabled ?? true;
};

/* Every mutating command answers with the whole new list, so callers set
 * state from the result instead of following up with list_snippets. */

export const upsertSnippet = (snippet: Snippet): Promise<Snippet[]> =>
  unwrap(commands.upsertSnippet(snippet));

export const deleteSnippet = (snippetId: string): Promise<Snippet[]> =>
  unwrap(commands.deleteSnippet(snippetId));

export const setSnippetEnabled = (
  snippetId: string,
  enabled: boolean,
): Promise<Snippet[]> => unwrap(commands.setSnippetEnabled(snippetId, enabled));

export const setSnippetsEnabled = (enabled: boolean): Promise<void> =>
  unwrap(commands.setSnippetsEnabled(enabled)).then(() => undefined);

/**
 * A snippet the backend has not seen. An empty id asks for a new record; the
 * timestamps travel because the wire type requires them, and the backend
 * overwrites both with its own clock.
 */
export const draftSnippet = (trigger: string, expansion: string): Snippet => ({
  id: "",
  trigger,
  expansion,
  enabled: true,
  created_at: 0,
  updated_at: 0,
});

/**
 * Triggers are unique after case folding, matching `trigger_key` in Rust. The
 * editor checks this before writing so a collision reads as a warning on the
 * field instead of a rejected command.
 */
export const triggerKey = (trigger: string): string =>
  trigger.trim().toLowerCase();
