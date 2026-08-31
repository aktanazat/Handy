import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { VocabularyCandidate, VocabularyEntry } from "@/bindings";
import { MeetingVocabularySuggestionsList } from "./MeetingVocabularySuggestions";
import {
  addVocabularyCandidate,
  readVocabularyDismissals,
  VOCABULARY_DISMISSALS_KEY,
  writeVocabularyDismissals,
} from "./meetingVocabulary";

const localePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);
const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localePath, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const render = (candidates: readonly VocabularyCandidate[]): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MeetingVocabularySuggestionsList
        candidates={candidates}
        onAccept={() => {}}
        onDismiss={() => {}}
      />
    </I18nextProvider>,
  );

describe("meeting vocabulary suggestions", () => {
  test("renders evidence with one-press add and dismiss actions", () => {
    const markup = render([
      { text: "North Star", occurrences: 1, meetings_count: 2 },
    ]);

    expect(markup).toContain("From your meetings");
    expect(markup).toContain("North Star");
    expect(markup).toContain("1 mention · 2 meetings");
    expect(markup).toContain(">Add<");
    expect(markup).toContain(">Dismiss<");
  });

  test("adds an accepted term through the vocabulary pair list", () => {
    const entries: VocabularyEntry[] = [
      { spoken: "open ai", written: "OpenAI" },
    ];

    expect(addVocabularyCandidate(entries, "North Star")).toEqual([
      ...entries,
      { spoken: "North Star", written: "North Star" },
    ]);
    expect(addVocabularyCandidate(entries, "OpenAI")).toEqual(entries);
  });

  test("round-trips dismissals through the versioned device cache", () => {
    let stored: string | null = null;
    const storage = {
      getItem: (key: string) =>
        key === VOCABULARY_DISMISSALS_KEY ? stored : null,
      setItem: (key: string, value: string) => {
        if (key === VOCABULARY_DISMISSALS_KEY) stored = value;
      },
    };

    writeVocabularyDismissals(storage, new Set(["North Star", "Sona Labs"]));

    expect(readVocabularyDismissals(storage)).toEqual(
      new Set(["North Star", "Sona Labs"]),
    );
  });

  test("renders no suggestion chrome for an empty result", () => {
    expect(render([])).toBe("");
  });
});
