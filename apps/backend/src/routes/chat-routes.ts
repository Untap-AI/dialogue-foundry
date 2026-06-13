import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { streamText, convertToModelMessages, tool, stepCountIs, generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import {
  getChatById,
  createChatAdmin,
  updateChatUserEmailAdmin
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
import { 
  detectEmailRequest, 
  processUserEmailInMessage,
} from '../services/utils/email-detection'
import { generateChatAccessToken } from '../lib/jwt-utils'
import {
  authenticateChatAccess,
} from '../middleware/auth-middleware'
import { getChatConfigByCompanyId } from '../db/chat-configs'
import { isBotActive } from '../services/utils/chat-availability'
import {
  retrieveDocuments,
  formatDocumentsAsContext
} from '../services/vector-service'

import { logger } from '../lib/logger'
import type { CustomRequest } from '../middleware/auth-middleware'
import type { Message, ChatSettings } from '../services/openai-service'
import { sendInquiryEmail } from '../services/sendgrid-service'

const router = express.Router()

// Public endpoint: report whether the bot is currently within its active hours.
// Used by the widget to decide whether to render at all. Must be declared before
// the `/:chatId` route so it isn't captured as a chat ID.
router.get('/availability', async (req, res) => {
  try {
    const companyId = req.query.companyId

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'Company ID is required' })
    }

    const chatConfig = await getChatConfigByCompanyId(companyId)
    if (!chatConfig) {
      return res.status(404).json({ error: 'Chat config not found' })
    }

    return res.json({ available: isBotActive(chatConfig) })
  } catch (error) {
    logger.error('Error checking chat availability', {
      error: error as Error
    })
    return res.status(500).json({ error: 'Failed to check availability' })
  }
})

/**
 * Enhances a user query with conversation context for better semantic search.
 * Uses conversation history to make follow-up questions more specific and standalone.
 */
async function enhanceQueryWithContext(
  currentQuery: string,
  recentMessages: Array<{ role: string; content: string }>
): Promise<string> {
  // If no conversation history, return the original query
  if (recentMessages.length < 2) {
    return currentQuery
  }

  try {
    // Get last 6 messages for context (3 turns of conversation)
    const contextMessages = recentMessages.slice(-6).map(msg => 
      `${msg.role}: ${msg.content}`
    ).join('\n')

    const prompt = `Given this conversation:

${contextMessages}

The user just said: "${currentQuery}"

Your task: Rewrite this as a concise, standalone search query. Add only the essential context needed from the conversation. Keep it focused and brief - this is for semantic search, not a detailed question.

Example:
- Conversation mentions "West Hills Vineyards" and "pricing plans"
- User says: "What about the enterprise option?"
- Good: "What is the enterprise pricing plan at West Hills Vineyards?"
- Bad: "What are the details, features, pricing, and support options for the enterprise pricing plan at West Hills Vineyards?" (too verbose and adds topics not mentioned)

Return ONLY the rewritten query, nothing else.`

    const { text } = await generateText({
      model: openai('gpt-5.4-mini'),
      prompt,
      temperature: 0,
      providerOptions: {
        openai: {
          reasoningEffort: "low",
        }
      }
    })

    const enhancedQuery = text.trim()
    
    return enhancedQuery || currentQuery
  } catch (error) {
    logger.warn('Error enhancing query with context, using original', {
      error: error as Error,
      query: currentQuery
    })
    return currentQuery
  }
}

// Get a chat by ID with its messages (requires chat-specific authentication)
router.get('/:chatId', authenticateChatAccess, async (req, res) => {
  try {
    const { chatId } = req.params

    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' })
    }

    // Get chat from database
    const chat = await getChatById(chatId)

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' })
    }

    const messages = await getMessagesByChatId(chatId)

    return res.json({
      chat,
      messages
    })
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

    const chatConfig = await getChatConfigByCompanyId(companyId)
    if (!chatConfig) {
      logger.error('Chat config not found', {
        userId: req.body.userId
      })
      return res.status(400).json({ error: 'Chat config not found' })
    }

    const userId = userIdParam === 'undefined' || userIdParam === undefined ? uuidv4() : userIdParam

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

    // Get any messages that were created (like welcome message)
    const messages = await getMessagesByChatId(chat.id)

    return res.status(201).json({
      chat,
      accessToken,
      messages
    })
  } catch (error) {
    logger.error('Error creating chat', {
      error: error as Error,
      userId: req.body.userId
    })
    return res.status(500).json({ error })
  }
})

