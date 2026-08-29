import { describe, expect, test } from "bun:test";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { CustomWords } from "../CustomWords";
import { PromptLibrary } from "./PromptLibrary";
import { SnippetsPanel } from "./SnippetsPanel";

/**
 * Mount checks for the three text-rule surfaces.
 *
 * The i18n instance carries no resources on purpose: every string falls back
 * to the inline English default, so these assertions stay true after
 * integration harvests the new keys into the locale files.
 *
 * A static render runs the component bodies without effects, which is exactly
 * the pre-data state: nothing here reaches Tauri.
 */
const render = async (node: React.ReactElement): Promise<string> => {
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>{node}</I18nextProvider>,
  );
};

describe("SnippetsPanel", () => {
  test("mounts with the master toggle and a loading list", async () => {
    const markup = await render(<SnippetsPanel />);

    expect(markup).toContain("Enable text expansion");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('aria-label="Loading snippets"');
    expect(markup).toContain('data-testid="snippets-editor"');
    // Rows only exist once list_snippets answers.
    expect(markup.includes('data-testid="snippet-row"')).toBe(false);
  });
});

describe("PromptLibrary", () => {
  test("mounts with its own heading and a loading list", async () => {
    const markup = await render(<PromptLibrary />);

    expect(markup).toContain("Post-processing prompts");
    expect(markup).toContain('aria-label="Loading prompts"');
    expect(markup).toContain('data-testid="prompt-library"');
  });
});

describe("CustomWords", () => {
  test("composes the vocabulary editor, text expansion and emoji rows", async () => {
    const markup = await render(
      <CustomWords descriptionMode="inline" grouped />,
    );

    expect(markup).toContain('data-testid="vocabulary-editor"');
    expect(markup).toContain('data-testid="vocabulary-editor-add"');
    expect(markup).toContain('data-testid="snippets-editor"');
    expect(markup).toContain("Enable text expansion");
    // Emoji replacement is opt-in, so its editor stays closed by default.
    expect(markup.includes('data-testid="emoji-editor"')).toBe(false);
  });

  test("keeps the vocabulary CSV actions reachable", async () => {
    const markup = await render(<CustomWords />);

    expect(markup).toContain('role="group"');
    expect(markup).toContain('accept=".csv,text/csv"');
  });
});

/**
 * A locale catalogue as i18next reads it: a sentence, or a group of them.
 * Stated as a schema so a nested object where a sentence belongs, or a number
 * that slipped into a translation file, fails at the read instead of rendering
 * as `[object Object]` in an assertion nobody re-checks.
 */
type LocaleNode = string | { [key: string]: LocaleNode };

const localeCatalogue: z.ZodType<LocaleNode> = z.lazy(() =>
  z.union([z.string(), z.record(localeCatalogue)]),
);

/**
 * The rows whose copy lives only in the locale files render with the real
 * English resources instead, so the assertion proves the key is wired rather
 * than that an inline default exists.
 */
const renderWithEnglishCopy = async (
  node: React.ReactElement,
): Promise<string> => {
  const translation = localeCatalogue.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
          "..",
          "i18n",
          "locales",
          "en",
          "translation.json",
        ),
        "utf8",
      ),
    ),
  );
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation } },
    interpolation: { escapeValue: false },
  });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>{node}</I18nextProvider>,
  );
};

describe("spoken editing commands row", () => {
  test("states which phrases fire and which stay as text", async () => {
    const markup = await renderWithEnglishCopy(<CustomWords />);

    expect(markup).toContain("Obey spoken editing commands");
    expect(markup).toContain("delete the last word");
    // The row names its own limits rather than promising general editing.
    expect(markup).toContain("English only");
    expect(markup).toContain("scratch that plan");
  });
});
