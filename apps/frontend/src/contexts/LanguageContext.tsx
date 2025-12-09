import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { detectLanguageFromUrl, type SupportedLanguage } from '../utils/language'

// Default translations for "Powered by" text
export const DEFAULT_POWERED_BY_TRANSLATIONS: Record<SupportedLanguage, string> = {
  en: 'Powered by',
  fr: 'Propulsé par',
  es: 'Desarrollado por',
  pl: 'Obsługiwane przez',
  nl: 'Mogelijk gemaakt door',
  it: 'Offerto da',
  de: 'Bereitgestellt von',
}

interface LanguageContextValue {
  /** The currently detected language, or undefined if not detected */
  currentLanguage: SupportedLanguage | undefined
  /** Get the "Powered by" text for the current language */
  getPoweredByText: () => string
}

const LanguageContext = createContext<LanguageContextValue>({
  currentLanguage: undefined,
  getPoweredByText: () => DEFAULT_POWERED_BY_TRANSLATIONS.en,
})

export const useLanguage = () => useContext(LanguageContext)

interface LanguageProviderProps {
  children: ReactNode
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [currentLanguage, setCurrentLanguage] = useState<SupportedLanguage | undefined>(() => 
    detectLanguageFromUrl()
  )

  // Listen for URL changes (for SPAs using pushState/replaceState)
  useEffect(() => {
    const handleUrlChange = () => {
      const detectedLang = detectLanguageFromUrl()
      setCurrentLanguage(detectedLang)
    }

    // Listen for popstate (browser back/forward)
    window.addEventListener('popstate', handleUrlChange)

    // Override pushState and replaceState to detect programmatic navigation
    const originalPushState = history.pushState.bind(history)
    const originalReplaceState = history.replaceState.bind(history)

    history.pushState = (...args) => {
      originalPushState(...args)
      handleUrlChange()
    }

    history.replaceState = (...args) => {
      originalReplaceState(...args)
      handleUrlChange()
    }

    return () => {
      window.removeEventListener('popstate', handleUrlChange)
      history.pushState = originalPushState
      history.replaceState = originalReplaceState
    }
  }, [])

  const getPoweredByText = useCallback(() => {
    const lang = currentLanguage || 'en'
    return DEFAULT_POWERED_BY_TRANSLATIONS[lang]
  }, [currentLanguage])

  return (
    <LanguageContext.Provider value={{ currentLanguage, getPoweredByText }}>
      {children}
    </LanguageContext.Provider>
  )
}

