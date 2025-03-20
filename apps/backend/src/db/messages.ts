import { supabase } from "../lib/supabase-client"
import { TablesInsert, TablesUpdate } from "../types/database"
import { v4 as uuidv4 } from 'uuid'

// Import the service client from chats.ts
import { createClient } from '@supabase/supabase-js'
import { Database } from '../types/database'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Create a Supabase client with the service role key to bypass RLS for admin operations
const serviceSupabase = supabaseUrl && supabaseServiceKey
  ? createClient<Database>(
      supabaseUrl,
      supabaseServiceKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )
  : null;

export const getMessageById = async (messageId: string) => {
  const { data: message, error } = await supabase
    .from("messages")
    .select("*")
    .eq("id", messageId)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return message
}

export const getMessagesByChatId = async (chatId: string) => {
  // Use serviceSupabase to bypass RLS if available, otherwise fall back to regular client
  const client = serviceSupabase || supabase
  
  const { data: messages, error } = await client
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("sequence_number", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return messages || []
}

export const createMessage = async (message: TablesInsert<"messages">) => {
  const { data: createdMessage, error } = await supabase
    .from("messages")
    .insert([message])
    .select("*")
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return createdMessage
}

/**
 * Create a message with admin privileges (bypasses RLS)
 * Use this when creating messages on behalf of users
 */
export const createMessageAdmin = async (message: Omit<TablesInsert<"messages">, "id">) => {
  if (!serviceSupabase) {
    throw new Error('Service role client not initialized. Check your environment variables.')
  }

  const messageWithDefaults = {
    id: uuidv4(),
    ...message,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  const { data: createdMessage, error } = await serviceSupabase
    .from("messages")
    .insert([messageWithDefaults])
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to create message: ${error.message}`)
  }

  return createdMessage
}

export const createMessages = async (messages: TablesInsert<"messages">[]) => {
  const { data: createdMessages, error } = await supabase
    .from("messages")
    .insert(messages)
    .select("*")

  if (error) {
    throw new Error(error.message)
  }

  return createdMessages
}

/**
 * Create multiple messages with admin privileges (bypasses RLS)
 * Use this when creating messages on behalf of users
 */
export const createMessagesAdmin = async (messages: Omit<TablesInsert<"messages">, "id">[]) => {
  if (!serviceSupabase) {
    throw new Error('Service role client not initialized. Check your environment variables.')
  }

  const messagesWithDefaults = messages.map(message => ({
    id: uuidv4(),
    ...message,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }))

  const { data: createdMessages, error } = await serviceSupabase
    .from("messages")
    .insert(messagesWithDefaults)
    .select("*")

  if (error) {
    throw new Error(`Failed to create messages: ${error.message}`)
  }

  return createdMessages
}

export const updateMessage = async (
  messageId: string,
  message: TablesUpdate<"messages">
) => {
  const { data: updatedMessage, error } = await supabase
    .from("messages")
    .update(message)
    .eq("id", messageId)
    .select("*")
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return updatedMessage
}

export const deleteMessage = async (messageId: string) => {
  const { error } = await supabase.from("messages").delete().eq("id", messageId)

  if (error) {
    throw new Error(error.message)
  }

  return true
}

export const getLatestSequenceNumber = async (chatId: string) => {
  const { data, error } = await supabase
    .from("messages")
    .select("sequence_number")
    .eq("chat_id", chatId)
    .order("sequence_number", { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== "PGRST116") { // PGRST116 is the error code for no rows returned
    throw new Error(error.message)
  }

  return data?.sequence_number || 0
} 