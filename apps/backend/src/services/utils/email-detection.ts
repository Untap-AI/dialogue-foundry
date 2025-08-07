import OpenAI from 'openai'
import dotenv from 'dotenv'
import { randomUUID } from 'crypto'
import type {
  ResponseCreateParams,
  ResponseFunctionToolCall
} from 'openai/resources/responses/responses.mjs'
import type { Message, ChatSettings } from '../openai-service'
import { sendInquiryEmail } from '../sendgrid-service'
import { updateChatUserEmailAdmin } from '../../db/chats'
import { getMessagesByChatId } from '../../db/messages'
import { logger } from '../../lib/logger'

dotenv.config()

const apiKey = process.env.OPENAI_API_KEY

if (!apiKey) {
  throw new Error('OPENAI_API_KEY is not set in environment variables')
}

const openai = new OpenAI({
  apiKey
})

// Email detection model settings
const EMAIL_DETECTION_MODEL = 'gpt-5-mini'
const EMAIL_DETECTION_TEMPERATURE = 0.3

// Tool definition for the email detection LLM
const requestUserEmailTool = {
  type: 'function',
  name: 'request_user_email',
  description:
    'Request the user\'s email address when the assistant is asking for it.',
  parameters: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'The subject or reason why the email is being requested (e.g., "follow up", "send information", "contact later").'
      },
      conversationSummary: {
        type: 'string',
        description: 'A brief summary of what the user is looking for or needs help with based on the conversation context.'
      }
    },
    required: ['conversationSummary', 'subject'],
    additionalProperties: false
  },
  strict: true
} as const satisfies NonNullable<ResponseCreateParams['tools']>[number]

// Tool definition for generating email summary when user provides email directly
const generateEmailSummaryTool = {
  type: 'function',
  name: 'generate_email_summary',
  description: 'Generate a subject line and conversation summary for an email inquiry when a user has provided their email address.',
  parameters: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'A concise subject line for the email inquiry (under 50 characters) that describes what the user needs help with.'
      },
      conversationSummary: {
        type: 'string',
        description: 'A brief summary of what the user is looking for or needs assistance with based on the conversation (under 200 characters).'
      }
    },
    required: ['subject', 'conversationSummary'],
    additionalProperties: false
  },
  strict: true
} as const satisfies NonNullable<ResponseCreateParams['tools']>[number]

/**
 * Detects if a user message contains an email address
 */
export const detectUserEmailInMessage = (message: string): string | null => {
  // More comprehensive email regex that handles various formats
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
  const matches = message.match(emailRegex)
  
  if (matches && matches.length > 0) {
    // Return the first email found
    return matches[0]
  }
  
  return null
}

/**
 * Function to handle email function calls from the email detection LLM
 */
const handleEmailDetectionFunctionCall = async (
  functionCall: ResponseFunctionToolCall
): Promise<{ success: boolean; details?: any }> => {
  if (functionCall.name === 'request_user_email' && functionCall.arguments) {
    // Emit the special event to trigger email input UI
    const args = JSON.parse(functionCall.arguments)

      return {
        success: true,
        details: {
          type: 'request_email',
          details: args,
          id: randomUUID()
        }
      }
  }

  return {
    success: false,
    details: { error: 'UNKNOWN_FUNCTION_CALL' }
  }
}

/**
 * Email detection function using a specialized LLM
 * Analyzes the assistant's response to determine if it asked for user email
 */
export const detectEmailRequest = async (
  assistantResponse: string,
  conversationHistory: Message[],
  settings: ChatSettings,
) => {
  // Only proceed if email function is enabled
  if (!settings.enableEmailFunction) {
    return
  }

  // Expanded early return condition to catch more email-related patterns
  const emailPatterns = [
    'email',
    'contact',
    'follow up',
    'follow-up', 
    'reach out',
    'get in touch',
    'send you',
    'share with you',
    'provide you with',
  ]
  
  const responseText = assistantResponse.toLowerCase()
  const hasEmailIndicator = emailPatterns.some(pattern => responseText.includes(pattern))
  
  if (!hasEmailIndicator) {
    return
  }

  try {
    // Create a focused prompt for email detection with clear examples
    const systemPrompt = `You are an expert at detecting when an AI assistant asks for a user's email address.
Your primary task is to analyze the latest "ASSISTANT RESPONSE" and determine if it contains a request for the user's email.

- If the "ASSISTANT RESPONSE" is asking for an email, you MUST call the \`request_user_email\` function.
- When you call the function, use the "CONVERSATION HISTORY" to generate a concise subject and a summary of the user's needs.
- If the "ASSISTANT RESPONSE" does NOT ask for an email, do NOT call any function.

Do NOT call the function if:
- Email is mentioned in a generic context without a request to the user.`

    const conversationHistoryString = conversationHistory.slice(-5).map(msg => `${msg.role}: ${msg.content}`).join('\n')

    const requestOptions = {
      model: EMAIL_DETECTION_MODEL,
      input: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `CONVERSATION HISTORY:\n${conversationHistoryString}\n\nASSISTANT RESPONSE:\n"${assistantResponse}"`
        }
      ],
      temperature: 0,
      tools: [requestUserEmailTool]
    } as const satisfies ResponseCreateParams

    // Create the response with streaming enabled for function call detection
    const requestOptionsWithStream = {
      ...requestOptions,
      stream: true
    } as const satisfies ResponseCreateParams

    const response = await openai.responses.create(requestOptionsWithStream)

    // Process the response to look for function calls
    for await (const chunk of response) {
      if (
        chunk.type === 'response.output_item.done' &&
        chunk.item.type === 'function_call'
      ) {
        return handleEmailDetectionFunctionCall(chunk.item)
      }
    }
  } catch (error) {
    console.error('Error in email detection:', error)
    // Don't throw - email detection failure shouldn't break the main flow
  }
}

