import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getChatById, getChatsByUserId, createChat, updateChat, deleteChat } from '../db/chats'
import { getMessagesByChatId, createMessage, getLatestSequenceNumber } from '../db/messages'
import { generateChatCompletion, Message, ChatSettings, DEFAULT_SETTINGS } from '../services/openai-service'

const router = express.Router()

// Get all chats for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const chats = await getChatsByUserId(userId)
    res.json(chats)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Get a chat by ID with its messages
router.get('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params
    const chat = await getChatById(chatId)
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' })
    }
    
    const messages = await getMessagesByChatId(chatId)
    res.json({ chat, messages })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Create a new chat
router.post('/', async (req, res) => {
  try {
    const { userId, name, model = DEFAULT_SETTINGS.model, temperature = DEFAULT_SETTINGS.temperature } = req.body
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' })
    }
    
    const newChat = await createChat({
      user_id: userId,
      name: name || 'New Chat',
      model,
      temperature
    })
    
    res.status(201).json(newChat)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Update a chat
router.put('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params
    const { name, model, temperature } = req.body
    
    const updatedChat = await updateChat(chatId, {
      name, 
      model, 
      temperature,
      updated_at: new Date().toISOString()
    })
    
    res.json(updatedChat)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Delete a chat
router.delete('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params
    await deleteChat(chatId)
    res.json({ success: true })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Send a message and get a response
router.post('/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params
    const { userId, content, model, temperature } = req.body
    
    if (!userId || !content) {
      return res.status(400).json({ error: 'User ID and content are required' })
    }
    
    const chat = await getChatById(chatId)
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' })
    }
    
    // Get chat settings
    const chatSettings: ChatSettings = {
      model: model || chat.model,
      temperature: temperature || chat.temperature
    }
    
    // Get all previous messages in this chat
    const previousMessages = await getMessagesByChatId(chatId)
    
    // Get the next sequence number
    const latestSequenceNumber = await getLatestSequenceNumber(chatId)
    const nextSequenceNumber = latestSequenceNumber + 1
    
    // Save the user message
    const userMessage = await createMessage({
      chat_id: chatId,
      user_id: userId,
      content,
      role: 'user',
      model: chatSettings.model,
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
    
    // Save the AI response
    const aiMessage = await createMessage({
      chat_id: chatId,
      user_id: userId,
      content: aiResponseContent || 'Sorry, I was unable to generate a response.',
      role: 'assistant',
      model: chatSettings.model,
      sequence_number: nextSequenceNumber + 1
    })
    
    res.json({
      userMessage,
      aiMessage
    })
  } catch (error: any) {
    console.error('Error in chat message endpoint:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router 