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

  // First send the user message with regular axios
  try {
    console.log('Sending user message...');
    await axios.post(
      `${API_BASE_URL}/chats/${chatId}/messages`,
      { content },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log('User message sent successfully, now starting stream...');
  } catch (msgError) {
    console.error('Failed to send user message:', msgError);
    onError(msgError instanceof Error ? msgError : new Error('Failed to send user message'));
    return;
  }
  
  // Try both streaming approaches - first try with EventSource which handles reconnection
  // automatically, then fall back to fetch API if that fails
  let streamComplete = false;
  let fullText = '';
  
  try {
    // First try with standard EventSource which is better for SSE
    // EventSource doesn't support headers by default, so we need to pass the token as a URL parameter
    const streamUrl = new URL(`${API_BASE_URL}/chats/${chatId}/stream`);
    streamUrl.searchParams.append('content', content);
    streamUrl.searchParams.append('token', token); // Pass token as parameter since EventSource doesn't support custom headers
    
    console.log('Creating EventSource with URL:', streamUrl.toString());
    const eventSource = new EventSource(streamUrl.toString());
    
    console.log('EventSource created');
    
    // Set up Promise to track completion
    const streamPromise = new Promise<string>((resolve, reject) => {
      // Handle incoming messages
      eventSource.onmessage = (event) => {
        try {
          console.log('Received SSE message:', event.data);
          
          // Check for the DONE signal
          if (event.data === '[DONE]') {
            console.log('Stream complete ([DONE])');
            resolve(fullText);
            return;
          }
          
          // Parse the JSON data
          const data = JSON.parse(event.data);
          if (data && data.content) {
            fullText += data.content;
            onChunk(data.content);
          } else {
            console.warn('Received message without content:', event.data);
          }
        } catch (e) {
          console.warn('Error processing event data:', e, 'Raw data:', event.data);
        }
      };
      
      // Handle errors - be more descriptive about what went wrong
      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        
        // If the connection was never established, this is likely a CORS or network issue
        if (eventSource.readyState === EventSource.CONNECTING) {
          reject(new Error('Could not establish stream connection. Possible CORS or network issue.'));
        } 
        // If the connection was closed unexpectedly
        else if (eventSource.readyState === EventSource.CLOSED) {
          // If we have some text already, consider it a partial success
          if (fullText.length > 0) {
            console.warn('Connection closed but received partial response');
            resolve(fullText);
          } else {
            reject(new Error('Stream connection closed unexpectedly'));
          }
        } else {
          reject(new Error('Stream connection error'));
        }
      };
      
      // Handle connection open
      eventSource.onopen = () => {
        console.log('EventSource connection opened successfully');
      };
      
      // Cleanup function for the promise
      return () => {
        console.log('Cleaning up EventSource');
        eventSource.close();
      };
    });
    
    // Wait for stream completion or timeout after 30 seconds
    const timeoutPromise = new Promise<string>((_, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Stream timeout'));
      }, 30000);
      
      return () => clearTimeout(timeout);
    });
    
    try {
      // Race the stream against a timeout
      const result = await Promise.race([streamPromise, timeoutPromise]);
      streamComplete = true;
      onComplete(result);
    } finally {
      // Always close EventSource
      eventSource.close();
    }
  } catch (streamError) {
    console.error('Error with EventSource streaming:', streamError);
    
    // Only try fetch if EventSource failed and we didn't complete
    if (!streamComplete) {
      try {
        console.log('Falling back to fetch API for streaming');
        
        const response = await fetch(`${API_BASE_URL}/chats/${chatId}/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify({ content })
        });
        
        if (!response.ok) {
          throw new Error(`Stream request failed with status ${response.status}`);
        }
        
        if (!response.body) {
          throw new Error('Response body is null');
        }
        
        fullText = ''; // Reset in case there was partial content
        
        // Read the stream with fetch API
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = ''; // Buffer to handle partial chunks
        
        // Define processSSEChunk function first
        const processSSEChunk = (data: string) => {
          // Split by double newlines which indicate complete SSE messages
          const messages = data.split('\n\n');
          
          // Process all complete messages except possibly the last one
          const completeMessages = messages.slice(0, -1);
          
          // Keep the last message in the buffer if it's not complete
          const lastPart = messages[messages.length - 1];
          buffer = lastPart || ''; // Ensure buffer is a string even if lastPart is undefined
          
          for (const message of completeMessages) {
            // Process each complete SSE message
            for (const line of message.split('\n')) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data: ')) {
                const data = trimmed.substring(6);
                
                // Check for done signal
                if (data === '[DONE]') {
                  console.log('Stream complete ([DONE])');
                  continue;
                }
                
                try {
                  const parsed = JSON.parse(data);
                  if (parsed && parsed.content) {
                    fullText += parsed.content;
                    onChunk(parsed.content);
                  } else {
                    console.warn('Message without content:', data);
                  }
                } catch (e) {
                  console.warn('Error parsing chunk data:', e, 'Raw data:', data);
                }
              }
            }
          }
        };
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            console.log('Stream complete (done)');
            // Process any remaining data in the buffer
            if (buffer.trim()) {
              console.log('Processing remaining buffer:', buffer);
              processSSEChunk(buffer);
            }
            break;
          }
          
          // Process the chunk as text
          const chunk = decoder.decode(value, { stream: true });
          console.log('Received raw chunk:', chunk);
          
          // Append to buffer and process
          buffer += chunk;
          
          // Process the buffer
          processSSEChunk(buffer);
        }
        
        streamComplete = true;
        onComplete(fullText);
      } catch (fetchError) {
        console.error('Error with fetch streaming:', fetchError);
        onError(fetchError instanceof Error ? fetchError : new Error('Streaming failed'));
      }
    }
  }
};

/**
 * Cancel ongoing stream if one exists
 */
export const cancelStream = (): void => {
  console.log('Stream cancellation not implemented yet');
}; 