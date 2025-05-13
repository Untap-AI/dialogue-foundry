import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import {
  getChatById,
  getChatsByUserId,
  updateChat,
  deleteChat,
  createChatAdmin,
  getChatsByCompanyId
} from '../db/chats'
import {
  getMessagesByChatId,
  getLatestSequenceNumber,
  createMessageAdmin
} from '../db/messages'
import {
  generateStreamingChatCompletion,
  DEFAULT_SETTINGS
} from '../services/openai-service'
import { generateChatAccessToken } from '../lib/jwt-utils'
import {
  authenticateChatAccess,
  authenticateUser
} from '../middleware/auth-middleware'
import { getChatConfigByCompanyId } from '../db/chat-configs'
import {
  retrieveDocuments,
  formatDocumentsAsContext
} from '../services/pinecone-service'
import { cacheService } from '../services/cache-service'
import { logger } from '../lib/logger'
import type { CustomRequest } from '../middleware/auth-middleware'
import type { Message, ChatSettings } from '../services/openai-service'

const router = express.Router()

// Get all chats for a user (requires user authentication)
router.get(
  '/user/:userId',
  authenticateUser,
  async (req: CustomRequest, res) => {
    try {
      // Ensure the requesting user can only access their own chats
      const { userId } = req.params

      // Ensure userId is a string
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' })
      }

      // Check if the authenticated user is requesting their own chats
      if (req.user?.userId !== userId) {
        return res
          .status(403)
          .json({ error: 'You can only access your own chats' })
      }

      const chats = await getChatsByUserId(userId)
      return res.json(chats)
    } catch (error) {
      return res.status(500).json({ error })
    }
  }
)

// Get a chat by ID with its messages (requires chat-specific authentication)
router.get('/:chatId', authenticateChatAccess, async (req, res) => {
  try {
    const { chatId } = req.params

    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' })
    }

    // Check cache first
    let chat = cacheService.getChat(chatId)
    if (!chat) {
      const dbChat = await getChatById(chatId)
      if (dbChat) {
        // Cache the chat for future requests
        cacheService.setChat(chatId, dbChat)
        chat = dbChat
      }
    }

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' })
    }

    const messages = await getMessagesByChatId(chatId)

    return res.json({ chat, messages })
  } catch (error) {
    return res.status(500).json({ error })
  }
})

// Create a new chat and return access token
router.post('/', async (req, res) => {
  try {
    const {
      userId: userIdParam,
      name: chatName,
      companyId,
      welcomeMessage
    } = req.body

    if (!chatName) {
      logger.error('Chat name is required', {
        userId: req.body.userId
      })
      return res.status(400).json({ error: 'Chat name is required' })
    }

    if (!companyId) {
      logger.error('Company ID is required', {
        userId: req.body.userId
      })
      return res.status(400).json({ error: 'Company ID is required' })
    }

    let chatConfig = cacheService.getChatConfig(companyId)
    if (!chatConfig) {
      const dbConfig = await getChatConfigByCompanyId(companyId)
      if (dbConfig) {
        chatConfig = dbConfig
        cacheService.setChatConfig(companyId, dbConfig)
      } else {
        logger.error('Chat config not found', {
          userId: req.body.userId
        })
        return res.status(400).json({ error: 'Chat config not found' })
      }
    }

    const userId = userIdParam || uuidv4()

    const chat = await createChatAdmin({
      name: chatName,
      user_id: userId,
      company_id: companyId
    })

    if (welcomeMessage) {
      try {
        await createMessageAdmin({
          chat_id: chat.id,
          user_id: userId,
          content: welcomeMessage,
          role: 'assistant',
          sequence_number: 1
        })
      } catch (error) {
        logger.error('Error creating welcome message', {
          error: error as Error,
          chatId: chat.id
        })
      }
    }

    // Generate a JWT token for chat access
    const accessToken = generateChatAccessToken(chat.id, userId)

    return res.status(201).json({
      chat,
      accessToken
    })
  } catch (error) {
    logger.error('Error creating chat', {
      error: error as Error,
      userId: req.body.userId
    })
    return res.status(500).json({ error })
  }
})

