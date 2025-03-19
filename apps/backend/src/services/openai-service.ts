import OpenAI from 'openai'
import dotenv from 'dotenv'
import { OpenAIStream, StreamingTextResponse } from 'ai'

dotenv.config()

const apiKey = process.env.OPENAI_API_KEY

if (!apiKey) {
  throw new Error('OPENAI_API_KEY is not set in environment variables')
}

const openai = new OpenAI({
  apiKey
})

export type Message = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatSettings = {
  model: string
  temperature: number
}

// Default settings to use if none are provided
export const DEFAULT_SETTINGS: ChatSettings = {
  // TODO: Assess model performance
  model: 'gpt-4o',
  temperature: 0.7
}

export const generateChatCompletion = async (
  messages: Message[],
  settings: ChatSettings = DEFAULT_SETTINGS
) => {
  try {
    // Extract system message if present
    const systemMessage = messages.find(msg => msg.role === 'system');
    const otherMessages = messages.filter(msg => msg.role !== 'system');
    
    // Format the input for responses API
    const input = otherMessages.map(msg => msg.content).join('\n\n');
    
    const response = await openai.responses.create({
      model: settings.model,
      input: input,
      temperature: settings.temperature,
      instructions: systemMessage?.content || null,
      stream: false,
      text: {
        format: {
          type: "text"
        }
      }
    });

    // Extract the text content from the response
    const outputMessage = response.output.find(item => 
      item.type === 'message' && item.role === 'assistant'
    );
    
    if (outputMessage && 'content' in outputMessage) {
      const textContent = outputMessage.content.find(
        item => item.type === 'output_text'
      );
      
      if (textContent && 'text' in textContent) {
        return textContent.text;
      }
    }
    
    throw new Error('No valid response content found');
  } catch (error: any) {
    console.error('Error generating chat completion:', error.message)
    throw new Error(`Failed to generate response: ${error.message}`)
  }
}

export const generateStreamingChatCompletion = async (
  messages: Message[],
  settings: ChatSettings = DEFAULT_SETTINGS
) => {
  try {
    // Extract system message if present
    const systemMessage = messages.find(msg => msg.role === 'system');
    const otherMessages = messages.filter(msg => msg.role !== 'system');
    
    // Format the input for responses API
    const input = otherMessages.map(msg => msg.content).join('\n\n');
    
    const response = await openai.responses.create({
      model: settings.model,
      input: input,
      temperature: settings.temperature,
      instructions: systemMessage?.content || null,
      stream: true,
      text: {
        format: {
          type: "text"
        }
      }
    });

    // Create a stream from the response
    const stream = OpenAIStream(response as any);
    
    return new StreamingTextResponse(stream);
  } catch (error: any) {
    console.error('Error generating streaming chat completion:', error.message)
    throw new Error(`Failed to generate streaming response: ${error.message}`)
  }
} 