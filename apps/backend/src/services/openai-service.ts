import OpenAI from 'openai'
import dotenv from 'dotenv'
import { MAX_MESSAGES_PER_CHAT } from '../db/messages'
import type {
  ResponseCreateParams
} from 'openai/resources/responses/responses.mjs'

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
  systemPrompt: string
  companyId: string
  enableEmailFunction?: boolean
  timezone?: string
  hasUserEmail?: boolean
}

// Default settings to use if none are provided
export const DEFAULT_SETTINGS: Pick<ChatSettings, 'model' | 'temperature'> = {
  model: 'gpt-5',
  temperature: 0.5
}

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

/**
 * Main streaming chat completion function - focuses purely on content generation
 * without any tool calls
 */
export const generateStreamingChatCompletion = async (
  messages: Message[],
  settings: ChatSettings,
  onChunk: (chunk: string) => void
): Promise<string> => {
  try {
    // Limit the number of messages to avoid exceeding token limits
    const limitedMessages = limitMessagesContext(
      messages,
      MAX_MESSAGES_PER_CHAT
    )

    // Add email status information to system prompt if applicable
    const emailStatusInfo = settings.hasUserEmail 
      ? '\n\nIMPORTANT: The user has already provided their email address for this conversation. Do not ask for their email again or suggest providing contact information.'
      : ''

    const systemPromptWithCurrentDate = `Respond using Markdown formatting for headings, lists, and emphasis for all answers.\n\n${settings.systemPrompt}${emailStatusInfo}\n\nThe current date and time is ${new Date().toLocaleString(
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
    )}.`

    const requestOptions = {
      model: settings.model,
      input: limitedMessages,
      verbosity: "low",
      temperature: settings.temperature,
      instructions: systemPromptWithCurrentDate,
      stream: true,
      text: {
        format: {
          type: 'text'
        }
      }
      // Note: No tools are included here - this LLM focuses purely on content generation
    } as const satisfies ResponseCreateParams

    // Create the response with streaming enabled
    const response = await openai.responses.create(requestOptions)

    let fullText = ''

    try {
      for await (const chunk of response) {
        let text = ''

        if (chunk.type === 'response.output_text.delta') {
          text = 'delta' in chunk ? chunk.delta : ''
        }

        if (text.length > 0) {
          fullText += text
          onChunk(text)
        }
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


