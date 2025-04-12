import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import type { Database } from '../types/database'
import { env } from 'process'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    `Missing Supabase environment variables for ${env} environment`
  )
}

console.info(`Connecting to Supabase at ${supabaseUrl} (${env} environment)`)

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
