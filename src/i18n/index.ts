import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { locale } from "@tauri-apps/plugin-os";
import { LANGUAGE_METADATA, type LanguageCode } from "./languages";
import type { TranslationTree } from "./translationTree";
import { commands } from "@/bindings";
import {
  getLanguageDirection,
  updateDocumentDirection,
  updateDocumentLanguage,
} from "@/lib/utils/rtl";
import enTranslation from "./locales/en/translation.json";

const FALLBACK_LANGUAGE = "en";

/* One entry per directory under ./locales, spelled out. Every path is a literal
 * a bundler can resolve statically — no glob, no template literal — and each
 * non-English locale stays behind its own `import()` so a launch downloads
 * English only. Adding a locale means adding its directory, its metadata in
 * languages.ts, and its line here; the `LanguageCode` key makes the compiler
 * fail on a missing or extra line, and `bun test src/i18n` checks the
 * directories. English is the static import above: it must be ready before
 * the first render, so it is not a chunk. */
const loaderByCode = {
  en: async () => ({ default: enTranslation }),
  ar: () => import("./locales/ar/translation.json"),
  bg: () => import("./locales/bg/translation.json"),
  cs: () => import("./locales/cs/translation.json"),
  da: () => import("./locales/da/translation.json"),
  de: () => import("./locales/de/translation.json"),
  es: () => import("./locales/es/translation.json"),
  fr: () => import("./locales/fr/translation.json"),
  he: () => import("./locales/he/translation.json"),
  hi: () => import("./locales/hi/translation.json"),
  it: () => import("./locales/it/translation.json"),
  ja: () => import("./locales/ja/translation.json"),
  ko: () => import("./locales/ko/translation.json"),
  ne: () => import("./locales/ne/translation.json"),
  nl: () => import("./locales/nl/translation.json"),
  pl: () => import("./locales/pl/translation.json"),
  pt: () => import("./locales/pt/translation.json"),
  ru: () => import("./locales/ru/translation.json"),
  sv: () => import("./locales/sv/translation.json"),
  tr: () => import("./locales/tr/translation.json"),
  uk: () => import("./locales/uk/translation.json"),
  vi: () => import("./locales/vi/translation.json"),
  zh: () => import("./locales/zh/translation.json"),
  "zh-TW": () => import("./locales/zh-TW/translation.json"),
} satisfies Record<LanguageCode, () => Promise<{ default: TranslationTree }>>;

/* SAFETY: the keys of a Record over the closed `LanguageCode` union are
 * exactly that union; Object.keys erases it to string[]. */
const LOCALE_CODES = Object.keys(loaderByCode) as LanguageCode[];

/* Selector order: every locale carries a unique priority in languages.ts. */
export const SUPPORTED_LANGUAGES = LOCALE_CODES.map((code) => ({
  code,
  ...LANGUAGE_METADATA[code],
})).sort((a, b) => a.priority - b.priority);

export type SupportedLanguageCode = LanguageCode;

// Check if a language code is supported
export const getSupportedLanguage = (
  langCode: string | null | undefined,
): SupportedLanguageCode | null => {
  if (!langCode) return null;

  const normalized = langCode.toLowerCase().replace(/_/g, "-");
  const subtags = normalized.split("-");
  const language = subtags[0];
  const isHant = subtags.includes("hant");
  const isHans = subtags.includes("hans");
  const isTraditionalRegion = ["tw", "hk", "mo"].some((region) =>
    subtags.includes(region),
  );

  // Try exact match first
  let supported = SUPPORTED_LANGUAGES.find(
    (lang) => lang.code.toLowerCase() === normalized,
  );
  if (!supported) {
    let fallback = language;
    if (language === "zh" && (isHant || (!isHans && isTraditionalRegion))) {
      fallback = "zh-tw";
    } else if (language === "yue") {
      // Cantonese uses Traditional Chinese unless explicitly tagged as Hans.
      fallback = isHans ? "zh" : "zh-tw";
    }
    supported = SUPPORTED_LANGUAGES.find(
      (lang) => lang.code.toLowerCase() === fallback,
    );
  }
  return supported ? supported.code : null;
};

// Initialize i18n with English as default. Only English is bundled here;
// `partialBundledLanguages` tells i18next that the other locales exist and
// arrive later, so it does not treat a missing bundle as a missing language.
// Language is synced from settings after init.
i18n.use(initReactI18next).init({
  resources: { [FALLBACK_LANGUAGE]: { translation: enTranslation } },
  partialBundledLanguages: true,
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false, // Disable suspense for SSR compatibility
  },
});

// The one place a locale's strings are loaded and applied. The bundle has to be
// registered before `changeLanguage`, or the render between the two would fall
// back to English and then flip.
export const setLanguage = async (langCode: string) => {
  const supported = getSupportedLanguage(langCode);
  if (!supported || supported === i18n.language) return;

  const load = loaderByCode[supported];
  if (load && !i18n.hasResourceBundle(supported, "translation")) {
    try {
      const module = await load();
      i18n.addResourceBundle(
        supported,
        "translation",
        module.default,
        true,
        true,
      );
    } catch (e) {
      // Keep the current language rather than switching to empty strings.
      console.warn(`Failed to load locale "${supported}":`, e);
      return;
    }
  }
  await i18n.changeLanguage(supported);
};

// Sync language from app settings
export const syncLanguageFromSettings = async () => {
  try {
    const result = await commands.getAppSettings();
    if (result.status === "ok" && result.data.app_language) {
      await setLanguage(result.data.app_language);
    } else {
      // Fall back to system locale detection if no saved preference
      const systemLocale = await locale();
      if (systemLocale) {
        await setLanguage(systemLocale);
      }
    }
  } catch (e) {
    console.warn("Failed to sync language from settings:", e);
  }
};

// Run language sync on init
syncLanguageFromSettings();

// Listen for language changes to update HTML dir and lang attributes
i18n.on("languageChanged", (lng) => {
  const dir = getLanguageDirection(lng);
  updateDocumentDirection(dir);
  updateDocumentLanguage(lng);
});

// Re-export RTL utilities for convenience
export { getLanguageDirection, isRTLLanguage } from "@/lib/utils/rtl";

export default i18n;
