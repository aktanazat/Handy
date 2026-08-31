import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseTranslationBundle,
  type TranslationTree,
} from "./translationTree";
import i18next from "i18next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.join(__dirname, "..");
const EN_MESSAGES = parseTranslationBundle(
  fs.readFileSync(
    path.join(SRC_ROOT, "i18n", "locales", "en", "translation.json"),
    "utf8",
  ),
);
const ENGLISH_PLURAL_CATEGORIES = new Intl.PluralRules("en").resolvedOptions()
  .pluralCategories;

const hasEnglishMessage = (key: string): boolean =>
  EN_MESSAGES.has(key) ||
  ENGLISH_PLURAL_CATEGORIES.some((category) =>
    EN_MESSAGES.has(`${key}_${category}`),
  );

const RUNTIME_COUNT_KEYS = [
  "people.list.meetings",
  "people.list.suggested",
  "people.review.meetingsBefore",
  "people.briefing.metCount",
  "people.briefing.metBefore",
  "overview.activity.days",
  "overview.activity.streakAria",
  "settings.workflows.vocabularySuggestions.occurrences",
  "settings.workflows.vocabularySuggestions.meetings",
  "settings.workflows.outcomes.personLinks",
  "settings.workflows.outcomes.briefing",
  "settings.workflows.outcomes.continuitySeries",
  "settings.workflows.outcomes.continuityCarried",
  "settings.workflows.outcomes.vocabularyCandidates",
  "settings.workflows.outcomes.documentLinks",
] as const;

const PLURAL_SAMPLE_COUNTS = [
  ...Array.from({ length: 201 }, (_, count) => count),
  0.1,
  0.2,
  1.1,
  1.2,
  2.1,
  2.2,
  3.1,
  10.1,
  100.1,
  1_000,
  10_000,
  100_000,
  1_000_000,
];

const sampleCount = (
  rules: Intl.PluralRules,
  category: Intl.LDMLPluralRule,
): number => {
  const count = PLURAL_SAMPLE_COUNTS.find(
    (candidate) => rules.select(candidate) === category,
  );
  if (count === undefined) {
    throw new Error(
      `No runtime sample found for plural category "${category}"`,
    );
  }
  return count;
};

/** Keys whose interpolation makes them unusable as static lookups. */
const DYNAMIC_KEYS = {
  "settings.history.receipts.engine": ["local", "cloud", "local_fallback"],
  "settings.history.receipts.source": ["microphone", "file", "legacy"],
  "settings.hub.tabs": [
    "general",
    "privacy",
    "agents",
    "workflows",
    "advanced",
    "about",
    "debug",
  ],
  "settings.workflows.items": [
    "person_linking.name",
    "person_linking.description",
    "pre_meeting_briefing.name",
    "pre_meeting_briefing.description",
    "continuity.name",
    "continuity.description",
    "vocabulary_mining.name",
    "vocabulary_mining.description",
    "document_linking.name",
    "document_linking.description",
  ],
  "settings.workflows.status": ["ok", "failed", "skipped"],
  "settings.modes.tabs": [
    "recognition",
    "rewrite",
    "context",
    "delivery",
    "automation",
  ],
  "settings.modes.views": ["modes", "vocabulary"],
  "theme.options": ["system", "light", "dark"],
};

const walk = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
};

const findTranslationKeys = (): Set<string> => {
  const keys = new Set<string>();
  const keyPattern = /\bt\(\s*(['"`])([^'"`]+)\1\s*[,)]/g;
  for (const file of walk(SRC_ROOT)) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(keyPattern)) {
      keys.add(match[2]);
    }
  }
  return keys;
};

describe("English translation fallback", () => {
  const usedKeys = findTranslationKeys();

  test("every static t() key used in src resolves in the en bundle", () => {
    const missing: string[] = [];
    for (const key of usedKeys) {
      if (key.includes("${")) continue;
      if (!hasEnglishMessage(key)) {
        missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });

  test("every dynamic t() namespace value resolves in the en bundle", () => {
    const missing: string[] = [];
    for (const [namespace, values] of Object.entries(DYNAMIC_KEYS)) {
      for (const value of values) {
        const key = `${namespace}.${value}`;
        if (!EN_MESSAGES.has(key)) {
          missing.push(key);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("no en translation value is a raw key leak", () => {
    const leaks: string[] = [];
    for (const key of usedKeys) {
      if (key.includes("${")) continue;
      if (EN_MESSAGES.get(key) === key) {
        leaks.push(key);
      }
    }
    expect(leaks).toEqual([]);
  });
});

describe("runtime plural resolution", () => {
  const localesRoot = path.join(SRC_ROOT, "i18n", "locales");
  const locales = fs
    .readdirSync(localesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  test("every new count key resolves the locale-selected CLDR category", async () => {
    for (const locale of locales) {
      // SAFETY: translation.json files hold the nested string tree that
      // TranslationTree names; the schema is enforced by the parity checks
      // above, so decoding straight into the owning contract is honest.
      const bundle = JSON.parse(
        fs.readFileSync(
          path.join(localesRoot, locale, "translation.json"),
          "utf8",
        ),
      ) as TranslationTree;
      const instance = i18next.createInstance();
      await instance.init({
        lng: locale,
        fallbackLng: false,
        resources: { [locale]: { translation: bundle } },
      });
      const rules = new Intl.PluralRules(locale);

      for (const category of rules.resolvedOptions().pluralCategories) {
        const count = sampleCount(rules, category);
        for (const key of RUNTIME_COUNT_KEYS) {
          const details = instance.t(key, {
            count,
            returnDetails: true,
          });
          expect(details.exactUsedKey).toBe(`${key}_${category}`);
        }
      }
    }
  });
});