// Get all chats for a specific company
router.get('/company/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params

    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' })
    }

    const chats = await getChatsByCompanyId(companyId)

    return res.json({ chats })
  } catch (error) {
    logger.error('Error getting company chats', {
      error: error as Error,
      companyId: req.params.companyId
    })
    return res.status(500).json({ error: 'Failed to get company chats' })
  }
})

// Update a chat (requires chat-specific authentication)
router.put('/:chatId', authenticateChatAccess, async (req, res) => {
  try {
    const { chatId } = req.params

    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' })
    }

    const { name: chatName } = req.body

    const updatedChat = await updateChat(chatId, {
      name: chatName,
      updated_at: new Date().toISOString()
    })

    // Update the cache with the new data
    if (updatedChat) {
      cacheService.setChat(chatId, updatedChat)
    }

    return res.json(updatedChat)
  } catch (error) {
    return res.status(500).json({ error })
  }
})

// Delete a chat (requires chat-specific authentication)
router.delete('/:chatId', authenticateChatAccess, async (req, res) => {
  try {
    const { chatId } = req.params

    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' })
    }

    await deleteChat(chatId)

    // Remove from cache
    cacheService.deleteChat(chatId)

    return res.json({ success: true })
  } catch (error) {
    return res.status(500).json({ error })
  }
})

