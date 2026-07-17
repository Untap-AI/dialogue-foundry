import { createClient } from '@supabase/supabase-js'
import { env } from '../config/env'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FunnelRow, FunnelStage } from '../types'

/* The funnel lives in the same (prod) project as the demo_requests queue, and so
 * do the chats and widget_installs it reads: real prospect demos are is_prod, and
 * their config, chats, and install beacons all land in prod. Test demos
 * (is_prod=false) write config to the test project and are out of funnel scope. */
let cached: SupabaseClient | undefined
const client = (): SupabaseClient => {
  if (!cached) {
    const { url, serviceKey } = env.queueSupabase()
    cached = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  }
  return cached
}

const nowIso = (): string => new Date().toISOString()

/* Seeds a funnel row for every completed demo not already tracked. Idempotent via
 * ON CONFLICT DO NOTHING (ignoreDuplicates), so re-running never disturbs an
 * in-progress row. Bounded by funnelBackfillSince so enabling the poller doesn't
 * sweep a backlog of old prospects into the sequence. */
export const backfillFunnelRows = async (since: string): Promise<number> => {
  const { data: candidates, error } = await client()
    .from('demo_requests')
    .select(
      'id, company_id, email, website_url, company_name, platform, completed_at, demo_ready_message_id'
    )
    .eq('status', 'complete')
    // eslint-disable-next-line no-null/no-null -- Supabase's IS NOT NULL filter
    .not('company_id', 'is', null)
    .gt('completed_at', since)

  if (error) throw new Error(`Funnel backfill query failed: ${error.message}`)
  if (!candidates || candidates.length === 0) return 0

  const rows = candidates.map(c => ({
    company_id: c.company_id as string,
    demo_request_id: c.id as string,
    email: c.email as string,
    website_url: c.website_url as string,
    company_name: c.company_name as string | null,
    platform: c.platform as string | null,
    demo_ready_message_id: c.demo_ready_message_id as string | null,
    demo_completed_at: c.completed_at as string,
    stage: 'demo_sent' as FunnelStage
  }))

  const { error: upsertError } = await client()
    .from('demo_funnel')
    .upsert(rows, { onConflict: 'company_id', ignoreDuplicates: true })

  if (upsertError) {
    throw new Error(`Funnel backfill upsert failed: ${upsertError.message}`)
  }
  return rows.length
}

export const getRowsByStage = async (
  stages: FunnelStage[]
): Promise<FunnelRow[]> => {
  const { data, error } = await client()
    .from('demo_funnel')
    .select('*')
    .in('stage', stages)

  if (error) throw new Error(`Funnel stage query failed: ${error.message}`)
  return (data ?? []) as FunnelRow[]
}

/* Returns the domain the widget was seen on for this company, or null if it has
 * never beaconed. Any row here means a real-site install (the beacon excludes
 * our demo/marketing hosts before writing). */
