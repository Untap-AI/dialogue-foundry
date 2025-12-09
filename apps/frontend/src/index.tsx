import {StrictMode} from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ConfigProvider, type DialogueFoundryConfig } from './contexts/ConfigContext'
import { LanguageProvider } from './contexts/LanguageContext'
import { initLogger } from './services/logger'

/**
 * Initialize the DialogueFoundry application
 * @param rootElement - The DOM element to mount the app to
 * @param options - Configuration options for the app
 */
async function init(
  rootElement: HTMLElement | null,
  options: Partial<DialogueFoundryConfig> = {}
) {
  if (!rootElement) {
    console.error('DialogueFoundry: Root element not found')
    return
  }

  // Initialize logger asynchronously (for manual error tracking only)
  initLogger({
    apiKey: import.meta.env.VITE_HONEYBADGER_API_KEY
  })

  // Create React root
  const root = createRoot(rootElement)

  // Render app with language and config context
  root.render(
    <StrictMode>
      <LanguageProvider>
        <ConfigProvider initialConfig={options}>
          <App />
        </ConfigProvider>
      </LanguageProvider>
    </StrictMode>
  )

  return root
}

// Auto-initialize if in standard mode (not being used as a library)
if (typeof window !== 'undefined' && !window.DialogueFoundry) {
  // Create a container div for the app
  const appContainer = document.createElement('div')
  appContainer.id = 'dialogue-foundry-app'
  document.body.appendChild(appContainer)

  // Initialize the app in the container
  init(appContainer).catch(error => {
    console.error('Failed to initialize DialogueFoundry:', error)
  })
}

// Expose the API to window for non-module usage
if (typeof window !== 'undefined') {
  window.DialogueFoundry = {
    init
  }
}

// Add DialogueFoundry to window type
declare global {
  interface Window {
    DialogueFoundry?: {
      init: typeof init
    }
  }
}