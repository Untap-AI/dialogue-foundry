import { useState, useEffect, useMemo } from 'react'
import { AiChat, useAsStreamAdapter, type ChatItem } from '@nlux/react'
import '@nlux/themes/nova.css'

import { ChatApiService, type ChatConfig } from '../services/api'
import { ChatStreamingService } from '../services/streaming'

export interface ChatInterfaceProps {
  chatConfig?: ChatConfig
  initialMessages?: ChatItem[]
  height?: string | number
  width?: string | number
  onChatInitialized?: (chatId: string) => void
  className?: string
}

export const ChatInterface = ({
  chatConfig = {},
  initialMessages = [],
  height = '100%',
  width = '100%',
  onChatInitialized,
  className
}: ChatInterfaceProps) => {
  const [isLoading, setIsLoading] = useState(true)
  const [chatId, setChatId] = useState<string | undefined>(undefined)
  const [messages, setMessages] = useState<ChatItem[]>(initialMessages)

  // Initialize services
  const apiService = useMemo(() => new ChatApiService(chatConfig), [chatConfig])
  const streamingService = useMemo(
    () => new ChatStreamingService(chatConfig),
    [chatConfig]
  )

  useEffect(() => {
    // Initialize chat on component mount
    const setupChat = async () => {
      try {
        setIsLoading(true)
        const chatInit = await apiService.initializeChat()
        setChatId(chatInit.chatId)
        setMessages(chatInit.messages)

        if (onChatInitialized) {
          onChatInitialized(chatInit.chatId)
        }
      } catch (error) {
        console.error('Failed to initialize chat:', error)
      } finally {
        setIsLoading(false)
      }
    }

    setupChat()

    // Cleanup
    return () => {
      streamingService.cancelStream()
    }
  }, [apiService, onChatInitialized, streamingService])

  // Create adapter using our streaming service
  const adapter = useAsStreamAdapter((message, observer) => {
    streamingService.streamMessage(
      message,
      // On each chunk update
      chunk => observer.next(chunk),
      // On complete
      () => observer.complete(),
      // On error
      error => observer.error(error)
    )
  }, messages)

  // Handle starting a new chat
  const handleNewChat = async () => {
    setIsLoading(true)
    try {
      const chatInit = await apiService.startNewChat()
      setChatId(chatInit.chatId)
      setMessages([])

      if (onChatInitialized) {
        onChatInitialized(chatInit.chatId)
      }
    } catch (error) {
      console.error('Failed to start new chat:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div
        style={{
          width,
          height
        }}
        className={`flex justify-center items-center ${className}`}
      >
        <div className="flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
          <p className="text-gray-500 text-sm">Loading chat...</p>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        width,
        height
      }}
      className={`flex flex-col ${className}`}
    >
      <div className="p-2 flex justify-end border-b border-gray-100">
        <button
          onClick={handleNewChat}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors duration-200 flex items-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-1"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          New Chat
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <AiChat
          adapter={adapter}
          key={chatId} // Add a key to force re-render when chatId changes
          initialConversation={messages}
        />
      </div>
    </div>
  )
}
