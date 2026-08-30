/**
 * RTL (Right-to-Left) utilities for handling text direction in the application.
 *
 * These utilities help manage RTL languages like Arabic, Hebrew, Persian, and Urdu.
 * They work with the i18n system to automatically update HTML attributes when
 * the language changes.
 */
import {
  isLanguageCode,
  LANGUAGE_METADATA,
  type LanguageMetadata,
} from "@/i18n/languages";

export type LanguageDirection = "ltr" | "rtl";

/**
 * Check if a language code is RTL (Right-to-Left)
 * @param langCode - The language code (e.g., 'ar', 'en', 'he')
 * @returns true if the language is RTL, false otherwise
 */
export const isRTLLanguage = (langCode: string): boolean => {
  const code = langCode.split("-")[0].toLowerCase();
  if (!isLanguageCode(code)) return false;
  const metadata: LanguageMetadata = LANGUAGE_METADATA[code];
  return metadata.direction === "rtl";
};

/**
 * Get the text direction ('ltr' or 'rtl') for a language
 * @param langCode - The language code (e.g., 'ar', 'en', 'he')
 * @returns 'rtl' if RTL language, 'ltr' otherwise
 */
export const getLanguageDirection = (langCode: string): LanguageDirection => {
  return isRTLLanguage(langCode) ? "rtl" : "ltr";
};

/**
 * Update the HTML document's dir attribute
 * @param dir - The direction ('ltr' or 'rtl')
 */
export const updateDocumentDirection = (dir: LanguageDirection): void => {
  globalThis.document?.documentElement.setAttribute("dir", dir);
};

/**
 * Update the HTML document's lang attribute
 * @param lang - The language code (e.g., 'ar', 'en')
 */
export const updateDocumentLanguage = (lang: string): void => {
  globalThis.document?.documentElement.setAttribute("lang", lang);
};

/**
 * Initialize RTL support for the current document
 * Should be called when the app initializes and when language changes
 * @param langCode - The current language code
 */
export const initializeRTL = (langCode: string): void => {
  const dir = getLanguageDirection(langCode);
  updateDocumentDirection(dir);
  updateDocumentLanguage(langCode);
};
