import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getChatById, getChatsByUserId, updateChat, deleteChat, createChatAdmin } from '../db/chats'
import { getMessagesByChatId, getLatestSequenceNumber, createMessageAdmin } from '../db/messages'
import { generateChatCompletion, generateStreamingChatCompletion, Message, ChatSettings, DEFAULT_SETTINGS } from '../services/openai-service'
import { generateChatAccessToken } from '../lib/jwt-utils'
import { authenticateChatAccess, authenticateUser } from '../middleware/auth-middleware'

const router = express.Router()

// Get all chats for a user (requires user authentication)
router.get('/user/:userId', authenticateUser, async (req, res) => {
  try {
    // Ensure the requesting user can only access their own chats
    const { userId } = req.params
    
    // Ensure userId is a string
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' })
    }
    
    // Check if the authenticated user is requesting their own chats
    if (req.user?.userId !== userId) {
      return res.status(403).json({ error: 'You can only access your own chats' })
    }
    
    const chats = await getChatsByUserId(userId)
    return res.json(chats)
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// Get a chat by ID with its messages (requires chat-specific authentication)
router.get('/:chatId', authenticateChatAccess, async (req, res) => {
  try {
    const { chatId } = req.params
    
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' })
    }
    
    const chat = await getChatById(chatId)
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' })
    }
    
    const messages = await getMessagesByChatId(chatId)
    return res.json({ chat, messages })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// Create a new chat and return access token
router.post('/', async (req, res) => {
  try {
    const { userId, name } = req.body
    
    // Generate a new user ID if not provided
    const generatedUserId = userId ?? uuidv4()
    
    // Create the chat using the admin function to bypass RLS
    const newChat = await createChatAdmin({
      user_id: generatedUserId,
      name: name || 'New Chat'
    })
    
    // Generate access token for this chat
    const token = generateChatAccessToken(newChat.id, generatedUserId)
    
    return res.status(201).json({
      chat: newChat,
      accessToken: token
    })
  } catch (error: any) {
    console.error('Error creating chat:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Update a chat (requires chat-specific authentication)
router.put('/:chatId', authenticateChatAccess, async (req, res) => {
  try {
    const { chatId } = req.params
    
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' })
    }
    
    const { name } = req.body
    
    const updatedChat = await updateChat(chatId, {
      name,
      updated_at: new Date().toISOString()
    })
    
    return res.json(updatedChat)
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// Delete a chat (requires chat-specific authentication)
router.delete('/:chatId', authenticateChatAccess, async (req, res) => {
  try {
    const { chatId } = req.params
    
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' })
    }
    
    await deleteChat(chatId)
    return res.json({ success: true })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// Send a message and get a response (requires chat-specific authentication)
router.post('/:chatId/messages', authenticateChatAccess, async (req, res) => {
  try {
    const { chatId } = req.params
    const { content, model, temperature } = req.body
    
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' })
    }
    
    // Use the authenticated user's ID from the JWT token
    const userId = req.user?.userId
    
    if (!userId || !content) {
      return res.status(400).json({ error: 'User authentication and message content are required' })
    }
    
    const chat = await getChatById(chatId)
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' })
    }
    
    // Get chat settings - using request parameters or defaults
    const chatSettings: ChatSettings = {
      model: model || DEFAULT_SETTINGS.model,
      temperature: temperature || DEFAULT_SETTINGS.temperature
    }
    
    // Get all previous messages in this chat
    const previousMessages = await getMessagesByChatId(chatId)
    
    // Get the next sequence number
    const latestSequenceNumber = await getLatestSequenceNumber(chatId)
    const nextSequenceNumber = latestSequenceNumber + 1
    
    // Save the user message using admin function to bypass RLS
    const userMessage = await createMessageAdmin({
      chat_id: chatId,
      user_id: userId,
      content,
      role: 'user',
      sequence_number: nextSequenceNumber
    })
    
    // Prepare messages for OpenAI API
    const openaiMessages: Message[] = previousMessages.map(msg => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content
    }))
    
    // Add the new user message
    openaiMessages.push({
      role: 'user',
      content
    })
    
    // Generate response from OpenAI
    const aiResponseContent = await generateChatCompletion(openaiMessages, chatSettings)
    
    // Save the AI response using admin function to bypass RLS
    const aiMessage = await createMessageAdmin({
      chat_id: chatId,
      user_id: userId,
      content: aiResponseContent || 'Sorry, I was unable to generate a response.',
      role: 'assistant',
      sequence_number: nextSequenceNumber + 1
    })
    
    return res.json({
      userMessage,
      aiMessage
    })
  } catch (error: any) {
    console.error('Error in chat message endpoint:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Send a streaming message and get a response (requires chat-specific authentication)
// Support both POST and GET methods for compatibility with EventSource
router.post('/:chatId/stream', authenticateChatAccess, handleStreamRequest);
router.get('/:chatId/stream', authenticateChatAccess, handleStreamRequest);

// Shared handler function for stream requests
async function handleStreamRequest(req: express.Request, res: express.Response) {
  try {
    const { chatId } = req.params;
    
    // Check if token is provided in query parameters (for EventSource)
    const tokenFromQuery = req.query.token as string;
    if (tokenFromQuery && !req.headers.authorization) {
      // Set the Authorization header manually for token from query params
      req.headers.authorization = `Bearer ${tokenFromQuery}`;
      console.log('Using token from query parameters for authorization');
    }
    
    // Get content from body (POST) or query params (GET)
    const content = req.body.content || req.query.content;
    const model = req.body.model || req.query.model;
    const temperature = req.body.temperature || req.query.temperature;
    
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' });
    }
    
    // Use the authenticated user's ID from the JWT token
    const userId = req.user?.userId;
    
    if (!userId || !content) {
      return res.status(400).json({ error: 'User authentication and message content are required' });
    }
    
    const chat = await getChatById(chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Get chat settings - using request parameters or defaults
    const chatSettings: ChatSettings = {
      model: model || DEFAULT_SETTINGS.model,
      temperature: temperature ? parseFloat(temperature) : DEFAULT_SETTINGS.temperature
    };
    
    // Get all previous messages in this chat
    const previousMessages = await getMessagesByChatId(chatId);
    
    // Get the next sequence number
    const latestSequenceNumber = await getLatestSequenceNumber(chatId);
    const nextSequenceNumber = latestSequenceNumber + 1;
    
    // Save the user message using admin function to bypass RLS
    await createMessageAdmin({
      chat_id: chatId,
      user_id: userId,
      content,
      role: 'user',
      sequence_number: nextSequenceNumber
    });
    
    // Prepare messages for OpenAI API
    const openaiMessages: Message[] = previousMessages.map(msg => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content
    }));
    
    // Add the new user message
    openaiMessages.push({
      role: 'user',
      content
    });
    
    console.log('Generating streaming response for chat:', chatId);

    const onChunk = (chunk: string) => {
      res.write(chunk);
    }
    
    // Generate streaming response from OpenAI
    await generateStreamingChatCompletion(openaiMessages, chatSettings, onChunk);

    res.end();

    // Handle client disconnect
    return req.on('close', () => {
      console.log('Client disconnected');
      res.end();
    });
  } catch (error: any) {
    console.error('Error in streaming chat message endpoint:', error);
    // Only send error response if headers haven't been sent yet
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
}

export default router 