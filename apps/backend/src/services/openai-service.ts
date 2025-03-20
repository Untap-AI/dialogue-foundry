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
  settings: ChatSettings = DEFAULT_SETTINGS
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
    
    console.log('Got streaming response from OpenAI');
    
    // Create a ReadableStream that properly formats the OpenAI response chunks
    const stream = new ReadableStream({
      async start(controller) {
        console.log('Stream started');
        
        try {
          // Process each chunk of the response
          for await (const rawChunk of response) {
            // Cast the chunk to our custom type for better TypeScript support
            const chunk = rawChunk as OpenAIResponseChunk;
            console.log('Received chunk type:', chunk.type);
            
            // Extract text based on the actual chunk structure from OpenAI
            let text = '';
            
            try {
              // Handle different event types based on the logs
              switch (chunk.type) {
                case 'response.output_text.delta': {
                  // These are the actual text tokens we want to stream to the client
                  const deltaChunk = chunk as OpenAIResponseDeltaChunk;
                  text = deltaChunk.delta;
                  console.log('Extracted delta text:', text);
                  break;
                }
                
                case 'response.output_text.done': {
                  // This contains the full text at the end - we don't need to stream it again
                  const doneChunk = chunk as OpenAIResponseDoneChunk;
                  console.log('Full text received in done event (not streaming again):', doneChunk.text.substring(0, 50) + '...');
                  break;
                }
                
                case 'response.content_part.done': {
                  // This is another form of the completed text
                  const contentDoneChunk = chunk as OpenAIResponseContentPartDoneChunk;
                  console.log('Content part done received (not streaming):', 
                    contentDoneChunk.part.text ? 
                      contentDoneChunk.part.text.substring(0, 50) + '...' : 
                      'No text');
                  break;
                }
                
                case 'response.created':
                case 'response.in_progress':
                case 'response.output_item.added':
                case 'response.content_part.added':
                case 'response.output_item.done':
                case 'response.completed': {
                  // These are metadata events that don't contain streamed text
                  console.log('Received metadata event:', chunk.type);
                  break;
                }
                
                default: {
                  console.log('Unhandled event type:', chunk.type);
                  break;
                }
              }
              
              // Only send non-empty text chunks
              if (text) {
                console.log('Sending text chunk:', text);
                const sseMessage = `data: ${JSON.stringify({ content: text })}\n\n`;
                controller.enqueue(new TextEncoder().encode(sseMessage));
              }
            } catch (extractError) {
              console.error('Error extracting text from chunk:', extractError);
            }
          }
          
          // End the stream with a DONE message
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
          console.log('Stream closed');
        } catch (error) {
          console.error('Error during streaming:', error);
          controller.error(error);
        }
      }
    });
    
    // Set the proper headers for SSE
    const headers = new Headers();
    headers.set('Content-Type', 'text/event-stream');
    headers.set('Cache-Control', 'no-cache');
    headers.set('Connection', 'keep-alive');
    
    // Return the stream as a Response object
    return new Response(stream, { headers });
  } catch (error: any) {
    console.error('Error generating streaming chat completion:', error.message);
    throw new Error(`Failed to generate streaming response: ${error.message}`);
  }
} 