// Add after other endpoints
router.post('/:chatId/send-email', authenticateChatAccess, async (req, res) => {
  try {
    const { chatId } = req.params
    const { userEmail, subject, conversationSummary, isUnbranded = false } = req.body

    if (!chatId || !userEmail || subject === undefined || conversationSummary === undefined) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Get chat and companyId
    const chat = await getChatById(chatId)

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' })
    }

    const companyId = chat.company_id
    if (!companyId) {
      return res.status(400).json({ error: 'Chat missing company ID' })
    }

    // Get recent messages for context (last 20, excluding system)
    const messages = await getMessagesByChatId(chatId)
    const recentMessages = messages.slice(-20).filter(msg => msg.role !== 'system')

    const emailSent = await sendInquiryEmail({
      userEmail,
      subject,
      conversationSummary,
      recentMessages,
      companyId,
      isUnbranded
    })

    if (emailSent) {
      // Store the user's email in the chat record for future reference
      try {
        await updateChatUserEmailAdmin(chatId, userEmail)
        // Chat updated in database with email
      } catch (emailUpdateError) {
        // Log the error but don't fail the request since the email was sent successfully
        logger.error('Error updating chat with user email', {
          error: emailUpdateError as Error,
          chatId,
          userEmail
        })
      }
      
      return res.json({ success: true })
    } else {
      return res.status(500).json({ error: 'Failed to send email' })
    }
  } catch (error) {
    logger.error('Error sending email from /chats/:chatId/send-email', {
      error: error as Error,
      chatId: req.params.chatId
    })
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// Shared validation and setup logic
async function setupStreamRequest(req: CustomRequest) {
  const { chatId } = req.params
  const { content, timezone = 'UTC' } = req.method === 'POST' ? req.body : req.query
  const userId = req.user?.userId

  if (!chatId || !content || !userId) {
    throw new Error('Chat ID, content, and authentication are required')
  }

  // Get and validate chat
  const chat = await getChatById(chatId)
  if (!chat) throw new Error('Chat not found')

  const companyId = chat.company_id
  if (!companyId) throw new Error('Chat not associated with company')

  // Get config
  const chatConfig = await getChatConfigByCompanyId(companyId)
  if (!chatConfig) throw new Error('Company configuration not found')

  // Chat settings
  const hasUserEmail = Boolean(chat.user_email)
  const chatSettings: ChatSettings = {
    ...DEFAULT_SETTINGS,
    systemPrompt: chatConfig.system_prompt,
    companyId,
    enableEmailFunction: Boolean(chatConfig?.support_email) && !hasUserEmail,
    timezone,
    hasUserEmail
  }

  return { chatId, content, userId, chat, chatConfig, chatSettings }
}

// Shared streaming logic
async function processStream(
  setupData: Awaited<ReturnType<typeof setupStreamRequest>>,
  onChunk: (chunk: string) => void,
  onSpecialEvent?: (event: any) => void
) {
  const { chatId, content, userId, chat, chatConfig, chatSettings } = setupData

  // Get previous messages and save user message
  const previousMessages = await getMessagesByChatId(chatId)
  const latestSequenceNumber = await getLatestSequenceNumber(chatId)
  const nextSequenceNumber = latestSequenceNumber + 1

  await createMessageAdmin({
    chat_id: chatId,
    user_id: userId,
    content,
    role: 'user',
    sequence_number: nextSequenceNumber
  })

  // Prepare OpenAI messages
  const openaiMessages: Message[] = [
    ...previousMessages.map(msg => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content
    })),
    { role: 'user', content }
  ]

  // Add Pinecone context if available
  if (chatConfig?.pinecone_index_name) {
    try {
      // Enhance query with conversation context for better retrieval
      const messagesForContext = previousMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
      const enhancedQuery = await enhanceQueryWithContext(content, messagesForContext)
      const documents = await retrieveDocuments(chatConfig.pinecone_index_name, enhancedQuery)
      if (documents && documents.length > 0) {
        const contextFromDocs = formatDocumentsAsContext(documents)
        openaiMessages.unshift({ role: 'system', content: contextFromDocs })
      }
    } catch (retrievalError) {
      console.error('Error during document retrieval:', retrievalError)
    }
  }

  // Stream from OpenAI
  let fullResponse = ''
  const wrappedOnChunk = (chunk: string) => {
    fullResponse += chunk
    onChunk(chunk)
  }

  await generateStreamingChatCompletion(openaiMessages, chatSettings, wrappedOnChunk)

  // Save assistant message
  await createMessageAdmin({
    chat_id: chatId,
    user_id: userId,
    content: fullResponse || 'Sorry, I was unable to generate a response.',
    role: 'assistant',
    sequence_number: nextSequenceNumber + 1
  })

  // Email detection (send as special event if callback provided)
  let emailDetectionResult = null
  try {
    if (fullResponse) {
      const result = await detectEmailRequest(fullResponse, openaiMessages, chatSettings)
      if (result?.success) {
        emailDetectionResult = result.details
        if (onSpecialEvent) {
          onSpecialEvent(emailDetectionResult)
        }
      }
    }
  } catch (error) {
    logger.warn('Error in email detection', { error: error as Error, chatId })
  }

  // User email processing (async, non-blocking)
  setImmediate(async () => {
    try {
      await processUserEmailInMessage(
        content,
        chatId,
        openaiMessages,
        chatSettings,
        chatConfig?.support_email || '',
        Boolean(chat?.user_email)
      )
    } catch (error) {
      logger.warn('Error in user email processing', { error: error as Error, chatId })
    }
  })

  return { fullResponse, emailDetectionResult }
}



