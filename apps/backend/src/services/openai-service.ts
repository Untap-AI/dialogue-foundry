import OpenAI from 'openai'
import dotenv from 'dotenv'
import { OpenAIStream, StreamingTextResponse } from 'ai'
import { ResponseStreamEvent } from 'openai/resources/responses/responses'
import { text } from 'express'

dotenv.config()

const apiKey = process.env.OPENAI_API_KEY

if (!apiKey) {
  throw new Error('OPENAI_API_KEY is not set in environment variables')
}

const openai = new OpenAI({
  apiKey
})

// Define types for the various chunk formats we might receive
interface OpenAIResponseChunkBase {
  type: string;
  item_id?: string;
  output_index?: number;
  content_index?: number;
}

// Events for stream initialization and progress
interface OpenAIResponseCreatedChunk extends OpenAIResponseChunkBase {
  type: 'response.created';
  response: {
    id: string;
    status: string;
    // other fields...
  };
}

interface OpenAIResponseInProgressChunk extends OpenAIResponseChunkBase {
  type: 'response.in_progress';
  response: {
    id: string;
    status: string;
    // other fields...
  };
}

// Events related to output text content
interface OpenAIResponseDeltaChunk extends OpenAIResponseChunkBase {
  type: 'response.output_text.delta';
  delta: string;
}

interface OpenAIResponseDoneChunk extends OpenAIResponseChunkBase {
  type: 'response.output_text.done';
  text: string;
}

// Events related to message structure
interface OpenAIResponseOutputItemAddedChunk extends OpenAIResponseChunkBase {
  type: 'response.output_item.added';
  output_index: number;
  item: {
    type: string;
    id: string;
    status: string;
    role: string;
    content: any[];
  };
}

interface OpenAIResponseContentPartAddedChunk extends OpenAIResponseChunkBase {
  type: 'response.content_part.added';
  item_id: string;
  output_index: number;
  content_index: number;
  part: {
    type: string;
    text: string;
    annotations: any[];
  };
}

interface OpenAIResponseContentPartDoneChunk extends OpenAIResponseChunkBase {
  type: 'response.content_part.done';
  item_id: string;
  output_index: number;
  content_index: number;
  part: {
    type: string;
    text: string;
    annotations: any[];
  };
}

interface OpenAIResponseOutputItemDoneChunk extends OpenAIResponseChunkBase {
  type: 'response.output_item.done';
  output_index: number;
  item: {
    type: string;
    id: string;
    status: string;
    role: string;
    content: any[];
  };
}

interface OpenAIResponseCompletedChunk extends OpenAIResponseChunkBase {
  type: 'response.completed';
  response: {
    id: string;
    status: string;
    output: any[];
    // other fields...
  };
}

// Union type for all possible chunk types
type OpenAIResponseChunk = 
  | OpenAIResponseDeltaChunk 
  | OpenAIResponseDoneChunk 
  | OpenAIResponseCreatedChunk
  | OpenAIResponseInProgressChunk
  | OpenAIResponseOutputItemAddedChunk
  | OpenAIResponseContentPartAddedChunk
  | OpenAIResponseContentPartDoneChunk
  | OpenAIResponseOutputItemDoneChunk
  | OpenAIResponseCompletedChunk
  | OpenAIResponseChunkBase;

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
  settings: ChatSettings = DEFAULT_SETTINGS,
  onChunk: (chunk: string) => void
) => {
  try {
    // Extract system message if present
    const systemMessage = messages.find(msg => msg.role === 'system');
    const otherMessages = messages.filter(msg => msg.role !== 'system');
    
    // Format the input for responses API
    const input = otherMessages.map(msg => msg.content).join('\n\n');
    
    console.log('Creating streaming request with messages:', messages.length);
    
    // Create the response with streaming enabled
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
    
    for await (const rawChunk of response) {
            const chunk = rawChunk as OpenAIResponseChunk;
            console.log('Received chunk:', chunk);

            let text = '';

            if (chunk.type === 'response.output_text.delta') {
              const deltaChunk = chunk as OpenAIResponseDeltaChunk;
              text = deltaChunk.delta || '';
              console.log('Extracted delta text:', text);
            }

            if (text) {
              onChunk(text);
            }
          }
  } catch (error: any) {
    console.error('Error generating streaming chat completion:', error.message);
    throw new Error(`Failed to generate streaming response: ${error.message}`);
  }
} 