import { useState, useLayoutEffect, useCallback, useMemo, useEffect, useRef } from 'react'
import { useChat } from '@ai-sdk/react'
import { ChatApiService } from '../services/api'
import { logger } from '../services/logger'
import { DefaultChatTransport, UIMessage } from 'ai'
import { useConfig } from '../contexts/ConfigContext'
import { useLanguage } from '../contexts/LanguageContext'
import type { SupportedLanguage } from '../utils/language'

export type ChatStatus = 'uninitialized' | 'loading' | 'initialized' | 'error'

export function useChatPersistence() {
  const [chatStatus, setChatStatus] = useState<ChatStatus>('uninitialized')
  const [chatId, setChatId] = useState<string | undefined>(undefined)
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([])
  const [streamError, setStreamError] = useState<string | null>(null)

  const { chatConfig, welcomeMessage } = useConfig()
  const { currentLanguage } = useLanguage()
  const {apiBaseUrl} = chatConfig
  
  // Track previous language to detect changes
  const previousLanguageRef = useRef<SupportedLanguage | undefined>(currentLanguage)

  // Get user's timezone
  const userTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch (error) {
      logger.warning('Failed to detect user timezone, falling back to UTC', { error })
      return 'UTC'
    }
  }, [])

  const chatService = useMemo(
    () => new ChatApiService(chatConfig),
    [chatConfig]
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

  // Create a new chat (used when language changes)
  const createNewChat = useCallback(async () => {
    setChatStatus('loading')
    
    try {
      // Clear existing chat state
      setChatId(undefined)
      setInitialMessages([])
      chat.setMessages([])
      
      // Clear storage and create a new chat with the current (localized) welcome message
      await chatService.startNewChat()
      
      // Create new chat with localized welcome message
      const chatInit = await chatService.createNewChat({ welcomeMessage })
      
      // Store initial messages
      if (chatInit.messages && chatInit.messages.length > 0) {
        setInitialMessages(chatInit.messages)
      }
      
      // Set the new chat ID
      setChatId(chatInit.chatId)
      
      setChatStatus('initialized')
    } catch (error) {
      logger.error('Error creating new chat:', error)
      setChatStatus('error')
    }
  }, [chatService, chat, welcomeMessage])

  // Auto-initialize when hook is first used
  useLayoutEffect(() => {
    if (chatStatus === 'uninitialized' && chatConfig) {
      initializeChat()
    }
  }, [chatStatus, chatConfig, initializeChat])

  // Detect language changes and create a new chat
  useEffect(() => {
    // Skip if this is the initial render or chat hasn't been initialized yet
    if (chatStatus === 'uninitialized' || chatStatus === 'loading') {
      previousLanguageRef.current = currentLanguage
      return
    }

    // Check if language has changed
    if (previousLanguageRef.current !== currentLanguage && chatStatus === 'initialized') {
      logger.info('Language changed, creating new chat', {
        previousLanguage: previousLanguageRef.current,
        newLanguage: currentLanguage
      })
      
      // Create a new chat when language changes
      createNewChat()
      
      // Update the ref to track the new language
      previousLanguageRef.current = currentLanguage
    }
  }, [currentLanguage, chatStatus, createNewChat])

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
