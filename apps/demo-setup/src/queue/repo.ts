import { createClient } from '@supabase/supabase-js'
import { env } from '../config/env'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DemoRequestRow } from '../types'

let cached: SupabaseClient | undefined

/* The queue always lives in the prod project, regardless of a row's is_prod —
 * that flag only selects where the generated company config is written. */
const client = (): SupabaseClient => {
  if (!cached) {
    const { url, serviceKey } = env.queueSupabase()
    cached = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  }
  return cached
}

/* Atomically takes up to `batch` pending rows. Two workers (or two slots in one
 * worker) can call this concurrently without ever claiming the same row — see
 * the FOR UPDATE SKIP LOCKED in claim_demo_requests. */
export const claimPending = async (
  workerId: string,
  batch: number
): Promise<DemoRequestRow[]> => {
  const { data, error } = await client().rpc('claim_demo_requests', {
    p_worker: workerId,
    p_batch: batch
  })
  if (error) throw new Error(`Failed to claim demo requests: ${error.message}`)
  return (data ?? []) as DemoRequestRow[]
}

/* Rows whose worker died mid-job sit in 'processing' forever. Returns those with
 * retries left to 'pending' and marks the exhausted ones 'failed'. */
export const reapStale = async (): Promise<DemoRequestRow[]> => {
  const { data, error } = await client().rpc('reap_stale_demo_requests', {
    p_stale_minutes: env.queueStaleMinutes
  })
  if (error) throw new Error(`Failed to reap stale requests: ${error.message}`)
  return (data ?? []) as DemoRequestRow[]
}

const update = async (
  id: string,
  patch: Partial<DemoRequestRow>
): Promise<void> => {
  const { error } = await client()
    .from('demo_requests')
    .update(patch)
    .eq('id', id)
  if (error) {
    throw new Error(`Failed to update demo request ${id}: ${error.message}`)
  }
}

/* Persisted before the pipeline runs so a retry reuses the same id, rather than
 * orphaning the previous attempt's S3 objects and Upstash namespace. */
export const setCompanyId = (id: string, companyId: string): Promise<void> =>
  update(id, { company_id: companyId })

export const setDemoUrl = (id: string, demoUrl: string): Promise<void> =>
  update(id, { demo_url: demoUrl })

/* Written back once the pipeline infers a name (the marketing site no longer
 * collects one), so the row stays a useful record even though it arrived null. */
export const setCompanyName = (
  id: string,
  companyName: string
): Promise<void> => update(id, { company_name: companyName })

/* Detected website platform (wordpress, shopify, ...), written back so the
 * funnel's trial-offer email can deep-link to the matching install guide.
 * Undefined (nothing detected) leaves the column at its null default. */
export const setPlatform = (
  id: string,
  platform: string | undefined
): Promise<void> => update(id, { platform })

/* The Message-ID we stamped on the demo-ready email, stored so the funnel's
 * trial-offer follow-up can reply on the same thread. */
export const setDemoReadyMessageId = (
  id: string,
  messageId: string
): Promise<void> => update(id, { demo_ready_message_id: messageId })

export const markComplete = (id: string): Promise<void> =>
  update(id, { status: 'complete', completed_at: new Date().toISOString() })

/* `exhausted` rows stay failed; the rest go back to pending for another pass.
 * Note attempts was already incremented by the claim, so the worker compares
 * row.attempts >= row.max_attempts to decide.
 *
 * claimed_at/claimed_by are left as-is: the next claim overwrites them, and the
 * reaper only considers rows still in 'processing'. */
export const markFailed = (
  id: string,
  error: string,
  exhausted: boolean
): Promise<void> =>
  update(id, {
    status: exhausted ? 'failed' : 'pending',
    last_error: error.slice(0, 2000)
  })

/* Called on graceful shutdown so in-flight rows are immediately reclaimable
 * instead of waiting out DEMO_STALE_MINUTES. Refunds the attempt the claim
 * consumed — a clean restart shouldn't count against a request's retries. */
export const releaseClaims = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return
  const { error } = await client().rpc('release_demo_requests', { p_ids: ids })
  if (error) throw new Error(`Failed to release claims: ${error.message}`)
}
