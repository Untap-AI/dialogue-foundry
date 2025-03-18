import { supabase } from "../lib/supabase-client"
import { TablesInsert, TablesUpdate } from "../types/database"

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
  const { data: messages, error } = await supabase
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