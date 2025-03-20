import { createClient } from '@supabase/supabase-js'
import { Database } from '../types/database'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

// Load the appropriate environment file based on NODE_ENV
const env = process.env.NODE_ENV || 'development'
const envPath = path.resolve(process.cwd(), `.env.${env === 'development' ? 'local' : env}`)

// Fallback to regular .env if specific file doesn't exist
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
} else {
  dotenv.config()
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(`Missing Supabase environment variables for ${env} environment`)
}

console.log(`Connecting to Supabase at ${supabaseUrl} (${env} environment)`)

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey) 