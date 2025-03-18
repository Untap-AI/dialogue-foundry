export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      chats: {
        Row: {
          id: string
          user_id: string
          name: string
          created_at: string
          updated_at: string | null
          model: string
          temperature: number
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          created_at?: string
          updated_at?: string | null
          model: string
          temperature: number
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          created_at?: string
          updated_at?: string | null
          model?: string
          temperature?: number
        }
      }
      messages: {
        Row: {
          id: string
          chat_id: string
          user_id: string
          content: string
          role: string
          model: string
          created_at: string
          updated_at: string | null
          sequence_number: number
        }
        Insert: {
          id?: string
          chat_id: string
          user_id: string
          content: string
          role: string
          model: string
          created_at?: string
          updated_at?: string | null
          sequence_number: number
        }
        Update: {
          id?: string
          chat_id?: string
          user_id?: string
          content?: string
          role?: string
          model?: string
          created_at?: string
          updated_at?: string | null
          sequence_number?: number
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'] 