// Supported language codes
export type SupportedLanguage = 'en' | 'fr' | 'es' | 'pl' | 'nl' | 'it'

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['en', 'fr', 'es', 'pl', 'nl', 'it']

/**
 * Detects the language from the current URL.
 * Checks URL path first (e.g., /fr/, /en/page), then query params (?lang=fr).
 * 
 * @returns The detected language code, or undefined if no language is detected
 */
export function detectLanguageFromUrl(): SupportedLanguage | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const { pathname, search } = window.location

  // Check URL path first (e.g., /fr/, /en/page, /es-MX/)
  // Matches language codes at the start of the path, optionally followed by region code
  const pathMatch = pathname.match(/^\/(en|fr|es|pl|nl|it)(?:-[A-Z]{2})?(\/|$)/i)
  if (pathMatch) {
    const lang = pathMatch[1].toLowerCase() as SupportedLanguage
    if (SUPPORTED_LANGUAGES.includes(lang)) {
      return lang
    }
  }

  // Check query params (e.g., ?lang=fr or ?language=fr)
  const params = new URLSearchParams(search)
  const langParam = params.get('lang') || params.get('language')
  if (langParam) {
    // Extract base language code (e.g., 'fr' from 'fr-FR')
    const baseLang = langParam.split('-')[0].toLowerCase() as SupportedLanguage
    if (SUPPORTED_LANGUAGES.includes(baseLang)) {
      return baseLang
    }
  }

  return undefined
}

/**
 * Checks if a given string is a supported language code
 */
export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lang.toLowerCase() as SupportedLanguage)
}