/**
 * Generates a conversation summary and subject when user provides email directly using structured output
 */
const generateEmailSummaryForUserEmail = async (
  userMessage: string,
  conversationHistory: Message[],
  settings: ChatSettings
): Promise<{ subject: string; conversationSummary: string } | null> => {
  try {
    const prompt = `A user has provided their email address in the following message: "${userMessage}"

Based on this message and the conversation history, you need to generate a subject line and conversation summary for an email inquiry.

Conversation history:
${conversationHistory.slice(-10).map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Call the generate_email_summary function with:
1. A subject line that is concise and describes what the user needs help with (under 50 characters)
2. A conversation summary that explains what the user is looking for or needs assistance with (under 200 characters)`

    console.log('EMAIL SUMMARY GENERATION: Starting', {
      userMessage: userMessage.substring(0, 100) + '...',
      companyId: settings.companyId
    })

    const requestOptions = {
      model: EMAIL_DETECTION_MODEL,
      input: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: EMAIL_DETECTION_TEMPERATURE,
      tools: [generateEmailSummaryTool]
    } as const satisfies ResponseCreateParams

    // Create the response with streaming enabled for function call detection
    const requestOptionsWithStream = {
      ...requestOptions,
      stream: true
    } as const satisfies ResponseCreateParams

    const response = await openai.responses.create(requestOptionsWithStream)

    // Process the response to look for function calls
    for await (const chunk of response) {
      if (
        chunk.type === 'response.output_item.done' &&
        chunk.item.type === 'function_call' &&
        chunk.item.name === 'generate_email_summary'
      ) {
        try {
          const args = JSON.parse(chunk.item.arguments)
          if (args.subject && args.conversationSummary) {
            console.log('EMAIL SUMMARY GENERATION: Success', {
              subject: args.subject,
              conversationSummary: args.conversationSummary.substring(0, 100) + '...',
              companyId: settings.companyId
            })
            return {
              subject: args.subject,
              conversationSummary: args.conversationSummary
            }
          }
        } catch (parseError) {
          console.error('Error parsing email summary function arguments:', parseError)
        }
      }
    }

    return null
  } catch (error) {
    console.error('Error generating email summary:', error)
    return null
  }
}

/**
 * Process user email found in message - handles the complete workflow
 */
export const processUserEmailInMessage = async (
  userMessage: string,
  chatId: string,
  conversationHistory: Message[],
  settings: ChatSettings,
  supportEmail: string,
  hasExistingEmail: boolean
): Promise<void> => {
  try {
    // Check if we should process the email
    const userEmail = detectUserEmailInMessage(userMessage)
    if (!userEmail || !supportEmail || hasExistingEmail) {
      return
    }

    logger.info('Processing user email found in message', {
      chatId,
      email: userEmail.substring(0, 3) + '***' // Log partial email for privacy
    })

    // Generate conversation summary and subject using LLM with structured output
    const emailSummary = await generateEmailSummaryForUserEmail(
      userMessage,
      conversationHistory,
      settings
    )

    if (!emailSummary) {
      logger.warn('Failed to generate email summary for user-provided email', {
        chatId
      })
      return
    }

    // Get recent messages for context (last 20, excluding system)
    const messages = await getMessagesByChatId(chatId)
    const recentMessages = messages.slice(-20).filter(msg => msg.role !== 'system')

    // Send the email using existing service
    const emailSent = await sendInquiryEmail({
      userEmail,
      subject: emailSummary.subject,
      conversationSummary: emailSummary.conversationSummary,
      recentMessages,
      companyId: settings.companyId
    })

    if (emailSent) {
      // Update chat record with user's email
      try {
        const updatedChat = await updateChatUserEmailAdmin(chatId, userEmail)
        if (updatedChat) {
          logger.info('Successfully processed user email from message', {
            chatId,
            subject: emailSummary.subject
          })
        }
      } catch (emailUpdateError) {
        logger.error('Error updating chat with user email (non-critical)', {
          error: emailUpdateError as Error,
          chatId
        })
      }
    } else {
      logger.warn('Failed to send email for user-provided email', {
        chatId,
        subject: emailSummary.subject
      })
    }
  } catch (error) {
    logger.error('Error in processUserEmailInMessage (non-critical)', {
      error: error as Error,
      chatId,
      userMessage: userMessage.substring(0, 50) + '...'
    })
  }
} 