// Fetch streaming endpoint (primary)
router.post('/:chatId/stream-fetch', authenticateChatAccess, async (req: CustomRequest, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')

  const sendEvent = (data: any) => {
    if (!res.writableEnded) res.write(JSON.stringify(data) + '\n')
  }

  try {
    const setupData = await setupStreamRequest(req)
    sendEvent({ type: 'start' })
    
    const { fullResponse } = await processStream(
      setupData, 
      (chunk) => sendEvent({ type: 'chunk', content: chunk }),
      (specialEvent) => sendEvent(specialEvent)
    )
    
    sendEvent({ type: 'done', fullContent: fullResponse })
    res.end()
  } catch (error) {
    logger.error('Error in fetch streaming', { error: error as Error, chatId: req.params.chatId })
    sendEvent({ type: 'error', error: error instanceof Error ? error.message : 'Internal server error' })
    res.end()
  }
})

// SSE streaming endpoint (fallback)
async function handleSSEStream(req: CustomRequest, res: express.Response) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const sendEvent = (data: any) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
      res.flushHeaders()
    }
  }

  try {
    const setupData = await setupStreamRequest(req)
    sendEvent({ type: 'connected' })
    
    const { fullResponse } = await processStream(
      setupData, 
      (chunk) => sendEvent({ type: 'chunk', content: chunk }),
      (specialEvent) => sendEvent(specialEvent)
    )
    
    sendEvent({ type: 'done', fullContent: fullResponse })
    res.write(':\n\n')
    res.end()
  } catch (error) {
    logger.error('Error in SSE streaming', { error: error as Error, chatId: req.params.chatId })
    sendEvent({ type: 'error', error: error instanceof Error ? error.message : 'Internal server error' })
    res.write(':\n\n')
    res.end()
  }
}

router.post('/:chatId/stream', authenticateChatAccess, handleSSEStream)
router.get('/:chatId/stream', authenticateChatAccess, handleSSEStream)

// Define email capture tools for AI SDK
const requestUserEmailTool = tool({
  description: 'Provide an email capture form to the user when you want to follow up with them or send them information. Only use this when you are actively asking for their email.',
  inputSchema: z.object({
    subject: z.string().describe('The subject or reason why the email is being requested (e.g., "follow up", "send information", "contact later")'),
    conversationSummary: z.string().describe('A brief summary of what the user is looking for or needs help with based on the conversation context')
  }),
  execute: async ({ subject, conversationSummary }) => ({
    subject,
    conversationSummary
  })
})

