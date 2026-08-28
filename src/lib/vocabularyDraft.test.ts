import { describe, expect, test } from "bun:test";
import {
  mergeAppliedCsv,
  resolveRefreshDraft,
  samePairEntries,
} from "./vocabularyDraft";

const entry = (spoken: string, written: string) => ({ spoken, written });

describe("resolveRefreshDraft", () => {
  test("adopts the saved list when the user has no unsaved edits", () => {
    const saved = [entry("open ai", "OpenAI")];
    const incoming = [entry("open ai", "OpenAI"), entry("sona", "Sona")];
    expect(resolveRefreshDraft(saved, saved, incoming)).toEqual(incoming);
  });

  test("keeps the draft when an unrelated refresh arrives mid-edit", () => {
    const previousSaved = [entry("open ai", "OpenAI")];
    const draft = [entry("open ai", "OpenAI"), entry("new term", "NewTerm")];
    // Same persisted value as before: the user typed a row but never saved.
    const incoming = [entry("open ai", "OpenAI")];
    expect(resolveRefreshDraft(draft, previousSaved, incoming)).toEqual(draft);
  });

  test("keeps the draft even when the refresh brings a new saved list", () => {
    const previousSaved = [entry("open ai", "OpenAI")];
    const draft = [entry("open ai", "OpenAI"), entry("new term", "NewTerm")];
    const incoming = [entry("open ai", "OpenAI"), entry("other", "Other")];
    expect(resolveRefreshDraft(draft, previousSaved, incoming)).toEqual(draft);
  });

  test("adopts after a successful save when the draft equals the new saved list", () => {
    const previousSaved = [entry("open ai", "OpenAI")];
    const draft = [entry("open ai", "OpenAI"), entry("sona", "Sona")];
    expect(resolveRefreshDraft(draft, previousSaved, draft)).toEqual(draft);
  });
});

describe("mergeAppliedCsv", () => {
  test("keeps unsaved local drafts that the CSV does not define", () => {
    const drafts = [entry("draft term", "DraftTerm")];
    const applied = [entry("open ai", "OpenAI")];
    expect(mergeAppliedCsv(drafts, applied)).toEqual([
      entry("open ai", "OpenAI"),
      entry("draft term", "DraftTerm"),
    ]);
  });

  test("does not duplicate a draft the CSV also defines", () => {
    const drafts = [entry("open ai", "OpenAI")];
    const applied = [entry("open ai", "OpenAI")];
    expect(mergeAppliedCsv(drafts, applied)).toEqual([entry("open ai", "OpenAI")]);
  });

  test("returns the applied list unchanged when there are no drafts", () => {
    const applied = [entry("open ai", "OpenAI")];
    expect(mergeAppliedCsv([], applied)).toEqual(applied);
  });
});

describe("samePairEntries", () => {
  test("compares pairs by both fields", () => {
    expect(
      samePairEntries([entry("a", "A")], [entry("a", "A")]),
    ).toBe(true);
    expect(
      samePairEntries([entry("a", "A")], [entry("a", "B")]),
    ).toBe(false);
    expect(samePairEntries([], [])).toBe(true);
  });
});
