import axios from 'axios';

// Backend API base URL - should come from env variable in a real app
const API_BASE_URL = 'http://localhost:3000/api';

// Token storage key
const TOKEN_STORAGE_KEY = 'chat_access_token';
const CHAT_ID_STORAGE_KEY = 'chat_id';

/**
 * Stream a message to the chat using SSE (Server-Sent Events)
 * @param content User message content
 * @param onChunk Callback for each message chunk
 * @param onComplete Callback for when the stream completes
 * @param onError Callback for when an error occurs
 */
export const streamMessage = async (
  content: string,
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: Error) => void
): Promise<void> => {
  const chatId = localStorage.getItem(CHAT_ID_STORAGE_KEY);
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  
  if (!chatId) {
    onError(new Error('Chat ID not found. Please initialize a chat first.'));
    return;
  }
  
  if (!token) {
    onError(new Error('Authentication token not found. Please initialize a chat first.'));
    return;
  }


    const response =  await fetch(
      `${API_BASE_URL}/chats/${chatId}/stream`,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, method: 'POST', body: JSON.stringify({ content }) }
    );

    console.log('Response:', response);

  
  // Try both streaming approaches - first try with EventSource which handles reconnection
  // automatically, then fall back to fetch API if that fails
  let fullText = '';
  
  try {
    if (response.status !== 200) {
        return;
    }

    if (!response.body) {
        return;
    }

    // Read a stream of server-sent events
    // and feed them to the observer as they are being generated
    const reader = response.body.getReader();
    const textDecoder = new TextDecoder();

    while (true) {
        const {value, done} = await reader.read();
        console.log('Value:', value);
        if (done) {
            break;
        }

        const content = textDecoder.decode(value);
        console.log('Content:', content);
        if (content) {
            onChunk(content);
        }
    }

    onComplete(fullText);
  } catch (error) {
    onError(error instanceof Error ? error : new Error('Failed to stream message'));
  }
};

/**
 * Cancel ongoing stream if one exists
 */
export const cancelStream = (): void => {
  console.log('Stream cancellation not implemented yet');
}; 