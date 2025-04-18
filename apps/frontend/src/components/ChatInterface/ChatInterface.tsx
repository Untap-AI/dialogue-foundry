import { useMemo } from 'react'
import { AiChat, useAsStreamAdapter } from '@nlux/react'
import { useConfig } from '../../contexts/ConfigContext'
import '@nlux/themes/unstyled.css'
import './ChatInterface.css'

import { ChatStreamingService } from '../../services/streaming'
import { ErrorCategory, categorizeError } from '../../services/errors'
import type { ChatStatus } from '../ChatWidget/ChatWidget'
import type { ServiceError } from '../../services/errors'
import type { ChatItem, ErrorEventDetails } from '@nlux/react'

// Add the icon based on error category
const ERROR_ICON_MAP: Record<ErrorCategory, string> = {
  [ErrorCategory.AUTHENTICATION]: '🔒',
  [ErrorCategory.CONNECTION]: '🔌',
  [ErrorCategory.SERVER]: '🖥️',
  [ErrorCategory.RATE_LIMIT]: '⏱️',
  [ErrorCategory.TIMEOUT]: '⌛',
  [ErrorCategory.UNKNOWN]: '⚠️'
}

export interface ChatInterfaceProps {
  className?: string | undefined
  chatId: string | undefined
  initialConversation: ChatItem[] | undefined
  chatStatus: ChatStatus
}

export const ChatInterface = ({
  className,
  chatId,
  initialConversation,
  chatStatus
}: ChatInterfaceProps) => {
  // Get config from context
  const {
    conversationStarters,
    chatConfig,
    theme = 'light',
    personaOptions
  } = useConfig()

  const streamingService = useMemo(
    () => new ChatStreamingService(chatConfig),
    [chatConfig]
  )

  // Create adapter at the top level
  const adapter = useAsStreamAdapter(
    (userMessage: string, observer) => {
      // Call the streaming service with the message content
      streamingService.streamMessage(
        userMessage,
        // On each chunk update
        chunk => observer.next(chunk),
        // On complete
        () => observer.complete(),
        // On error - handle the error and pass to the observer
        error => {
          // Pass the error to the observer for NLUX to handle
          observer.error(error)
        },
        chatConfig.companyId
      )
    },
    [chatConfig.companyId, streamingService]
  )

  // Create a custom error handler for the NLUX error event
  const handleNluxError = (error: ErrorEventDetails) => {
    if (!error.errorObject) {
      return
    }

    const errorObject = error.errorObject as ServiceError

    // Find the error box element
    const errorBox = document.querySelector('.nlux-comp-exceptionBox')
    if (errorBox) {
      // Clear the existing content
      errorBox.innerHTML = ''

      // Process the error through our error handling system
      const category = categorizeError(errorObject.code)
      const message = error.errorObject.message

      // Create our custom error banner
      const errorBanner = document.createElement('div')
      errorBanner.className = `df-error-banner df-error-${category}`

      // Build the error banner content
      errorBanner.innerHTML = `
        <div class="df-error-icon">${ERROR_ICON_MAP[category] || '⚠️'}</div>
        <div class="df-error-content">
          <div class="df-error-message">${message}</div>
        </div>
      `

      // Append our custom error banner
      errorBox.appendChild(errorBanner)

      setTimeout(() => {
        errorBox.innerHTML = ''
      }, 3000)
    }

    console.error('NLUX chat error:', error)
  }

  // Handle message sent event - creates ChatGPT-like scrolling
  const handleMessageSent = () => {
    // Find the conversation container
    const conversationContainer = document.querySelector(
      '.nlux-conversation-container'
    )
    const chatSegmentsContainer = document.querySelector(
      '.nlux-chatSegments-container'
    )

    if (
      conversationContainer &&
      conversationContainer instanceof HTMLElement &&
      chatSegmentsContainer &&
      chatSegmentsContainer instanceof HTMLElement
    ) {
      // Wait for the last message to be rendered
      setTimeout(() => {
        // Find the last sent message - use querySelectorAll and get the last one to ensure we get the most recent
        const sentMessages = document.querySelectorAll(
          '.nlux-comp-message.nlux_msg_sent'
        )
        const lastMessage =
          sentMessages.length > 0
            ? sentMessages[sentMessages.length - 1]
            : undefined

        if (lastMessage && lastMessage instanceof HTMLElement) {
          // Get the necessary measurements
          const chatSegmentsContainerRect =
            chatSegmentsContainer.getBoundingClientRect()
          const lastMessageRect = lastMessage.getBoundingClientRect()
          const conversationContainerHeight = conversationContainer.clientHeight

          // Calculate how far we need to scroll to position the last message at the top of the container
          // We add a small offset (70px) for better visual appearance
          const scrollOffset =
            conversationContainerHeight -
            (chatSegmentsContainerRect.bottom - lastMessageRect.bottom)
          // TODO: Calcuate small offset based on font size, etc.
          chatSegmentsContainer.style.minHeight = `${
            chatSegmentsContainer.scrollHeight + scrollOffset - 70
          }px`
        }
        // If for some reason we can't find the last message, fall back to scrolling to bottom
        conversationContainer.scrollTo({
          top: chatSegmentsContainer.scrollHeight,
          behavior: 'smooth'
        })
      }, 50)
    }
  }

  // TODO: ConversationStarter UI
  return (
    <div className={`chat-interface-wrapper ${className}`}>
      <div className="chat-interface-content">
        {(() => {
          switch (chatStatus) {
            case 'uninitialized':
            case 'loading':
              return (
                <div className="chat-loader-container">
                  <div className="chat-spinner"></div>
                  <p className="chat-loading-text">Loading chat...</p>
                </div>
              )
            case 'initialized':
              return (
                <AiChat
                  adapter={adapter}
                  key={chatId} // Add a key to force re-render when chatId changes
                  displayOptions={{
                    themeId: 'dialogue-foundry',
                    colorScheme: theme
                  }}
                  initialConversation={initialConversation}
                  conversationOptions={{
                    showWelcomeMessage: true,
                    conversationStarters,
                    autoScroll: false
                  }}
                  personaOptions={{
                    assistant: personaOptions?.assistant
                  }}
                  composerOptions={{
                    placeholder: 'Ask me anything...',
                    autoFocus: true
                  }}
                  events={{
                    error: handleNluxError,
                    messageSent: handleMessageSent
                  }}
                />
              )
            case 'error':
              return (
                <div className="chat-error-container">
                  <p className="chat-error-text">Error loading chat.</p>
                  <p className="chat-error-text">Please try again.</p>
                </div>
              )
          }
        })()}
      </div>
    </div>
  )
}
