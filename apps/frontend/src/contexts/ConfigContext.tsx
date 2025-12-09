import { createContext, useContext, useState, useEffect, useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import type { ChatConfig } from '../services/api'
import { useLanguage, DEFAULT_POWERED_BY_TRANSLATIONS } from './LanguageContext'
import type { SupportedLanguage } from '../utils/language'

type Suggestion = {
  label?: string
  prompt: string
}

// Translatable fields that can be localized per language
export interface LocalizableConfig {
  title?: string
  suggestions?: Suggestion[]
  welcomeMessage?: string
  popupMessage?: string
  poweredBy?: {
    text?: string
  }
}

// Define the Config type that extends ChatConfig and includes any other app-wide settings
export interface DialogueFoundryConfig {
  suggestions?: Suggestion[]

  // Chat Config
  chatConfig: ChatConfig

  // Widget customization
  title?: string
  logoUrl?: string

  // Welcome popup configuration
  popupMessage?: string

  welcomeMessage?: string

  openOnLoad?: 'all' | 'mobile-only' | 'desktop-only' | 'none'

  poweredBy?: {
    text?: string
    url?: string
    show?: boolean
  }

  styles?: {
    primaryColor?: string
    secondaryColor?: string
    mutedColor?: string
    accentColor?: string
    backgroundColor?: string
    foregroundColor?: string
    fontFamily?: string
  }

  theme?: 'primary' | 'secondary'

  // Localization support - organize translatable content by language
  locales?: Partial<Record<SupportedLanguage, LocalizableConfig>>
}

const styleToVariableMap: Record<keyof DialogueFoundryConfig['styles'], string> = {
  primaryColor: '--df-color-primary',
  secondaryColor: '--df-color-secondary',
  mutedColor: '--df-color-muted',
  accentColor: '--df-color-accent',
  backgroundColor: '--df-color-background',
  foregroundColor: '--df-color-foreground',
  fontFamily: '--df-font-family',
} as const

// Default configuration
const defaultConfig: DialogueFoundryConfig = {
  chatConfig: {
    apiBaseUrl: 'http://localhost:3000/api',
    companyId: 'west-hills-vineyards'
  },
  logoUrl: "https://keystonecoachworks.net/wp-content/uploads//2017/06/Keystone-logo-wht-grey-no-outline-header.png",
  popupMessage: "Have questions? Click here for help!",
  welcomeMessage: "Welcome to Keystone Coach Works!\n\nReady to hit the road in style? Whether you're looking to rent, buy, or customize a luxury camper van, I'm here to help.\n\nHave a question? Just ask, or click one of the quick topics below to get started on your next adventure!",
  poweredBy: {
    show: false
  },
  suggestions: [
    {
      prompt:
        'What customization options are available?'
    },
    {
      prompt: 'How can I rent a camper van and what are the rates?'
    },
    {
      prompt:
        'Do you have any camper vans available for sale?'
    },
    {
      // No label - will display the prompt and wrap to two lines
      prompt: 'How can I contact Keystone Coachworks?'
    },
  ],
  theme: 'primary',
  styles: {
    primaryColor: '#2563eb',
    secondaryColor: '#f3f4f6',
    mutedColor: '#f3f4f6',
    accentColor: '#f3f4f6',
    backgroundColor: '#ffffff',
    foregroundColor: '#1f2937',
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
}

// Create the context with default values
const ConfigContext = createContext<DialogueFoundryConfig>(defaultConfig)

// Custom hook to use the config context
export const useConfig = () => useContext(ConfigContext)

/**
 * Merges locale-specific configuration with the base configuration.
 * If a language is detected and locale config exists, it overrides the base values.
 */
function mergeLocalizedConfig(
  baseConfig: DialogueFoundryConfig,
  language: SupportedLanguage | undefined
): DialogueFoundryConfig {
  // If no language detected, return base config unchanged
  if (!language) {
    return baseConfig
  }

  const localeConfig = baseConfig.locales?.[language]
  
  // If no locale config for this language, return base config unchanged
  if (!localeConfig) {
    return baseConfig
  }

  // Merge locale-specific fields over base config
  return {
    ...baseConfig,
    // Override translatable fields if they exist in locale config
    ...(localeConfig.title !== undefined && { title: localeConfig.title }),
    ...(localeConfig.suggestions !== undefined && { suggestions: localeConfig.suggestions }),
    ...(localeConfig.welcomeMessage !== undefined && { welcomeMessage: localeConfig.welcomeMessage }),
    ...(localeConfig.popupMessage !== undefined && { popupMessage: localeConfig.popupMessage }),
    // Deep merge poweredBy
    poweredBy: {
      ...baseConfig.poweredBy,
      ...(localeConfig.poweredBy?.text !== undefined && { text: localeConfig.poweredBy.text }),
    },
  }
}

interface ConfigProviderProps {
  children: ReactNode
  initialConfig?: Partial<DialogueFoundryConfig>
}

// Define the ConfigProvider as a named function component rather than an arrow function
// This helps Fast Refresh identify the component correctly
export function ConfigProvider({ children }: ConfigProviderProps) {
  const [config, setConfigState] = useState<DialogueFoundryConfig | undefined>(
    undefined
  )
  const [configLoaded, setConfigLoaded] = useState(false)
  const { currentLanguage } = useLanguage()

  useEffect(() => {
    // Function to load config from an external JSON file
    const loadExternalConfig = async () => {
      if (import.meta.env.DEV) {
        console.log('Loading development config')
        setConfigState(defaultConfig)
        setConfigLoaded(true)
        return
      }

      try {
        // Try to load from a script tag with id="dialogue-foundry-config"
        const configScript = document.getElementById('dialogue-foundry-config')

        if (configScript && configScript.textContent) {
          try {
            // Extract the actual JSON content, ignoring any comments.
            const textContent = configScript.textContent.trim()
            let jsonContent = textContent

            // If there are comments in the text content, try to extract just the JSON
            if (textContent.includes('/*') || textContent.includes('//')) {
              // Simple regex to extract JSON - this assumes the JSON is a complete object
              const jsonMatch = textContent.match(/(\{[\s\S]*\})/)
              if (jsonMatch) {
                jsonContent = jsonMatch[1]
              }
            }

            const parsedConfig = JSON.parse(jsonContent)

            // If API URL is a placeholder, replace it with the actual URL
            if (parsedConfig.chatConfig?.apiBaseUrl === 'RUNTIME_PLACEHOLDER') {
              parsedConfig.chatConfig.apiBaseUrl =
                window.location.hostname === 'localhost'
                  ? 'http://localhost:3000/api'
                  : `${window.location.origin}/api`
            }

            setConfigState(parsedConfig)
            setConfigLoaded(true)
            return
          } catch (parseError) {
            console.error('Error parsing config from script tag:', parseError)
          }
        }

        // If no config was found, just use defaults
        console.log('No external config found, using defaults')
        setConfigState(defaultConfig)
        setConfigLoaded(true)
      } catch (error) {
        console.error('Error loading dialogue foundry configuration:', error)
        setConfigLoaded(true)
      }
    }

    loadExternalConfig()
  }, [])

  // First merge base config with any overrides
  const baseConfig = config ? {
    ...(import.meta.env.DEV ? defaultConfig : {}),
    ...config,
    styles: {
      ...defaultConfig.styles,
      ...config.styles
    }
  } : defaultConfig

  // Then apply locale-specific overrides based on detected language
  const finalConfig = mergeLocalizedConfig(baseConfig, currentLanguage)

  // Dynamically inject styles into CSS custom properties
  useLayoutEffect(() => {
    if (!finalConfig?.styles) return

    const root = document.documentElement
    Object.entries(finalConfig.styles).forEach(([style, value]) => {
      const variable = styleToVariableMap[style as keyof DialogueFoundryConfig['styles']]
      root.style.setProperty(variable, value)
    })

    // Cleanup function to reset styles when component unmounts
    return () => {
      Object.keys(finalConfig.styles ?? {}).forEach((style) => {
        const variable = styleToVariableMap[style as keyof DialogueFoundryConfig['styles']]
        root.style.removeProperty(variable)
      })
    }
  }, [finalConfig?.styles])

  // Don't render children until config is loaded
  if (!configLoaded) {
    // eslint-disable-next-line no-null/no-null
    return null // Return null instead of undefined for React components
  }

  return (
    <ConfigContext.Provider value={{ ...finalConfig }}>
      {children}
    </ConfigContext.Provider>
  )
}

// Add TypeScript interface for the global window object
declare global {
  interface Window {
    dialogueFoundryConfig?: Partial<DialogueFoundryConfig>
  }
}
