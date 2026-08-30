import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { locale } from "@tauri-apps/plugin-os";
import { isLanguageCode, LANGUAGE_METADATA } from "./languages";
import type { TranslationTree } from "./translationTree";
import { commands } from "@/bindings";
import {
  getLanguageDirection,
  updateDocumentDirection,
  updateDocumentLanguage,
} from "@/lib/utils/rtl";
import enTranslation from "./locales/en/translation.json";

const FALLBACK_LANGUAGE = "en";

// Auto-discover non-English translation files using Vite's glob import. The
// fallback remains a static import, so it is always ready without also being
// emitted as a dynamic chunk.
const localeLoaders = import.meta.glob<{ default: TranslationTree }>([
  "./locales/*/translation.json",
  "!./locales/en/translation.json",
]);

// Keyed by locale code, from the glob's build-time keys.
const loaderByCode: Record<
  string,
  () => Promise<{ default: TranslationTree }>
> = {};
for (const [path, load] of Object.entries(localeLoaders)) {
  const langCode = path.match(/\.\/locales\/(.+)\/translation\.json/)?.[1];
  if (langCode) {
    loaderByCode[langCode] = load;
  }
}

loaderByCode[FALLBACK_LANGUAGE] = async () => ({ default: enTranslation });

// Build supported languages list from discovered locales + metadata
export const SUPPORTED_LANGUAGES = Object.keys(loaderByCode)
  .map((code) => {
    if (!isLanguageCode(code)) {
      console.warn(`Missing metadata for locale "${code}" in languages.ts`);
      return { code, name: code, nativeName: code, priority: undefined };
    }
    const meta = LANGUAGE_METADATA[code];
    return {
      code,
      name: meta.name,
      nativeName: meta.nativeName,
      priority: meta.priority,
    };
  })
  .sort((a, b) => {
    // Sort by priority first (lower = higher), then alphabetically
    if (a.priority !== undefined && b.priority !== undefined) {
      return a.priority - b.priority;
    }
    if (a.priority !== undefined) return -1;
    if (b.priority !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });

export type SupportedLanguageCode = string;

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
