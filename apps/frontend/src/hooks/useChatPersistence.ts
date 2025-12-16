import { useState, useLayoutEffect, useCallback, useMemo, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { ChatApiService } from '../services/api'
import { logger } from '../services/logger'
import { DefaultChatTransport, UIMessage } from 'ai'
import { useConfig } from '../contexts/ConfigContext'
import { useLanguage } from '../contexts/LanguageContext'

export type ChatStatus = 'uninitialized' | 'loading' | 'initialized' | 'error'

export function useChatPersistence() {
  const [chatStatus, setChatStatus] = useState<ChatStatus>('uninitialized')
  const [chatId, setChatId] = useState<string | undefined>(undefined)
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([])
  const [streamError, setStreamError] = useState<string | null>(null)

  const { chatConfig, welcomeMessage } = useConfig()
  const { currentLanguage } = useLanguage()
  const {apiBaseUrl} = chatConfig

  // Get user's timezone
  const userTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch (error) {
      logger.warning('Failed to detect user timezone, falling back to UTC', { error })
      return 'UTC'
    }
  }, [])

  // Create chat service with language-specific storage keys
  // Each language gets its own chat session
  const chatService = useMemo(
    () => new ChatApiService(chatConfig, currentLanguage),
    [chatConfig, currentLanguage]
  )

  const transport = useMemo(() => {
    return new DefaultChatTransport({
      api: `${apiBaseUrl}/chats/stream-ai-sdk`,
      headers: () => {
        const token = chatService.getCurrentToken()
        const headers: Record<string, string> = {}
  
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
        return headers
      },
      prepareSendMessagesRequest: ({ id, messages, body, ...rest }) => {
        return {
          ...rest,
          body: {
            ...body,
            id: chatId || id,
            messages,
            timezone: userTimezone,
          },
        }
      }
    })
  }, [apiBaseUrl, chatService, userTimezone, chatId])

  // Initialize useChat hook with dynamic transport
  const chat = useChat({
    id: chatId,
    transport,
    onError: (error) => {
      logger.error('Chat stream error:', { error: error.message })
      setStreamError(error.message)

      setTimeout(() => {
        setStreamError(null)
      }, 8000)
    }
  })

  // Initialize chat session
  const initializeChat = useCallback(async () => {
    if (chatStatus !== 'uninitialized') return

    setChatStatus('loading')
    
    try {
      // Load existing chat or create new one
      // (storage keys are language-specific, so each language has its own chat)
      const chatInit = await chatService.initializeChat(welcomeMessage)
      
      // Store initial messages first (before setting chatId to avoid race condition)
      if (chatInit.messages && chatInit.messages.length > 0) {
        setInitialMessages(chatInit.messages)
      }
      
      // Set the chat ID to use with useChat (this will trigger useChat reinitialize)
      setChatId(chatInit.chatId)
      
      setChatStatus('initialized')
    } catch (error) {
      logger.error('Error loading existing chat:', error)
      setChatStatus('error')
    }
  }, [chatService, welcomeMessage, chatStatus])

  // Auto-initialize when hook is first used
  useLayoutEffect(() => {
    if (chatStatus === 'uninitialized' && chatConfig) {
      initializeChat()
    }
  }, [chatStatus, chatConfig, initializeChat])

  // Reset state when chatService changes (language changed)
  // This triggers re-initialization with the new language-specific storage keys
  useEffect(() => {
    // Reset to uninitialized state - the auto-initialize effect will then run
    setChatStatus('uninitialized')
    setChatId(undefined)
    setInitialMessages([])
    chat.setMessages([])
  }, [chatService]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear stream error when a new message starts  
  useEffect(() => {
    if (chat.status === 'submitted' && streamError) {
      setStreamError(null)
    }
  }, [chat.status, streamError])

  // Set initial messages when chat ID is set and we have messages to set
  useEffect(() => {
    if (chatId && initialMessages.length > 0 && chat.messages.length === 0) {
      chat.setMessages(initialMessages)
    }
  }, [chatId, initialMessages, chat])

  // Function to submit email for tool call
  const submitEmailForToolCall = useCallback(async (
    userEmail: string,
    toolCallId: string,
    subject: string,
    conversationSummary: string,
    isUnbranded: boolean = false
  ) => {
    if (!chatId) {
      throw new Error('No chat session available')
    }

    try {
      const result = await chatService.sendEmailRequest(chatId, {
        userEmail,
        subject,
        conversationSummary,
        isUnbranded
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to submit email')
      }
      
      // Add tool result to the chat
      chat.addToolResult({
        tool: 'request_user_email',
        toolCallId,
        output: 'Email sent successfully! We\'ll get back to you soon.'
      })
      
      return result
    } catch (error) {
      logger.error('Error submitting email for tool call:', error)
      throw error
    }
  }, [chatId, chatService, chat])

  // Analytics methods
  const recordLinkClick = useCallback(async (
    url: string,
    linkText?: string,
  ) => {
    await chatService.recordLinkClick(url, linkText)
  }, [chatService])

  const recordConversationStarterClick = useCallback(async (
    label: string,
    position: number,
    prompt: string
  ) => {
    await chatService.recordConversationStarterClick(label, position, prompt)
  }, [chatService])

  return {
    // Chat state
    chatStatus,
    streamError,
    
    // Chat methods
    initializeChat,
    clearStreamError: () => setStreamError(null),
    submitEmailForToolCall,
    
    // Analytics methods
    recordLinkClick,
    recordConversationStarterClick,
    
    // AI SDK chat hook
    ...chat
  }
}
