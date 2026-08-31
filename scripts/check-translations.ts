import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseTranslationBundle,
  type TranslationBundle,
} from "../src/i18n/translationTree";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const LOCALES_DIR = path.join(__dirname, "..", "src", "i18n", "locales");
const REFERENCE_LANG = "en";

interface ValidationResult {
  valid: boolean;
  missing: string[];
  extra: string[];
}

function getLanguages(): string[] {
  const entries = fs.readdirSync(LOCALES_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== REFERENCE_LANG)
    .map((entry) => entry.name)
    .sort();
}

const LANGUAGES = getLanguages();
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function pluralKey(
  key: string,
): { base: string; category: Intl.LDMLPluralRule } | null {
  const match = PLURAL_SUFFIX.exec(key);
  if (!match) return null;
  return {
    base: key.slice(0, -match[0].length),
    // SAFETY: the regex alternation lists exactly the six LDML plural rules,
    // so a match's first group is always a member of that union.
    category: match[1] as Intl.LDMLPluralRule,
  };
}

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
} satisfies Record<string, string>;

type Color = keyof typeof colors;

function colorize(text: string, color: Color): string {
  return `${colors[color]}${text}${colors.reset}`;
}

/* One locale file, decoded to its dotted keys. `null` when the file is
 * unreadable or is not a tree of message strings; the schema names the
 * offending key path in that case, which is the whole reason this script can
 * report a malformed bundle rather than silently counting it as complete. */
function loadTranslationFile(lang: string): TranslationBundle | null {
  const filePath = path.join(LOCALES_DIR, lang, "translation.json");

  try {
    return parseTranslationBundle(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(colorize(`✗ Error loading ${lang}/translation.json:`, "red"));
    console.error(
      `  ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function validateTranslations(): void {
  console.log(colorize("\n🌍 Translation Consistency Check\n", "blue"));

  // Load reference file
  console.log(`Loading reference language: ${REFERENCE_LANG}`);
  const referenceData = loadTranslationFile(REFERENCE_LANG);

  if (!referenceData) {
    console.error(
      colorize(`\n✗ Failed to load reference file (${REFERENCE_LANG})`, "red"),
    );
    process.exit(1);
  }

  // Get all keys from reference
  const referenceKeys = [...referenceData.keys()];
  const referencePluralBases = new Set(
    referenceKeys
      .map((key) => pluralKey(key)?.base)
      .filter((base): base is string => base !== undefined)
      .filter(
        (base) =>
          referenceData.has(`${base}_one`) ||
          referenceData.has(`${base}_other`),
      ),
  );
  console.log(`Reference has ${referenceKeys.length} keys\n`);

  // Track validation results
  let hasErrors = false;
  const results: Record<string, ValidationResult> = {};

  // Validate each language
  for (const lang of LANGUAGES) {
    const langData = loadTranslationFile(lang);

    if (!langData) {
      hasErrors = true;
      results[lang] = { valid: false, missing: [], extra: [] };
      continue;
    }

    const pluralCategories = new Set(
      new Intl.PluralRules(lang).resolvedOptions().pluralCategories,
    );

    // Locale bundles carry only the CLDR categories their locale can select.
    const missing = referenceKeys.filter((key) => {
      const plural = pluralKey(key);
      if (plural && !pluralCategories.has(plural.category)) return false;
      return !langData.has(key);
    });

    const extra = [...langData.keys()].filter((key) => {
      if (referenceData.has(key)) return false;
      const plural = pluralKey(key);
      return !(
        plural &&
        pluralCategories.has(plural.category) &&
        referencePluralBases.has(plural.base)
      );
    });

    results[lang] = {
      valid: missing.length === 0 && extra.length === 0,
      missing,
      extra,
    };

    if (missing.length > 0 || extra.length > 0) {
      hasErrors = true;
    }
  }

  // Print results
  console.log(colorize("Results:", "blue"));
  console.log("─".repeat(60));

  for (const lang of LANGUAGES) {
    const result = results[lang];

    if (result.valid) {
      console.log(
        colorize(`✓ ${lang.toUpperCase()}: All keys present`, "green"),
      );
    } else {
      console.log(colorize(`✗ ${lang.toUpperCase()}: Issues found`, "red"));

      if (result.missing.length > 0) {
        console.log(
          colorize(`  Missing ${result.missing.length} keys:`, "yellow"),
        );
        result.missing.slice(0, 10).forEach((key) => {
          console.log(`    - ${key}`);
        });
        if (result.missing.length > 10) {
          console.log(
            colorize(
              `    ... and ${result.missing.length - 10} more`,
              "yellow",
            ),
          );
        }
      }

      if (result.extra.length > 0) {
        console.log(
          colorize(
            `  Extra ${result.extra.length} keys (not in reference):`,
            "yellow",
          ),
        );
        result.extra.slice(0, 10).forEach((key) => {
          console.log(`    - ${key}`);
        });
        if (result.extra.length > 10) {
          console.log(
            colorize(`    ... and ${result.extra.length - 10} more`, "yellow"),
          );
        }
      }

      console.log("");
    }
  }

  console.log("─".repeat(60));

  // Summary
  const validCount = Object.values(results).filter((r) => r.valid).length;
  const totalCount = LANGUAGES.length;

  if (hasErrors) {
    console.log(
      colorize(
        `\n✗ Validation failed: ${validCount}/${totalCount} languages passed`,
        "red",
      ),
    );
    process.exit(1);
  } else {
    console.log(
      colorize(
        `\n✓ All ${totalCount} languages have complete translations!`,
        "green",
      ),
    );
    process.exit(0);
  }
}

// Run validation
validateTranslations();
