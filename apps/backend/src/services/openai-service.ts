import OpenAI from 'openai'
import dotenv from 'dotenv'
import { MAX_MESSAGES_PER_CHAT } from '../db/messages'
import { sendInquiryEmail } from './sendgrid-service'
import type {
  ResponseCreateParams,
  ResponseFunctionToolCall
} from 'openai/resources/responses/responses.mjs'
import type { EmailData } from './sendgrid-service'

dotenv.config()

const apiKey = process.env.OPENAI_API_KEY

if (!apiKey) {
  throw new Error('OPENAI_API_KEY is not set in environment variables')
}

const openai = new OpenAI({
  apiKey
})

// TODO: Is there a utility type somewhere that we can use for this?
export type Message = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatSettings = {
  model: string
  temperature: number
  systemPrompt: string // Add systemPrompt as an optional parameter
  companyId: string // Company ID for context in function calls
  enableEmailFunction?: boolean // Whether to enable the email function
  timezone?: string // User's timezone
}

// Default settings to use if none are provided
export const DEFAULT_SETTINGS: Pick<ChatSettings, 'model' | 'temperature'> = {
  model: 'gpt-4.1',
  temperature: 0.5
}

// Define the email tool for OpenAI function calling
const emailTool = {
  type: 'function',
  name: 'send_email',
  description:
    'Send an email to the company with user contact information and conversation details. This should only be used if the user has explicitly consented to sending an email and provided their email address.',
  parameters: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'The subject of the email'
      },
      userEmail: {
        type: 'string',
        description: 'The email address of the user to contact them'
      },
      conversationSummary: {
        type: 'string',
        description:
          'A brief summary of what the user is looking for or needs help with'
      }
    },
    required: ['userEmail', 'conversationSummary', 'subject'],
    additionalProperties: false
  },
  strict: true
} as const satisfies NonNullable<ResponseCreateParams['tools']>[number]

/**
 * Limits the conversation context to the specified maximum number of messages
 * while preserving the most recent conversation history
 */
const limitMessagesContext = (
  messages: Message[],
  maxMessages: number
): Message[] => {
  if (messages.length <= maxMessages) {
    return messages
  }

  // Extract any system messages
  const systemMessages = messages.filter(msg => msg.role === 'system')

  // Get the most recent non-system messages
  const nonSystemMessages = messages
    .filter(msg => msg.role !== 'system')
    .slice(-maxMessages + systemMessages.length)

  // Return system messages first, followed by the most recent non-system messages
  return [...systemMessages, ...nonSystemMessages]
}

// Function to handle email function calls from OpenAI
const handleFunctionCall = async (
  functionCall: ResponseFunctionToolCall,
  messages: Message[],
  companyId: string
  // TODO: Remove usage of any
): Promise<{ success: boolean; details?: any }> => {
  if (functionCall.name === 'send_email') {
    try {
      // Parse arguments with validation
      if (!functionCall.arguments) {
        console.error('Function arguments are empty')
        return {
          success: false,
          // TODO: Make error codes type safe
          details: { error: 'MISSING_ARGUMENTS' }
        }
      }

      const args = JSON.parse(functionCall.arguments)

      // Validate required fields
      if (!args.userEmail) {
        console.error('User email is required to send an email')
        return {
          success: false,
          details: { error: 'MISSING_EMAIL' }
        }
      }

      if (!args.conversationSummary) {
        console.error('Conversation summary is required to send an email')
        return {
          success: false,
          details: { error: 'MISSING_SUMMARY' }
        }
      }

      // Get recent messages for context (limited to last 20 messages)
      const recentMessages = messages
        .slice(-20)
        .filter(msg => msg.role !== 'system')

      // Prepare email data
      const emailData: EmailData = {
        userEmail: args.userEmail,
        subject: args.subject,
        conversationSummary: args.subject
          ? `${args.subject}: ${args.conversationSummary}`
          : args.conversationSummary,
        recentMessages,
        companyId: companyId || 'default'
      }

      // Send the email
      const emailSent = await sendInquiryEmail(emailData)

      if (emailSent) {
        return {
          success: true,
          details: { userEmail: args.userEmail }
        }
      } else {
        console.error('Failed to send email via SendGrid')
        return {
          success: false,
          details: { error: 'EMAIL_SERVICE_FAILURE' }
        }
      }
    } catch (error) {
      console.error('Error processing email function call:', error)
      return {
        success: false,
        details: { error: 'PROCESSING_ERROR' }
      }
    }
  }

  return {
    success: false,
    details: { error: 'NO_FUNCTION_CALLS' }
  }
}