// Add a dedicated endpoint for authenticated chat streaming that works with the AI SDK
// TODO: Reconcile this to the old endpoint once migrated
router.post('/stream-ai-sdk', authenticateChatAccess, async (req: CustomRequest, res) => {

  try {
    const { id: chatId, messages, timezone, activeHours } = req.body;
    const userId = req.user?.userId;

    if (!chatId || !userId) {
      return res.status(400).json({ error: 'Chat ID and authentication are required' });
    }

    // Get chat and configuration
    const chat = await getChatById(chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const companyId = chat.company_id;
    const chatConfig = await getChatConfigByCompanyId(companyId as string);
    if (!chatConfig) {
      return res.status(400).json({ error: 'Company configuration not found' });
    }

    // Reject messages received outside the bot's configured active hours. The
    // embed config (sent in the request) overrides the DB-configured hours.
    const hoursConfig = activeHours
      ? {
          timezone: activeHours.timezone,
          active_start_time: activeHours.startTime,
          active_end_time: activeHours.endTime
        }
      : chatConfig;
    if (!isBotActive(hoursConfig)) {
      return res.status(403).json({ error: 'The chatbot is currently offline' });
    }

    let docsContext = ''
    // Save the user's message to the database asynchronously (non-blocking)
    if (messages) {
      const targetMessage = messages[messages.length - 1];
      if (targetMessage && targetMessage.role === 'user') {
        // Extract content from AI SDK message format
        let content = '';
        if (targetMessage.content) {
          // Standard format with content field
          content = targetMessage.content;
        } else if (targetMessage.parts && targetMessage.parts.length > 0) {
          // AI SDK format with parts array
          content = targetMessage.parts
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text)
            .join('');
        }
        
        if (content) {
          // Save user message asynchronously to avoid blocking the stream
          setImmediate(async () => {
            try {
              const latestSequenceNumber = await getLatestSequenceNumber(chatId);
              await createMessageAdmin({
                chat_id: chatId,
                user_id: userId,
                content: content,
                role: 'user',
                sequence_number: latestSequenceNumber + 1
              });
            } catch (error) {
              logger.error('Error saving user message to database', { 
                error: error as Error, 
                chatId, 
                userId 
              });
            }
          });

          // Retrieve documents with enhanced query using conversation context
          if (chatConfig?.pinecone_index_name) {
            try {
              // Get recent messages for context enhancement
              const previousMessages = await getMessagesByChatId(chatId);
              const messagesForContext = previousMessages.map(msg => ({
                role: msg.role,
                content: msg.content
              }))
              const enhancedQuery = await enhanceQueryWithContext(content, messagesForContext)
              const documents = await retrieveDocuments(chatConfig.pinecone_index_name, enhancedQuery)
              if (documents && documents.length > 0) {
                docsContext = formatDocumentsAsContext(documents)
              }
            } catch (retrievalError) {
              console.error('Error during document retrieval:', retrievalError)
            }
          }
        }
      }
    }

    // Determine if email function should be enabled (moved earlier for scope)
    const shouldEnableEmailTool = Boolean(chatConfig?.support_email) && !Boolean(chat?.user_email)

    const emailStatusInfo = Boolean(chat?.user_email) 
      ? '\n\nIMPORTANT: The user has already provided their email address for this conversation. Do not ask for their email again or suggest providing contact information.'
      : ''

    const emailToolInstructions = shouldEnableEmailTool 
      ? '\n\nIMPORTANT: When you want to follow up with the user via email (such as sending them information, scheduling, pricing details, or further assistance), you must use the request_user_email tool to provide an email capture form. Always call this tool when you want to collect the user\'s email address.'
      : ''

    const systemPrompt= `Respond using Markdown formatting for headings, lists, and emphasis for all answers.\n\n${chatConfig.system_prompt}${emailStatusInfo}${emailToolInstructions}\n\nThe current date and time is ${new Date().toLocaleString(
      'en-US',
      {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        timeZone: timezone || 'UTC'
      }
    )}.`

    const modelMessages = convertToModelMessages(messages)
    
    // Only add docs context if we actually have content
    if (docsContext && docsContext.trim()) {
      modelMessages.unshift({ role: 'system', content: docsContext })
    }

    const result = streamText({
      model: openai('gpt-5.5'),
      system: systemPrompt,
      messages: modelMessages,
      tools: shouldEnableEmailTool ? {
        request_user_email: requestUserEmailTool
      } : undefined,
      toolChoice: shouldEnableEmailTool ? 'auto' : undefined,
      stopWhen: shouldEnableEmailTool ? stepCountIs(2) : undefined, // Allow up to 2 steps: text response -> tool call
      prepareStep: async ({ steps }) => {
        // Check if email tool has already been called in any previous step
        const emailToolAlreadyCalled = steps.some(step => 
          step.content?.some((content) => content.type === 'tool-call' && content.toolName === 'request_user_email')
        )
        
        // If email tool already called, disable tools for remaining steps
        if (emailToolAlreadyCalled) {
          return {
            tools: {},
            toolChoice: 'none'
          }
        }
        
        // Keep tools available and let LLM decide
        return {
          tools: shouldEnableEmailTool ? { request_user_email: requestUserEmailTool } : {},
          toolChoice: shouldEnableEmailTool ? 'auto' : 'none'
        }
      },
      providerOptions: {
        openai: {
          reasoningEffort: "low",
          textVerbosity: "low",
          serviceTier: "priority"
        }
      },
      onError: (error) => {
        console.error('Error in AI SDK streaming:', error);
      },
      onFinish: async ({ text,}) => {
        // Save the final assistant's response to the database
        if (text) {
          const latestSequenceNumber = await getLatestSequenceNumber(chatId);
          await createMessageAdmin({
            chat_id: chatId,
            user_id: userId,
            content: text,
            role: 'assistant',
            sequence_number: latestSequenceNumber + 1
          });
        }
      }
    });
    
    return result.pipeUIMessageStreamToResponse(res);
  } catch (error) {
    console.error('Error in authenticated AI SDK streaming', { error: error as Error, chatId: req.params.chatId });
    logger.error('Error in authenticated AI SDK streaming', { error: error as Error, chatId: req.params.chatId });
    return res.status(500).json({ error: 'Internal server error' });
  }
});



export default router
