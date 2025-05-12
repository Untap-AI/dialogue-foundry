import OpenAI from 'openai'
import dotenv from 'dotenv'
import { MAX_MESSAGES_PER_CHAT } from '../db/messages'
import { sendInquiryEmail } from './sendgrid-service'
// Import necessary types for chat completions
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionChunk,
  ChatCompletionMessageToolCall // Used for reconstructed tool calls
} from 'openai/resources/chat/completions.mjs'
// Remove unused types from 'responses' API if applicable
// import type {
//   ResponseCreateParams, // No longer used
//   ResponseFunctionToolCall // Replaced by ChatCompletionMessageToolCall structure
// } from 'openai/resources/responses/responses.mjs';
import type { EmailData } from './sendgrid-service'
import { response } from 'express'
import console from 'console'

dotenv.config()

const geminiApiKey = process.env.GEMINI_API_KEY
const geminiApiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/'

if (!geminiApiKey) {
  throw new Error('GEMINI_API_KEY is not set in environment variables')
}

if (!geminiApiBaseUrl) {
  throw new Error('GEMINI_API_BASE_URL is not set in environment variables. This should be your OpenAI-compatible Gemini endpoint.')
}

const openai = new OpenAI({
  apiKey: geminiApiKey,
  baseURL: geminiApiBaseUrl
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
  model: 'gemini-2.5-flash-preview-04-17',
  temperature: 0.5
}

// Define the email tool for OpenAI function calling - structure is compatible
const emailTool = {
  type: 'function',
  function: { // Note: Changed structure to match ChatCompletionTool
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
    }
    // strict: true // 'strict' is not part of ChatCompletionTool.function
  }
} as const satisfies ChatCompletionTool // Updated type assertion

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
// Update signature to accept function details directly
const handleFunctionCall = async (
  functionCall: { name: string; arguments: string }, // Simplified signature
  messages: Message[], // Keep original messages for context if needed
  companyId: string
): Promise<{ success: boolean; details?: any }> => {
  if (functionCall.name === 'send_email') {
    try {
      // Parse arguments with validation
      // Arguments are already a string, parse directly
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

  // Handle other potential function calls here if needed

  console.warn(`Unhandled function call: ${functionCall.name}`)
  return {
    success: false,
    details: { error: 'UNKNOWN_FUNCTION_CALL', functionName: functionCall.name }
  }
}

// Helper function to generate a follow-up response after a function call
const generateFollowUpResponse = (
  functionName: string, // Keep this signature
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
        ? `

Thank you! Your email has been sent. Someone from the team will get back to you soon. Is there anything else I can help you with in the meantime?`
        : `

I wasn't able to send your email at this time. You can reach out to the vineyard directly. Is there something else I can help you with today?`
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
): Promise<string> => { // Ensure return type reflects full accumulated text
  try {
    const limitedMessages = limitMessagesContext(
      messages,
      MAX_MESSAGES_PER_CHAT
    )

    const systemPromptWithCurrentDate = `Respond using Markdown formatting for headings, lists, and emphasis for all answers.

${settings.systemPrompt}

The current date and time is ${new Date().toLocaleString(
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
    )}

    Respond using Markdown formatting for headings, lists, and emphasis for all answers.
    `

    // Prepare messages for chat completions API
    const chatMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPromptWithCurrentDate },
      // Map existing messages, ensuring correct roles
      ...limitedMessages.map(msg => ({
        role: msg.role as 'user' | 'assistant', // Cast assuming only user/assistant after system
        content: msg.content
      }))
      // Note: Tool calls/results from previous turns should ideally be included here
      // if the conversation involves multiple tool interactions. We are omitting this
      // complexity for now based on the current structure.
    ];


    // Configure request options for chat.completions
    const requestOptions: ChatCompletionCreateParamsStreaming = {
      model: settings.model,
      messages: chatMessages, // Use 'messages' instead of 'input'/'instructions'
      temperature: settings.temperature,
      stream: true,
      // Add tools if enabled
      ...(settings.enableEmailFunction ? { tools: [emailTool] } : {})
      // 'text.format' is not used in chat completions
    }

    // Create the chat completion with streaming enabled
    const response = await openai.chat.completions.create(requestOptions);

    let fullText = ''
    // Store tool call chunks by index to reconstruct arguments
    const toolCallChunks: Record<
      number,
      { id?: string; name?: string; arguments?: string }
    > = {};

    try {
      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta;

        if (!delta) continue; // Skip empty deltas

        // Append text content if present
        if (delta.content) {
          fullText += delta.content;
          onChunk(delta.content);
        }

        // Accumulate tool call information if present
        if (delta.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index;
            if (typeof index !== 'number') continue; // Ensure index is valid

            if (!toolCallChunks[index]) {
              toolCallChunks[index] = { arguments: '' }; // Initialize with empty arguments
            }

            // Store ID and Name if present in the delta
            if (toolCallDelta.id) {
              toolCallChunks[index].id = toolCallDelta.id;
            }
            if (toolCallDelta.function?.name) {
              toolCallChunks[index].name = toolCallDelta.function.name;
            }
            // Append argument chunks
            if (toolCallDelta.function?.arguments) {
              toolCallChunks[index].arguments += toolCallDelta.function.arguments;
            }
          }
        }
      } // End of stream processing loop

      // Reconstruct and process complete tool calls after streaming
      const finalToolCalls: ChatCompletionMessageToolCall[] = Object.values(
        toolCallChunks
      )
        // First, filter out chunks that don't have all required fields
        .filter(
          (tc): tc is { id: string; name: string; arguments: string } =>
            tc.id != null && tc.name != null && tc.arguments != null
        )
        // Then, map the filtered chunks to the correct type structure
        .map((tc) => ({
          id: tc.id, // id is now guaranteed to be string
          type: 'function' as const,
          function: {
            name: tc.name, // name is now guaranteed to be string
            arguments: tc.arguments // arguments is now guaranteed to be string
          }
        }));

      // Process function calls if any were fully reconstructed
      if (finalToolCalls.length > 0) {
        // Note: This processes calls sequentially. Use Promise.all for parallel.
        for (const toolCall of finalToolCalls) {
           // Pass only the necessary function details to handleFunctionCall
          const result = await handleFunctionCall(
            toolCall.function, // Pass the { name, arguments } object
            messages, // Pass original messages for context
            settings.companyId
          );

          // Generate and stream the follow-up response (current static approach)
          // Ideally, we would add a 'tool' role message with the result
          // and potentially make *another* LLM call for a final summary.
          generateFollowUpResponse(
            toolCall.function.name,
            result,
            onChunk,
            (text) => {
              fullText += text; // Append follow-up response to full text
            }
          );
        }
      }

      return fullText; // Return the accumulated text (including follow-up)

    } catch (streamError) {
      console.error('Error during stream processing:', streamError);
      // Consider sending an error message chunk to the client if possible
      onChunk('\n\n[Error processing response stream]');
      throw streamError; // Re-throw after logging/notifying
    }
  } catch (error) {
    console.error('Error generating streaming chat completion:', error);
    // Consider sending an error message chunk to the client
    onChunk('\n\n[Error generating response]');
    // Ensure a specific error type/message is thrown
    throw new Error(`Failed to generate streaming response: ${error instanceof Error ? error.message : String(error)}`);
  }
}
