import { createClient } from '@supabase/supabase-js'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import type { PreparedInput } from '../types'
import type { WidgetConfig } from '../pipeline/build-html'

const clientFor = (isProd: boolean) => {
  const { url, serviceKey } = env.supabase(isProd)
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

/* Maps the WidgetConfig object build-html.ts already bakes into the demo
 * page's inline JSON onto widget_configs' snake_case columns, so what the
 * page shows and what the API serves are the same data. */
const toWidgetConfigRow = (companyId: string, config: WidgetConfig) => ({
  company_id: companyId,
  title: config.title,
  logo_url: config.logoUrl,
  popup_message: config.popupMessage,
  welcome_message: config.welcomeMessage,
  open_on_load: config.openOnLoad,
  theme: config.theme,
  suggestions: config.suggestions ?? [],
  powered_by: config.poweredBy ?? {},
  styles: config.styles ?? {}
})

/* Upserts the company row, its chat config, and its widget config. Idempotent
 * so re-running the pipeline for the same company updates rather than errors.
 * The chat_configs column is still named pinecone_index_name for backwards
 * compatibility; the backend reads it as the Upstash namespace. */
export const persistCompanyConfig = async (
  input: PreparedInput,
  systemPrompt: string,
  widgetConfig: WidgetConfig
): Promise<void> => {
  const supabase = clientFor(input.isProd)

  const { error: companyError } = await supabase
    .from('companies')
    .upsert({ id: input.companyId, name: input.companyName })
  if (companyError) {
    throw new Error(`Failed to upsert company: ${companyError.message}`)
  }

  const { error: configError } = await supabase.from('chat_configs').upsert(
    {
      company_id: input.companyId,
      system_prompt: systemPrompt,
      pinecone_index_name: input.namespace,
      support_email: input.companyEmail
    },
    { onConflict: 'company_id' }
  )
  if (configError) {
    throw new Error(`Failed to upsert chat config: ${configError.message}`)
  }

  const { error: widgetConfigError } = await supabase
    .from('widget_configs')
    .upsert(toWidgetConfigRow(input.companyId, widgetConfig), {
      onConflict: 'company_id'
    })
  if (widgetConfigError) {
    throw new Error(
      `Failed to upsert widget config: ${widgetConfigError.message}`
    )
  }

  logger.info(
    `Persisted company + chat config + widget config for ${input.companyId}`
  )
}
