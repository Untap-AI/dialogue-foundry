import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { supabase } from '../lib/supabase-client'
import { createFetchWithRetry } from '../lib/fetch-with-retry'
import type { Database, Tables, TablesInsert } from '../types/database'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const serviceSupabase =
  supabaseUrl && supabaseServiceKey
    ? createClient<Database>(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        },
        global: {
          fetch: createFetchWithRetry({
            maxRetries: 3,
            initialDelayMs: 500,
            maxDelayMs: 5000,
            timeoutMs: 15000
          })
        }
      })
    : undefined

export type WidgetConfigRow = Tables<'widget_configs'>

export type ActiveHours = Pick<
  Tables<'chat_configs'>,
  'timezone' | 'active_start_time' | 'active_end_time'
>

export type WidgetConfigWithHours = {
  widgetConfig: WidgetConfigRow | null
  activeHours: ActiveHours | null
}

/**
 * Get a company's widget config plus its active-hours columns.
 *
 * Deliberately never selects '*' from chat_configs here -- only the three
 * active-hours columns -- so sensitive fields (system_prompt, vector
 * namespace, support email, sendgrid template) can never leak into the public
 * widget-config response even if new sensitive columns are added later.
 */
export const getWidgetConfigByCompanyId = async (
  companyId: string
): Promise<WidgetConfigWithHours> => {
  const client = serviceSupabase || supabase

  const [widgetConfigResult, chatConfigResult] = await Promise.all([
    client
      .from('widget_configs')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle(),
    client
      .from('chat_configs')
      .select('timezone, active_start_time, active_end_time')
      .eq('company_id', companyId)
      .maybeSingle()
  ])

  if (widgetConfigResult.error) {
    console.error('Error getting widget config:', widgetConfigResult.error)
    throw new Error(
      `Failed to get widget config: ${widgetConfigResult.error.message}`
    )
  }

  if (chatConfigResult.error) {
    console.error(
      'Error getting chat config active hours:',
      chatConfigResult.error
    )
    throw new Error(
      `Failed to get chat config active hours: ${chatConfigResult.error.message}`
    )
  }

  return {
    widgetConfig: widgetConfigResult.data,
    activeHours: chatConfigResult.data
  }
}

export const upsertWidgetConfig = async (
  companyId: string,
  values: Omit<TablesInsert<'widget_configs'>, 'company_id' | 'id'>
): Promise<WidgetConfigRow> => {
  const client = serviceSupabase || supabase

  const { data, error } = await client
    .from('widget_configs')
    .upsert(
      {
        company_id: companyId,
        ...values,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'company_id' }
    )
    .select('*')
    .single()

  if (error) {
    throw new Error(`Failed to upsert widget config: ${error.message}`)
  }

  return data
}

export const deleteWidgetConfig = async (
  companyId: string
): Promise<boolean> => {
  const client = serviceSupabase || supabase

  const { data, error } = await client
    .from('widget_configs')
    .delete()
    .eq('company_id', companyId)
    .select('id')

  if (error) {
    throw new Error(`Failed to delete widget config: ${error.message}`)
  }

  return (data?.length ?? 0) > 0
}
