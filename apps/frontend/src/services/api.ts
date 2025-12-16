import { ApiError, ErrorCodes as ServiceErrorCodes } from './errors'
import { logger } from './logger'
import type { ErrorCodeValue } from './errors'
import { UIMessage } from '@ai-sdk/react'

// Default config values (can be overridden)
export const DEFAULT_TOKEN_STORAGE_KEY = 'dialogue_foundry_token'
export const DEFAULT_CHAT_ID_STORAGE_KEY = 'dialogue_foundry_chat_id'
const DEFAULT_USER_ID_STORAGE_KEY = 'dialogue_foundry_user_id'

// In-memory storage fallback when localStorage is unavailable
class MemoryStorage implements Storage {
  private items: Record<string, string> = {}
  length = 0

  clear(): void {
    this.items = {}
    this.length = 0
  }

  getItem(key: string): string | null {
    return key in this.items ? this.items[key] : null
  }

  key(index: number): string | null {
    return Object.keys(this.items)[index] || null
  }

  removeItem(key: string): void {
    if (key in this.items) {
      delete this.items[key]
      this.length = Object.keys(this.items).length
    }
  }

  setItem(key: string, value: string): void {
    this.items[key] = value
    this.length = Object.keys(this.items).length
  }
}

// Check if localStorage is available
const getStorage = (): Storage => {
  try {
    // Test localStorage access
    const testKey = '_test_storage_access_'
    localStorage.setItem(testKey, 'test')
    localStorage.removeItem(testKey)
    return localStorage
  } catch (e) {
    logger.warning(
      'localStorage not available, falling back to memory storage',
      { error: e }
    )
    return new MemoryStorage()
  }
}

export interface ChatConfig {
  apiBaseUrl: string
  companyId: string
  tokenStorageKey?: string
  chatIdStorageKey?: string
  userIdStorageKey?: string
}

interface Message {
  id: string
  chat_id: string
  user_id: string
  content: string
  role: string
  sequence_number: number
  created_at: string
  updated_at: string | null
  title?: string | null
}

interface ChatInit {
  chatId: string
  messages: UIMessage[]
}

// Simple fetch wrapper class
class FetchWrapper {
  private baseURL: string
  private defaultHeaders: Record<string, string>
  private timeout: number
  private getAuthToken: () => string | null

