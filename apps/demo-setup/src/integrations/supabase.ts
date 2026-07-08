import { createClient } from '@supabase/supabase-js'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import type { PreparedInput } from '../types'

const clientFor = (isProd: boolean) => {
  const { url, serviceKey } = env.supabase(isProd)
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

/* Upserts the company row and its chat config. Idempotent so re-running the
 * pipeline for the same company updates rather than errors. The chat_configs
 * column is still named pinecone_index_name for backwards compatibility; the
 * backend reads it as the Upstash namespace. */
export const persistCompanyConfig = async (
  input: PreparedInput,
  systemPrompt: string
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

  logger.info(`Persisted company + chat config for ${input.companyId}`)
}
