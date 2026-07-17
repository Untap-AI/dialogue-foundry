import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { createFetchWithRetry } from '../lib/fetch-with-retry'
import { logger } from '../lib/logger'
import type { Database } from '../types/database'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Service-role client: widget_installs has RLS enabled with no policies, so the
// anon key can't touch it. Mirrors the setup in db/widget-configs.ts.
const serviceSupabase =
  supabaseUrl && supabaseServiceKey
    ? createClient<Database>(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          fetch: createFetchWithRetry({
            maxRetries: 2,
            initialDelayMs: 500,
            maxDelayMs: 3000,
            timeoutMs: 10000
          })
        }
      })
    : undefined

/**
 * Records that `companyId`'s widget booted on `domain`. Upserts via the
 * record_widget_install RPC (atomic last_seen/hits bump). Best-effort by design:
 * this runs fire-and-forget off the hot widget-config path, so it logs and
 * swallows every error rather than affecting the response.
 */
export const recordWidgetInstall = async (
  companyId: string,
  domain: string
): Promise<void> => {
  if (!serviceSupabase) return

  try {
    const { error } = await serviceSupabase.rpc('record_widget_install', {
      p_company_id: companyId,
      p_domain: domain
    })
    if (error) {
      logger.warn('Failed to record widget install', {
        error: new Error(error.message),
        companyId,
        domain
      })
    }
  } catch (error) {
    logger.warn('Failed to record widget install', {
      error: error as Error,
      companyId,
      domain
    })
  }
}