// Helper function to generate a follow-up response after a function call
const generateFollowUpResponse = (
  functionName: string,
  functionCallResult: { success: boolean; details?: any },
  onChunk: (chunk: string) => void,
  updateFullText: (text: string) => void
): void => {
  // Create a simple follow-up response based on the function call result
  let responseText = ''

  // Handle different function types - currently we only have email, but this makes it extensible
  switch (functionName) {
    case 'send_email':
      // TODO: Make this dynamic with separate requests to the LLM
      responseText = functionCallResult.success
        ? `\n\nThank you! Your email has been sent. Someone from the team will get back to you soon. Is there anything else I can help you with in the meantime?`
        : `\n\nI wasn't able to send your email at this time. You can reach out to the vineyard directly. Is there something else I can help you with today?`
  }

  // Stream the response back to the client by sending it in small chunks
  const chunkSize = 10 // Characters per chunk
  let startIndex = 0

  // Function to stream text in chunks with a delay
  const streamTextChunks = () => {
    while (startIndex < responseText.length) {
      const endIndex = Math.min(startIndex + chunkSize, responseText.length)
      const chunk = responseText.substring(startIndex, endIndex)

      // Send this chunk to the client
      onChunk(chunk)

      // Move to the next chunk
      startIndex = endIndex
    }
  }

  // Start streaming the text chunks
  streamTextChunks()

  // Add the full response text to the tracking variable
  updateFullText(responseText)
}

export const generateStreamingChatCompletion = async (
  messages: Message[],
  settings: ChatSettings,
  onChunk: (chunk: string) => void
) => {
  // TODO: Implement token checking and context cutoff
  try {
    // Limit the number of messages to avoid exceeding token limits
    const limitedMessages = limitMessagesContext(
      messages,
      MAX_MESSAGES_PER_CHAT
    )

    const systemPromptWithCurrentDate = `Respond using Markdown formatting for headings, lists, and emphasis for all answers.
    
    ${settings.systemPrompt}\n\nThe current date and time is ${new Date().toLocaleString(
      'en-US',
      {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        timeZone: settings.timezone || 'UTC'
      }
    )}.
    
    Respond using Markdown formatting for headings, lists, and emphasis for all answers.
    `

    // Configure request options with tools if email function is enabled
    const requestOptions = {
      model: settings.model,
      input: limitedMessages,
      temperature: settings.temperature,
      instructions: systemPromptWithCurrentDate,
      stream: true,
      text: {
        format: {
          type: 'text'
        }
      },
      ...(settings.enableEmailFunction ? { tools: [emailTool] } : {})
    } as const satisfies ResponseCreateParams

    // Create the response with streaming enabled
    const response = await openai.responses.create(requestOptions)

    let fullText = ''
    const functionCalls: ResponseFunctionToolCall[] = []

    try {
      for await (const chunk of response) {
        let text = ''

        // Use our type guard function instead of checking the type directly
        if (chunk.type === 'response.output_text.delta') {
          text = 'delta' in chunk ? chunk.delta : ''
        }

        // Check if this chunk contains function calls
        if (
          chunk.type === 'response.output_item.done' &&
          chunk.item.type === 'function_call'
        ) {
          functionCalls.push(chunk.item)
          // We'll handle function calls after streaming completes
        }

        if (text.length > 0) {
          // Add to full text and send immediately
          fullText += text
          onChunk(text)
        }
      }

      // Process function calls after streaming completes if detected
      if (functionCalls.length > 0) {
        await Promise.all(
          functionCalls.map(async functionCall => {
            // Process the function call
            const result = await handleFunctionCall(
              functionCall,
              messages,
              settings.companyId
            )

            // Generate and stream a simple follow-up response
            generateFollowUpResponse(
              functionCall.name,
              result,
              onChunk,
              text => {
                fullText += text
              }
            )
          })
        )
      }

      return fullText
    } catch (streamError) {
      console.error('Error during stream processing:', streamError)
      throw streamError
    }
  } catch (error) {
    console.error('Error generating streaming chat completion:', error)
    throw new Error(`Failed to generate streaming response: ${error}`)
  }
}
