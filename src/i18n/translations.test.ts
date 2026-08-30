import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseTranslationBundle } from "./translationTree";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.join(__dirname, "..");
const EN_MESSAGES = parseTranslationBundle(
  fs.readFileSync(
    path.join(SRC_ROOT, "i18n", "locales", "en", "translation.json"),
    "utf8",
  ),
);

/** Keys whose interpolation makes them unusable as static lookups. */
const DYNAMIC_KEYS = {
  "overview.recent": ["history", "meeting"],
  "overview.sources": ["microphone", "file", "legacy"],
  "settings.history.stats.source": ["microphone", "file", "legacy"],
  "settings.history.receipts.engine": ["local", "cloud", "local_fallback"],
  "settings.history.receipts.source": ["microphone", "file", "legacy"],
  "settings.hub.tabs": [
    "general",
    "privacy",
    "agents",
    "advanced",
    "about",
    "debug",
  ],
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
      if (!EN_MESSAGES.has(key)) {
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