// Shared handler function for stream requests
async function handleStreamRequest(req: CustomRequest, res: express.Response) {
  // Set the proper headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // Disable buffering for Nginx

  // Helper function to send errors via SSE
  const sendErrorEvent = (
    errorMessage: string,
    errorCode: string = 'STREAMING_ERROR'
  ) => {
    if (!res.writableEnded) {
      const errorData = {
        type: 'error',
        error: errorMessage,
        code: errorCode
      }
      logger.warn('Sending error event to client', {
        errorCode,
        errorMessage,
        endpoint: req.originalUrl
      })
      res.write(`data: ${JSON.stringify(errorData)}\n\n`)
      // Send a clean termination signal
      res.write(':\n\n')
      res.end()
    }
  }

  try {
    const { chatId } = req.params

    // Get content from body (POST) or query params (GET)
    const content = req.body.content || req.query.content
    const model = req.body.model || req.query.model
    const temperature = req.body.temperature || req.query.temperature
    const timezone = req.body.timezone || req.query.timezone || 'UTC'

    if (!chatId) {
      sendErrorEvent('Chat ID is required', 'INVALID_REQUEST')
      return
    }

    // Use the authenticated user's ID from the JWT token
    // This is set by the authenticateChatAccess middleware
    const userId = req.user?.userId

    if (!userId || !content) {
      sendErrorEvent(
        'User authentication and message content are required',
        'INVALID_REQUEST'
      )
      return
    }

    // Check cache first before database query
    let chat = cacheService.getChat(chatId)

    if (!chat) {
      const dbChat = await getChatById(chatId)

      if (dbChat) {
        chat = dbChat
        cacheService.setChat(chatId, dbChat)
      }
    }

    if (!chat) {
      sendErrorEvent('Chat not found', 'NOT_FOUND')
      return
    }

    // Get the company ID from the chat
    const companyId = chat.company_id

    // If the chat doesn't have a company_id, return an error
    if (!companyId) {
      sendErrorEvent(
        'This chat is not associated with any company. Please create a new chat with a company ID.',
        'INVALID_CHAT'
      )
      return
    }

    // Try to get config from cache first
    // TODO: Make this reusable for other routes
    let chatConfig = cacheService.getChatConfig(companyId)
    if (!chatConfig) {
      const dbConfig = await getChatConfigByCompanyId(companyId)
      if (dbConfig) {
        chatConfig = dbConfig
        cacheService.setChatConfig(companyId, dbConfig)
      } else {
        sendErrorEvent(
          'The company associated with this chat is not available. Please create a chat with a valid company ID.',
          'INVALID_COMPANY'
        )
        return
      }
    }

    // Get chat settings - using request parameters, chat config, or defaults
    const chatSettings: ChatSettings = {
      ...DEFAULT_SETTINGS,
      systemPrompt: chatConfig.system_prompt,
      // Pass company ID and support email if available
      companyId,
      enableEmailFunction: Boolean(chatConfig?.support_email),
      timezone
    }

    // Get all previous messages in this chat
    const previousMessages = await getMessagesByChatId(chatId)

    // Get the next sequence number
    const latestSequenceNumber = await getLatestSequenceNumber(chatId)
    const nextSequenceNumber = latestSequenceNumber + 1

    // Create both messages upfront but only insert the user message immediately
    const userMessageData = {
      chat_id: chatId,
      user_id: userId,
      content,
      role: 'user',
      sequence_number: nextSequenceNumber
    }

    // Save the user message using admin function to bypass RLS
    await createMessageAdmin(userMessageData)

    // Prepare messages for OpenAI API
    const openaiMessages: Message[] = [
      ...previousMessages.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content
      })),
      {
        role: 'user',
        content
      }
    ]

    // Retrieve relevant documents from Pinecone if an index is configured
    let contextFromDocs = ''
    if (chatConfig?.pinecone_index_name) {
      try {
        const documents = await retrieveDocuments(
          chatConfig.pinecone_index_name,
          content
        )
        if (documents && documents.length > 0) {
          contextFromDocs = formatDocumentsAsContext(documents)
        }
      } catch (retrievalError) {
        console.error('Error during document retrieval:', retrievalError)
        // Continue without document retrieval if it fails
      }
    }

    // If we retrieved context, add it as a system message
    if (contextFromDocs) {
      // Change this to make first message a system message
      openaiMessages.unshift({
        role: 'system',
        content: contextFromDocs
      })
    }

    // Send initial SSE message to confirm connection
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)
    res.flushHeaders()

    // Define SSE-formatted chunk sender
    const onChunk = (chunk: string) => {
      // Ensure the response is still writable
      if (!res.writableEnded) {
        // Format the chunk as a Server-Sent Event
        res.write(
          `data: ${JSON.stringify({
            type: 'chunk',
            content: chunk
          })}\n\n`
        )

        // Force immediate sending of the chunk
        res.flushHeaders()
      }
    }

    // Generate streaming response from OpenAI
    let aiResponseContent
    try {
      aiResponseContent = await generateStreamingChatCompletion(
        openaiMessages,
        chatSettings,
        onChunk
      )
    } catch (streamError) {
      logger.error('Error in streaming chat completion', {
        error: streamError as Error,
        chatId
      })
      aiResponseContent = '' // Fallback to empty string on error
    }

    await createMessageAdmin({
      chat_id: chatId,
      user_id: userId,
      content:
        aiResponseContent || 'Sorry, I was unable to generate a response.',
      role: 'assistant',
      sequence_number: nextSequenceNumber + 1
    })

    // Add a small delay to ensure all streaming chunks are processed
    // before sending the completion message
    await new Promise(resolve => setTimeout(resolve, 300));

    // Send a completion message
    if (!res.writableEnded) {
      try {
        res.write(
          `data: ${JSON.stringify({
            type: 'done',
            fullContent: aiResponseContent
          })}\n\n`
        )

        // Force flush to ensure all content is sent
        res.flushHeaders()

        // Send a clean termination signal
        res.write(':\n\n')
      } catch (responseError) {
        logger.error('Error sending completion event', {
          error: responseError as Error,
          chatId
        })
      }
    }

    // Handle client disconnect
    return req.on('close', () => {
      if (!res.writableEnded) {
        // Ensure full stream
        setTimeout(() => {
          res.end()
        }, 50)
      }
    })
  } catch (error) {
    logger.error('Error in streaming chat message endpoint', {
      error: error as Error,
      chatId: req.params.chatId,
      userId: req.user?.userId
    })

    // Send appropriate error message based on the error type
    sendErrorEvent(
      error instanceof Error
        ? error.message
        : 'An error occurred processing your request'
    )

    return
  }
}

router.post('/:chatId/stream', authenticateChatAccess, handleStreamRequest)
router.get('/:chatId/stream', authenticateChatAccess, handleStreamRequest)

export default router