  constructor(baseURL: string, getAuthToken: () => string | null) {
    this.baseURL = baseURL
    this.defaultHeaders = {
      'Content-Type': 'application/json'
    }
    this.timeout = 30000 // 30 second timeout
    this.getAuthToken = getAuthToken
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseURL}${endpoint}`
    
    // Add auth token if available
    const token = this.getAuthToken()
    const headers = {
      ...this.defaultHeaders,
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }

    // Create AbortController for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      // Handle response errors similar to axios interceptor
      if (!response.ok) {
        const responseStatus = response.status
        let data: any = {}
        
        try {
          data = await response.json()
        } catch (e) {
          // Response might not be JSON
        }

        let errorCode: ErrorCodeValue = ServiceErrorCodes.UNKNOWN_ERROR

        // Check if there's a specific error in the response
        if (data && data.error) {
          errorCode = data.code || `HTTP_${responseStatus}`
        }

        // Create friendly messages for common HTTP status codes
        switch (responseStatus) {
          case 401:
            if (data && data.code === ServiceErrorCodes.TOKEN_EXPIRED) {
              errorCode = ServiceErrorCodes.TOKEN_EXPIRED
            } else {
              errorCode = ServiceErrorCodes.TOKEN_INVALID
            }
            break
          case 403:
            errorCode = ServiceErrorCodes.AUTH_FORBIDDEN
            break
          case 404:
            errorCode = ServiceErrorCodes.NOT_FOUND
            break
          case 429:
            errorCode = ServiceErrorCodes.RATE_LIMITED
            break
          case 500:
          case 502:
          case 503:
          case 504:
            errorCode = ServiceErrorCodes.SERVER_ERROR
            break
        }

        const apiError = new ApiError(errorCode, false)

        // Only log to Honeybadger for non-expiration errors
        if (errorCode !== ServiceErrorCodes.TOKEN_EXPIRED) {
          logger.captureException(apiError, {
            httpStatus: responseStatus,
            endpoint: url,
            method: options.method?.toUpperCase() || 'GET',
            requestData: options.body,
            responseData: data
          })
        }

        throw apiError
      }

      // Return response data
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        return { data: await response.json() }
      } else {
        return { data: await response.text() }
      }

    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof ApiError) {
        throw error
      }

      if (error.name === 'AbortError') {
        const timeoutError = new ApiError(ServiceErrorCodes.REQUEST_FAILED, true)
        logger.captureException(timeoutError, {
          endpoint: url,
          method: options.method?.toUpperCase() || 'GET',
          message: 'Request timeout'
        })
        throw timeoutError
      }

      // Network or other errors
      const networkError = new ApiError(ServiceErrorCodes.NETWORK_ERROR, true)
      logger.captureException(networkError, {
        originalError: error,
        endpoint: url,
        method: options.method?.toUpperCase() || 'GET'
      })
      throw networkError
    }
  }

  async get(endpoint: string): Promise<any> {
    return this.request(endpoint, { method: 'GET' })
  }

  async post(endpoint: string, data?: any): Promise<any> {
    return this.request(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined
    })
  }

  async put(endpoint: string, data?: any): Promise<any> {
    return this.request(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined
    })
  }

  async delete(endpoint: string): Promise<any> {
    return this.request(endpoint, { method: 'DELETE' })
  }
}

export class ChatApiService {
  private apiBaseUrl: string
  private companyId: string
  private tokenStorageKey: string
  private chatIdStorageKey: string
  private userIdStorageKey: string
  private storage: Storage
  private api: FetchWrapper

  constructor(config: ChatConfig, language?: string) {
    this.apiBaseUrl = config.apiBaseUrl
    this.companyId = config.companyId
    
    // Append language suffix to storage keys if language is provided
    const suffix = language ? `_${language}` : ''
    
    this.tokenStorageKey = (config.tokenStorageKey || DEFAULT_TOKEN_STORAGE_KEY) + suffix
    this.chatIdStorageKey = (config.chatIdStorageKey || DEFAULT_CHAT_ID_STORAGE_KEY) + suffix
    this.userIdStorageKey = (config.userIdStorageKey || DEFAULT_USER_ID_STORAGE_KEY) + suffix
    this.storage = getStorage()

    // Create fetch wrapper instance
    this.api = new FetchWrapper(
      this.apiBaseUrl,
      () => this.storage.getItem(this.tokenStorageKey)
    )
  }

  /**
   * Initialize the chat system
   * - Checks for existing token and chat ID
   * - If not found, creates a new chat
   * - Returns the chat data and conversation history
   */
  async initializeChat(welcomeMessage: string | undefined): Promise<ChatInit> {
    const storedToken = this.storage.getItem(this.tokenStorageKey)
    const storedChatId = this.storage.getItem(this.chatIdStorageKey)

    // If we have both a token and chat ID, try to load the existing chat
    if (storedToken && storedChatId) {
      try {
        const response = await this.api.get(`/chats/${storedChatId}`)

        return {
          chatId: storedChatId,
          messages: this.mapMessagesToUIFormat(response.data.messages || [])
        }
      } catch (error) {
        // Check if this is a token expiration
        if (
          error instanceof ApiError &&
          error.code === ServiceErrorCodes.TOKEN_EXPIRED
        ) {
          logger.debug('Token expired during initialization, creating new chat')
        } else {
          logger.error('Error loading existing chat', {
            chatId: storedChatId,
            error
          })
        }

        // If there's an error (e.g., token expired), clear storage and create a new chat
        this.storage.removeItem(this.tokenStorageKey)
        this.storage.removeItem(this.chatIdStorageKey)
      }
    }

    // Create a new chat
    return this.createNewChat({ welcomeMessage })
  }

  /**
   * Create a new chat session
   */
  async createNewChat({
    welcomeMessage,
    sameUser
  }: { welcomeMessage?: string; sameUser?: boolean } = {}): Promise<ChatInit> {
    try {
      const userId = sameUser
        ? this.storage.getItem(this.userIdStorageKey)
        : undefined

      const response = await this.api.post('/chats', {
        name: 'New Conversation',
        companyId: this.companyId,
        welcomeMessage,
        ...(userId
          ? {
              userId
            }
          : {})
      })

      // Store token and chat ID
      this.storage.setItem(this.tokenStorageKey, response.data.accessToken)
      this.storage.setItem(this.chatIdStorageKey, response.data.chat.id)
      this.storage.setItem(this.userIdStorageKey, response.data.chat.user_id)

      return {
        chatId: response.data.chat.id,
        messages: this.mapMessagesToUIFormat(response.data.messages || [])
      }
    } catch (error) {
      logger.error('Error creating new chat', { error })

      // Throw a more informative error
      if (error instanceof ApiError) {
        throw error
      } else {
        const chatCreationError = new ApiError(
          ServiceErrorCodes.CHAT_CREATION_FAILED,
          false
        )

        logger.captureException(chatCreationError, {
          originalError: error
        })

        throw chatCreationError
      }
    }
  }

  /**
   * Clear the current chat session and create a new one
   */
  async startNewChat(): Promise<ChatInit> {
    this.storage.removeItem(this.tokenStorageKey)
    this.storage.removeItem(this.chatIdStorageKey)

    return this.createNewChat()
  }

  /**
   * Get the current chat ID
   */
  getCurrentChatId(): string | null {
    return this.storage.getItem(this.chatIdStorageKey)
  }

  /**
   * Get the current authentication token
   */
  getCurrentToken(): string | null {
    return this.storage.getItem(this.tokenStorageKey)
  }

  /**
   * Get the current user ID
   */
  getCurrentUserId(): string | null {
    return this.storage.getItem(this.userIdStorageKey)
  }

  /**
   * Get the company ID
   */
  getCompanyId(): string {
    return this.companyId
  }

  /**
   * Get the API base URL
   */
  getApiBaseUrl(): string {
    return this.apiBaseUrl
  }

  /**
   * Map backend message format to UI format
   * @param messages - Backend messages
   */
  private mapMessagesToUIFormat(messages: Message[]): UIMessage[] {
    return messages.map((msg: any) => ({
              id: msg.id,
              role: msg.role as 'user' | 'assistant' | 'system',
              parts: [
                {
                  type: 'text',
                  text: msg.content
                }
              ],
              createdAt: new Date(msg.createdAt)
            }))
  }

  /**
   * Check if the chat session is properly initialized
   */
  isChatInitialized(): boolean {
    const chatId = this.storage.getItem(this.chatIdStorageKey)
    const userId = this.storage.getItem(this.userIdStorageKey)
    const token = this.storage.getItem(this.tokenStorageKey)

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

    return !!(
      chatId &&
      userId &&
      token &&
      uuidRegex.test(chatId) &&
      uuidRegex.test(userId)
    )
  }

  /**
   * Record an analytics event - tries sendBeacon first, falls back to regular POST
   */
  async recordAnalyticsEvent(eventType: string, eventData: Record<string, any> = {}): Promise<void> {
    // Capture all required values immediately to avoid issues during page unload
    const chatId = this.storage.getItem(this.chatIdStorageKey)
    const userId = this.storage.getItem(this.userIdStorageKey)

    // Check if chat is properly initialized
    if (!chatId || !userId) {
      console.warn('Skipping analytics event - missing required identifiers:', {
        eventType,
        hasChatId: !!chatId,
        hasUserId: !!userId,
        chatIdValue: chatId,
        userIdValue: userId
      })
      return
    }

    // Note: message_id is omitted because:
    // 1. AI SDK uses nanoid format which is incompatible with DB UUID column
    // 2. There's a foreign key constraint to messages table
    // 3. The field is optional in the database schema
    // TODO: Future - remove FK constraint and change column to TEXT to support nanoid
    
    const analyticsPayload = {
      chat_id: chatId,
      // message_id intentionally omitted - see note above
      user_id: userId,
      company_id: this.companyId,
      event_type: eventType,
      event_data: eventData,
      user_agent: navigator.userAgent,
      referrer: document.referrer
    }

    // Try sendBeacon first if available (for better reliability during page unload)
    if (typeof navigator.sendBeacon === 'function') {
      try {
        
        // Use text/plain content type to avoid CORS preflight issues on mobile
        const beaconSuccess = navigator.sendBeacon(
          `${this.apiBaseUrl}/events`, 
          JSON.stringify(analyticsPayload)
        )
        
        if (beaconSuccess) {
          console.log('Analytics event sent via sendBeacon:', {
            eventType,
            url: eventData.url,
            payload: analyticsPayload,
            success: true
          })
          return // Success, no need to fall back
        } else {
          console.warn(
            'sendBeacon failed to queue request, falling back to regular POST'
          )
        }
      } catch (error) {
        console.warn(
          'sendBeacon threw an error, falling back to regular POST:',
          error
        )
      }
    }

    // Fallback to regular authenticated POST request
    try {
      await this.api.post('/analytics/events', analyticsPayload)
      console.log('Analytics event sent via regular POST:', {
        eventType,
        url: eventData.url,
        success: true
      })
    } catch (error) {
      // Don't throw analytics errors - just log them
      logger.error('Error recording analytics event', {
        eventType,
        eventData,
        analyticsPayload,
        error
      })
    }
  }

  /**
   * Record a link click event
   */
  async recordLinkClick(
    url: string,
    linkText?: string,
  ): Promise<void> {
    await this.recordAnalyticsEvent('link_click', {
      url,
      link_text: linkText,
    })
  }

  /**
   * Record a conversation starter click event
   */
  async recordConversationStarterClick(label: string | undefined, position: number, prompt?: string): Promise<void> {
    await this.recordAnalyticsEvent('conversation_starter_click', {
      label,
      position,
      prompt
    })
  }

  /**
   * Send an email request (after user provides email)
   */
  async sendEmailRequest(
    chatId: string,
    {
      userEmail,
      subject,
      conversationSummary,
      isUnbranded = false
    }: { userEmail: string; subject: string; conversationSummary: string; isUnbranded?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.api.post(`/chats/${chatId}/send-email`, {
        userEmail,
        subject,
        conversationSummary,
        isUnbranded
      })
      return { success: true }
    } catch (error) {
      if (error instanceof ApiError) {
        return { success: false, error: error.message }
      }
      return { success: false, error: 'Unknown error' }
    }
  }
}
