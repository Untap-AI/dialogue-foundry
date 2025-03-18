import OpenAI from 'openai'
import dotenv from 'dotenv'

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
  model: 'gpt-3.5-turbo',
  temperature: 0.7
}

export const generateChatCompletion = async (
  messages: Message[],
  settings: ChatSettings = DEFAULT_SETTINGS
) => {
  try {
    const response = await openai.chat.completions.create({
      model: settings.model,
      messages,
      temperature: settings.temperature,
      stream: false
    })

    return response.choices[0].message.content
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
    const stream = await openai.chat.completions.create({
      model: settings.model,
      messages,
      temperature: settings.temperature,
      stream: true
    })

    return stream
  } catch (error: any) {
    console.error('Error generating streaming chat completion:', error.message)
    throw new Error(`Failed to generate streaming response: ${error.message}`)
  }
} 