export const getInstallDomain = async (
  companyId: string
): Promise<string | undefined> => {
  const { data, error } = await client()
    .from('widget_installs')
    .select('domain')
    .eq('company_id', companyId)
    .order('first_seen', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Install lookup failed: ${error.message}`)
  return data?.domain as string | undefined
}

/* True when a genuine prospect has sent at least one message on the demo since it
 * was built. Excludes the team's own testing by IP and by @untap-ai.com email so
 * we never fire a trial offer at ourselves. */
export const hasProspectEngagement = async (
  companyId: string,
  since: string,
  teamIps: string[]
): Promise<boolean> => {
  const { data: chats, error } = await client()
    .from('chats')
    .select('id, ip_address, user_email')
    .eq('company_id', companyId)
    .gte('created_at', since)

  if (error) throw new Error(`Engagement chat query failed: ${error.message}`)
  if (!chats || chats.length === 0) return false

  const teamIpSet = new Set(teamIps)
  const candidateChatIds = chats
    .filter(c => {
      const ip = c.ip_address as string | null
      const email = c.user_email as string | null
      if (ip && teamIpSet.has(ip)) return false
      if (email && /@untap-ai\.com$/i.test(email)) return false
      return true
    })
    .map(c => c.id as string)

  if (candidateChatIds.length === 0) return false

  // A user-authored message (not just the assistant welcome) is what makes this
  // real engagement rather than an auto-opened widget.
  const { data: messages, error: msgError } = await client()
    .from('messages')
    .select('id')
    .in('chat_id', candidateChatIds)
    .eq('role', 'user')
    .limit(1)

  if (msgError)
    throw new Error(`Engagement message query failed: ${msgError.message}`)
  return (messages?.length ?? 0) > 0
}

/* Counts the prospect's conversations on their live site since the trial started,
 * for the personalized stat in the trial-ending email. */
export const countChatsSince = async (
  companyId: string,
  since: string
): Promise<number> => {
  const { count, error } = await client()
    .from('chats')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('created_at', since)

  if (error) throw new Error(`Chat count failed: ${error.message}`)
  return count ?? 0
}

/* Claim-then-send primitive. Sets the milestone timestamp only if it is still
 * null, so a milestone can never be claimed twice even across a restart. Returns
 * the updated row when this call won the claim, or null when another tick (or a
 * concurrent process) already took it. */
const claimMilestone = async (
  id: string,
  guardColumn: string,
  patch: Record<string, unknown>
): Promise<FunnelRow | undefined> => {
  const { data, error } = await client()
    .from('demo_funnel')
    .update(patch)
    .eq('id', id)
    // eslint-disable-next-line no-null/no-null -- Supabase's IS NULL filter
    .is(guardColumn, null)
    .select('*')
    .maybeSingle()

  if (error)
    throw new Error(`Funnel claim (${guardColumn}) failed: ${error.message}`)
  return (data as FunnelRow | undefined) ?? undefined
}

/* Records that a prospect engaged, without sending anything yet. The offer goes
 * out on a later tick once the configured delay has passed (see poller), so the
 * founder note reads as a human reply rather than an instant auto-response. Stage
 * stays 'demo_sent' until the offer actually sends. */
export const claimEngagement = (id: string): Promise<FunnelRow | undefined> =>
  claimMilestone(id, 'first_engaged_at', {
    first_engaged_at: nowIso()
  })

export const claimTrialOffer = (id: string): Promise<FunnelRow | undefined> =>
  claimMilestone(id, 'trial_offer_sent_at', {
    trial_offer_sent_at: nowIso(),
    stage: 'trial_offered' as FunnelStage
  })

export const claimNudge = (id: string): Promise<FunnelRow | undefined> =>
  claimMilestone(id, 'nudge_sent_at', {
    nudge_sent_at: nowIso(),
    stage: 'nudged' as FunnelStage
  })

export const claimTrialStarted = (
  id: string,
  installDomain: string,
  trialEndsAt: string
): Promise<FunnelRow | undefined> =>
  claimMilestone(id, 'trial_started_at', {
    trial_started_at: nowIso(),
    trial_ends_at: trialEndsAt,
    install_domain: installDomain,
    stage: 'trial_started' as FunnelStage
  })

export const claimTrialEnding = (id: string): Promise<FunnelRow | undefined> =>
  claimMilestone(id, 'trial_ending_email_sent_at', {
    trial_ending_email_sent_at: nowIso(),
    stage: 'trial_ending' as FunnelStage
  })

/* Expiry has no email and no per-milestone guard column, so guard on the target
 * stage instead: only rows not already expired are moved. */
export const markExpired = async (id: string): Promise<boolean> => {
  const { data, error } = await client()
    .from('demo_funnel')
    .update({ stage: 'expired' as FunnelStage })
    .eq('id', id)
    .neq('stage', 'expired')
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Funnel expiry update failed: ${error.message}`)
  return Boolean(data)
}
