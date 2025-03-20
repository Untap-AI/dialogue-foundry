/**
 * Example Chat Client with JWT Authentication
 * 
 * This is a simple example showing how to use the chat API with JWT tokens.
 * In a real application, you would integrate this with your UI framework.
 */

// Chat API base URL
const API_BASE_URL = 'http://localhost:3000/api';

// Store the JWT token
let authToken = localStorage.getItem('chat_auth_token');

/**
 * Create a new chat and get an access token
 * @param {string} userId - User ID
 * @param {string} name - Chat name
 * @returns {Promise<Object>} - Chat object and access token
 */
async function createChat(userId, name = 'New Chat') {
  try {
    const response = await fetch(`${API_BASE_URL}/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId, name })
    });

    if (!response.ok) {
      throw new Error(`Failed to create chat: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Store the access token for future requests
    authToken = data.accessToken;
    localStorage.setItem('chat_auth_token', authToken);
    
    console.log('Chat created successfully with access token');
    return data;
  } catch (error) {
    console.error('Error creating chat:', error);
    throw error;
  }
}

/**
 * Get a chat by ID with its messages
 * @param {string} chatId - Chat ID
 * @returns {Promise<Object>} - Chat object with messages
 */
async function getChat(chatId) {
  if (!authToken) {
    throw new Error('Authentication token required. Create a chat first.');
  }

  try {
    const response = await fetch(`${API_BASE_URL}/chats/${chatId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('chat_auth_token');
        authToken = null;
        throw new Error('Authentication failed. Please create a new chat to get a valid token.');
      }
      throw new Error(`Failed to get chat: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting chat:', error);
    throw error;
  }
}

/**
 * Send a message to the chat
 * @param {string} chatId - Chat ID
 * @param {string} content - Message content
 * @returns {Promise<Object>} - User message and AI response
 */
async function sendMessage(chatId, content) {
  if (!authToken) {
    throw new Error('Authentication token required. Create a chat first.');
  }

  try {
    const response = await fetch(`${API_BASE_URL}/chats/${chatId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ content })
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('chat_auth_token');
        authToken = null;
        throw new Error('Authentication failed. Please create a new chat to get a valid token.');
      }
      throw new Error(`Failed to send message: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}

/**
 * Example usage
 */
async function exampleUsage() {
  try {
    // Create a new chat
    const { chat, accessToken } = await createChat('user-123', 'Example Chat');
    console.log('New chat created:', chat);
    console.log('Access token:', accessToken);

    // Get the chat with messages
    const chatWithMessages = await getChat(chat.id);
    console.log('Chat with messages:', chatWithMessages);

    // Send a message and get a response
    const messageResponse = await sendMessage(chat.id, 'Hello, how can you help me today?');
    console.log('Message exchange:', messageResponse);
  } catch (error) {
    console.error('Example usage error:', error);
  }
}

// Uncomment to run the example
// exampleUsage();

export { createChat, getChat, sendMessage }; 